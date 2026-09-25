import express, { type Request, type Response } from 'express';
import Stripe from 'stripe';
import { config } from './config';
import { db } from './db';
import * as platform from './db/platform';
import { createLogger } from './logger';
import type { SessionUser } from './protocol';

const log = createLogger('billing');

export const billingEnabled = Boolean(
  config.billing.secretKey && config.billing.webhookSecret && config.billing.priceId,
);

const stripe = billingEnabled ? new Stripe(config.billing.secretKey) : null;

export type BillingStatus =
  | 'unconfigured'
  | 'none'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export interface BillingAccount {
  guildId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: BillingStatus;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: number;
}

export interface BillingSummary {
  configured: boolean;
  status: BillingStatus;
  entitled: boolean;
  customer: boolean;
  subscription: boolean;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  plan: {
    amountCents: number;
    currency: 'usd';
    interval: 'month';
    storageBytes: number;
  };
}

interface BillingRow {
  guild_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
  updated_at: number;
}

function account(row: BillingRow): BillingAccount {
  return {
    guildId: row.guild_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status as BillingStatus,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    updatedAt: row.updated_at,
  };
}

export function getBillingAccount(guildId: string): BillingAccount | null {
  const row = db()
    .prepare('SELECT * FROM billing_accounts WHERE guild_id = ?')
    .get(guildId) as unknown as BillingRow | undefined;
  return row ? account(row) : null;
}

function findBillingAccount(field: 'stripe_customer_id' | 'stripe_subscription_id', id: string): BillingAccount | null {
  const row = db()
    .prepare(`SELECT * FROM billing_accounts WHERE ${field} = ?`)
    .get(id) as unknown as BillingRow | undefined;
  return row ? account(row) : null;
}

function saveBillingAccount(next: BillingAccount): void {
  db()
    .prepare(
      `INSERT INTO billing_accounts
        (guild_id, stripe_customer_id, stripe_subscription_id, status,
         current_period_end, cancel_at_period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         status = excluded.status,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         updated_at = excluded.updated_at`,
    )
    .run(
      next.guildId,
      next.stripeCustomerId,
      next.stripeSubscriptionId,
      next.status,
      next.currentPeriodEnd,
      next.cancelAtPeriodEnd ? 1 : 0,
      next.updatedAt,
    );
}

export function hasCloudEntitlement(guildId: string): boolean {
  // Local and self-hosted installs retain Deck Cloud without having to run a
  // Stripe account. The hosted service opts into enforcement by configuring it.
  if (!billingEnabled) return true;
  const status = getBillingAccount(guildId)?.status;
  return status === 'active' || status === 'trialing';
}

export function storageLimitBytes(guildId: string): number {
  return billingEnabled && hasCloudEntitlement(guildId)
    ? config.billing.storageBytes
    : config.spaces.guildLimitBytes;
}

export function billingSummary(guildId: string): BillingSummary {
  const found = getBillingAccount(guildId);
  return {
    configured: billingEnabled,
    status: billingEnabled ? (found?.status ?? 'none') : 'unconfigured',
    entitled: hasCloudEntitlement(guildId),
    customer: Boolean(found?.stripeCustomerId),
    subscription: Boolean(found?.stripeSubscriptionId),
    currentPeriodEnd: found?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: found?.cancelAtPeriodEnd ?? false,
    plan: {
      amountCents: config.billing.monthlyPriceCents,
      currency: 'usd',
      interval: 'month',
      storageBytes: config.billing.storageBytes,
    },
  };
}

function userMayManageBilling(user: SessionUser, guildId: string): boolean {
  const guild = platform.getGuild(guildId);
  return Boolean(guild && (guild.createdBy === user.id || user.isPlatformAdmin));
}

function customerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): number | null {
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => Number.isFinite(value));
  return ends.length ? Math.max(...ends) * 1000 : null;
}

function recordSubscription(subscription: Stripe.Subscription, hintedGuildId?: string | null): void {
  const customer = customerId(subscription.customer);
  const existing =
    findBillingAccount('stripe_subscription_id', subscription.id) ??
    (customer ? findBillingAccount('stripe_customer_id', customer) : null);
  const guildId = hintedGuildId || subscription.metadata.guildId || existing?.guildId;
  if (!guildId || !platform.getGuild(guildId)) {
    log.warn(`ignoring Stripe subscription ${subscription.id}: no matching rig`);
    return;
  }

  saveBillingAccount({
    guildId,
    stripeCustomerId: customer ?? existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscription.id,
    status: subscription.status as BillingStatus,
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: Date.now(),
  });
}

async function processWebhook(event: Stripe.Event): Promise<void> {
  const seen = db().prepare('SELECT 1 FROM billing_events WHERE id = ?').get(event.id);
  if (seen) return;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const guildId = session.client_reference_id || session.metadata?.guildId || null;
      if (guildId && typeof session.subscription === 'string' && stripe) {
        recordSubscription(await stripe.subscriptions.retrieve(session.subscription), guildId);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      recordSubscription(event.data.object);
      break;
    default:
      // Other Stripe events are acknowledged but deliberately have no bearing
      // on access. Subscription lifecycle events remain the source of truth.
      break;
  }

  db()
    .prepare('INSERT OR IGNORE INTO billing_events (id, processed_at) VALUES (?, ?)')
    .run(event.id, Date.now());
}

/** Must be mounted before any JSON parser so Stripe can verify the raw bytes. */
export function mountBillingWebhook(app: express.Express): void {
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!stripe || !billingEnabled) return res.status(503).json({ error: 'Billing is not configured.' });
    const signature = req.header('stripe-signature');
    if (!signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Missing Stripe signature.' });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, config.billing.webhookSecret);
    } catch (err) {
      log.warn('Stripe webhook signature rejected:', (err as Error).message);
      return res.status(400).json({ error: 'Invalid Stripe signature.' });
    }

    try {
      await processWebhook(event);
      res.json({ received: true });
    } catch (err) {
      log.error('Stripe webhook failed:', err);
      res.status(500).json({ error: 'Webhook processing failed.' });
    }
  });
}

function getManagedGuild(req: Request, res: Response): { user: SessionUser; guild: NonNullable<ReturnType<typeof platform.getGuild>> } | null {
  const user = req.user as SessionUser;
  const guild = platform.getGuild(req.params.guildId);
  if (!guild) {
    res.status(404).json({ error: 'No such rig.' });
    return null;
  }
  if (!userMayManageBilling(user, guild.id)) {
    res.status(403).json({ error: 'Only the rig owner can manage its subscription.' });
    return null;
  }
  return { user, guild };
}

/** Signed-in customer routes. Stripe Checkout and Portal remain hosted by Stripe. */
export function mountBilling(app: express.Express): void {
  const requireBillingUser: express.RequestHandler = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    next();
  };

  app.get('/api/billing/:guildId', requireBillingUser, (req, res) => {
    const managed = getManagedGuild(req, res);
    if (!managed) return;
    res.json({ billing: billingSummary(managed.guild.id) });
  });

  app.post('/api/billing/:guildId/checkout', requireBillingUser, express.json({ limit: '4kb' }), async (req, res) => {
    const managed = getManagedGuild(req, res);
    if (!managed) return;
    if (!stripe || !billingEnabled) {
      return res.status(503).json({ error: 'Stripe has not been configured yet.' });
    }
    if (hasCloudEntitlement(managed.guild.id)) {
      return res.status(409).json({ error: 'This rig already has an active subscription.' });
    }
    const current = getBillingAccount(managed.guild.id);
    if (
      current?.stripeSubscriptionId &&
      current.status !== 'canceled' &&
      current.status !== 'incomplete_expired'
    ) {
      return res.status(409).json({
        error: 'Manage the existing subscription in Stripe before starting another one.',
      });
    }

    try {
      const price = await stripe.prices.retrieve(config.billing.priceId);
      if (
        !price.active ||
        price.unit_amount !== config.billing.monthlyPriceCents ||
        price.currency !== 'usd' ||
        price.recurring?.interval !== 'month' ||
        price.recurring.interval_count !== 1
      ) {
        throw new Error('STRIPE_PRICE_ID is not the configured $5 monthly Deck plan.');
      }

      let found = current;
      if (!found?.stripeCustomerId) {
        const customer = await stripe.customers.create({
          name: managed.guild.name,
          metadata: { guildId: managed.guild.id, discordOwnerId: managed.guild.createdBy },
        });
        found = {
          guildId: managed.guild.id,
          stripeCustomerId: customer.id,
          stripeSubscriptionId: found?.stripeSubscriptionId ?? null,
          status: found?.status ?? 'none',
          currentPeriodEnd: found?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: found?.cancelAtPeriodEnd ?? false,
          updatedAt: Date.now(),
        };
        saveBillingAccount(found);
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: found.stripeCustomerId as string,
        client_reference_id: managed.guild.id,
        line_items: [{ price: config.billing.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        metadata: { guildId: managed.guild.id },
        subscription_data: { metadata: { guildId: managed.guild.id } },
        success_url: `${config.http.publicUrl}/onboard?rig=${encodeURIComponent(managed.guild.slug)}&checkout=success`,
        cancel_url: `${config.http.publicUrl}/onboard?rig=${encodeURIComponent(managed.guild.slug)}&checkout=cancelled`,
      });
      if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
      res.json({ url: session.url });
    } catch (err) {
      log.error('could not create Stripe Checkout session:', err);
      res.status(502).json({ error: (err as Error).message || 'Could not start checkout.' });
    }
  });

  app.post('/api/billing/:guildId/portal', requireBillingUser, async (req, res) => {
    const managed = getManagedGuild(req, res);
    if (!managed) return;
    if (!stripe || !billingEnabled) {
      return res.status(503).json({ error: 'Stripe has not been configured yet.' });
    }
    const found = getBillingAccount(managed.guild.id);
    if (!found?.stripeCustomerId) {
      return res.status(409).json({ error: 'This rig does not have a billing account yet.' });
    }
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: found.stripeCustomerId,
        return_url: `${config.http.publicUrl}/onboard?rig=${encodeURIComponent(managed.guild.slug)}`,
      });
      res.json({ url: session.url });
    } catch (err) {
      log.error('could not create Stripe customer portal session:', err);
      res.status(502).json({ error: 'Could not open billing management.' });
    }
  });
}
