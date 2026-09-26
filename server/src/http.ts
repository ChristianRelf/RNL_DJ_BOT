import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import {
  attachUser,
  authorizeUrl,
  avatarUrl,
  checkAccess,
  clearSession,
  cookieNames,
  exchangeCode,
  issueSession,
  invalidateAccess,
  isPlatformAdmin,
  maySignIn,
  newState,
  readStateCookie,
  requirePlatformAdmin,
  requireUser,
  setStateCookie,
} from './auth';
import { BotError } from './discord/bots';
import { config } from './config';
import { rigs } from './rigManager';
import type { Rig } from './rig';
import * as platform from './db/platform';
import { createLogger } from './logger';
import { mountOnboarding } from './onboard';
import { mountRequests } from './requests';
import { DECK_IDS, type SessionUser } from './protocol';
import {
  cloudCacheMetrics,
  cloudUsage,
  confirmUpload,
  expirePendingCloudMedia,
  getCloudMedia,
  listCloudMedia,
  playbackUrl,
  prepareUpload,
  reconcileCloudMedia,
  recordCloudCacheMetrics,
  removeCloudMedia,
  spacesEnabled,
} from './cloudMedia';
import { billingSummary, getBillingAccount, mountBilling, mountBillingWebhook } from './billing';
import { renderSeoShell, seoForPath } from './seo';
import { mountBugReports, siteConfig } from './bugReports';

const log = createLogger('http');


/**
 * The request pages can issue a deliberately narrow listener session without
 * creating a full Deck account. Every other successful first sign-in creates a
 * self-service account that can proceed to onboarding and checkout.
 */
const REQUEST_PATH = /^\/(?:g\/)?[a-z0-9-]+\/request$|^\/request$/;
const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]{20,80})$/;


/**
 * Bot failures are mostly the operator's to fix - a bad token, a bot that has
 * not been invited - so those are reported as they came. Anything else is
 * logged and reduced to a generic message rather than risking a token or an
 * internal path in the response.
 */
function sendBotError(res: Response, err: unknown): void {
  if (err instanceof BotError) {
    res.status(400).json({ error: err.message });
    return;
  }
  log.error('bot management failed:', (err as Error).message);
  res.status(500).json({ error: 'That did not work - check the server log.' });
}

declare module 'express-serve-static-core' {
  interface Request {
    rig?: Rig;
  }
}

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  // Stripe signs the exact request bytes. Mount this before any middleware
  // that might parse or replace the body.
  mountBillingWebhook(app);
  if (spacesEnabled) {
    void expirePendingCloudMedia().catch((err) => log.warn('startup cloud cleanup failed:', err));
    const cleanup = setInterval(() => {
      void expirePendingCloudMedia().catch((err) => log.warn('scheduled cloud cleanup failed:', err));
    }, 60 * 60 * 1000);
    cleanup.unref();
  }
  app.use(cookieParser());
  app.use(attachUser);
  app.get('/api/site-config', siteConfig);
  mountBugReports(app);

  /**
   * The portal answers on its own hostname, but it is the same bundle and the
   * same session - so rather than a second build, the portal host simply lands
   * on the portal route. It stays reachable at /portal on the main host too,
   * which is what makes it work on localhost where there is no second name.
   */
  app.use((req, res, next) => {
    const host = req.hostname?.toLowerCase();
    if (!config.http.portalHost || host !== config.http.portalHost) return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
    if (req.path.startsWith('/portal')) return next();
    if (req.path.includes('.')) return next(); // built assets
    return res.redirect('/portal');
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rigs: rigs.count,
      voice: rigs.all.map((rig) => ({
        guildId: rig.guildId,
        status: rig.voice.snapshot().status,
        hosted: rig.host.hosted,
      })),
      uptime: process.uptime(),
      spaces: { enabled: spacesEnabled, cdn: config.spaces.publicCdn },
    });
  });

  // ------------------------------------------------------------- auth ---

  /**
   * `next` is where to land afterwards - the request page uses it, because
   * somebody who followed a link to ask for a track should end up back at that
   * rig's page and not at a console they cannot open. Only same-site paths are
   * kept; anything else is dropped and they go to the front door.
   */
  app.get('/api/auth/login', (req, res) => {
    const state = newState();
    const wanted = String(req.query.next ?? '');
    setStateCookie(res, state, /^\/(?!\/)[\w\-/]*$/.test(wanted) ? wanted : undefined);
    res.redirect(authorizeUrl(state));
  });

  app.get('/api/auth/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const { state: expected, next } = readStateCookie(req.cookies?.[cookieNames.state]);
    res.clearCookie(cookieNames.state, { path: '/' });

    // Failures go back to /login rather than /, so the reason lands beside the
    // button that failed instead of on the marketing page.
    if (error) return res.redirect(`/login?error=${encodeURIComponent(error)}`);
    if (!code || !state || !expected || state !== expected) {
      return res.redirect('/login?error=' + encodeURIComponent('Login state mismatch - try again.'));
    }

    try {
      const { profile } = await exchangeCode(code);
      const fallbackName = profile.global_name || profile.username;

      const user: SessionUser = {
        id: profile.id,
        username: profile.username,
        displayName: fallbackName,
        avatarUrl: avatarUrl(profile),
        isAdmin: false,
        isPlatformAdmin: isPlatformAdmin(profile.id),
      };

      // An invite is redeemed only after Discord has identified the recipient.
      // It admits them to the platform and may additionally grant one rig.
      const inviteToken = next?.match(INVITE_PATH)?.[1];
      if (inviteToken) {
        const invite = platform.redeemInvite(inviteToken, user.id);
        if (!invite) return res.redirect('/login?error=' + encodeURIComponent('That invite has expired or was already used.'));
        platform.allow({ discordId: user.id, note: invite.note || 'Accepted an invite', canOnboard: false, addedBy: invite.createdBy });
        if (invite.guildId) invalidateAccess(invite.guildId, user.id);
        issueSession(res, user);
        const guild = invite.guildId ? platform.getGuild(invite.guildId) : null;
        return res.redirect(guild ? `/g/${guild.slug}/deck` : '/rigs');
      }

      // A request-page visitor needs only a narrow listener session and does
      // not need a Deck account. Everywhere else is self-service: the first
      // successful Discord sign-in creates an active account with onboarding
      // enabled. An explicit suspension is never overwritten by signing in.
      if (!maySignIn(profile.id)) {
        const account = platform.isAllowed(profile.id);
        if (!account && next && REQUEST_PATH.test(next)) {
          issueSession(res, user, 'listener');
          log.info(`${user.displayName} signed in to ask for a track`);
          return res.redirect(next);
        }
        if (account?.status === 'suspended') {
          return res.redirect(
            '/login?error=' + encodeURIComponent('This Deck account has been suspended.'),
          );
        }

        platform.allow({
          discordId: user.id,
          note: 'Self-service signup',
          canOnboard: true,
          addedBy: user.id,
        });
        log.info(`${user.displayName} created a self-service Deck account`);
      }

      if (!maySignIn(profile.id)) {
        return res.redirect(
          '/login?error=' +
            encodeURIComponent('This Discord account cannot use Deck.'),
        );
      }

      issueSession(res, user);
      log.info(`${user.displayName} signed in`);
      res.redirect(next ?? '/rigs');
    } catch (err) {
      log.warn('login failed:', (err as Error).message);
      res.redirect('/login?error=' + encodeURIComponent((err as Error).message));
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: req.user, publicUrl: config.http.publicUrl });
  });

  app.get('/api/invites/:token', (req, res) => {
    const invite = platform.getInviteByToken(req.params.token);
    if (!invite || invite.usedAt || invite.expiresAt <= Date.now()) {
      return res.status(404).json({ error: 'That invite has expired or was already used.' });
    }
    const guild = invite.guildId ? platform.getGuild(invite.guildId) : null;
    res.json({ invite: { note: invite.note, expiresAt: invite.expiresAt, guild: guild ? { name: guild.name, slug: guild.slug } : null } });
  });

  /** Which rigs this person can actually open, for the picker after sign-in. */
  app.get('/api/rigs', requireUser, async (req, res) => {
    const user = req.user as SessionUser;
    const found = await Promise.all(
      platform.listGuilds().map(async (guild) => {
        if (guild.status !== 'active') return null;
        const access = await checkAccess(guild.id, user.id, user.displayName);
        if (!access.allowed) return null;
        const rig = rigs.get(guild.id);
        return {
          id: guild.id,
          slug: guild.slug,
          name: guild.name,
          isAdmin: access.isAdmin,
          running: rig !== null,
          hosted: rig?.host.hosted ?? false,
          live: rig?.voice.snapshot().status === 'ready',
        };
      }),
    );
    res.json({ rigs: found.filter(Boolean) });
  });

  mountBilling(app);
  mountOnboarding(app);
  mountRequests(app);

  // Old clients should fail clearly instead of quietly creating a request that
  // nobody needs to approve now that Deck is available through self-service.
  app.post('/api/waitlist', express.json({ limit: '4kb' }), (_req, res) => {
    res.status(410).json({
      error: 'Deck is available now. Sign in with Discord to connect a server and subscribe.',
    });
  });

  // ----------------------------------------------------------- portal ---

  const json = express.json({ limit: '8kb' });

  app.get('/api/portal/overview', requirePlatformAdmin, (_req, res) => {
    res.json({
      guilds: platform.listGuilds().map((guild) => {
        const rig = rigs.get(guild.id);
        const voice = rig?.voice.snapshot();
        return {
          ...guild,
          running: rig !== null,
          host: rig?.host.snapshot() ?? null,
          voice: voice ? { status: voice.status, channelName: voice.channelName } : null,
          bot: rig?.bots.active() ?? null,
          tracks: rig ? rig.store.listMedia().length : 0,
          billing: billingSummary(guild.id),
          cloud: cloudUsage(guild.id),
          cacheMetrics: cloudCacheMetrics(guild.id),
        };
      }),
      allowlist: platform.listAllowed(),
      waitlist: platform.listWaitlist(),
      invites: platform.listInvites(),
      bots: platform.listBots().map((bot) => ({
        id: bot.id,
        name: bot.name,
        applicationId: bot.applicationId,
        tag: bot.tag,
        fingerprint: bot.fingerprint,
        addedBy: bot.addedBy,
        addedAt: bot.addedAt,
      })),
      health: {
        rigs: rigs.count,
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        uptime: Math.round(process.uptime()),
      },
    });
  });

  app.post('/api/portal/allow', requirePlatformAdmin, json, (req, res) => {
    const discordId = String(req.body?.discordId ?? '').trim();
    if (!/^\d{15,25}$/.test(discordId)) {
      return res.status(400).json({ error: 'That does not look like a Discord user id.' });
    }
    platform.allow({
      discordId,
      note: String(req.body?.note ?? '').slice(0, 200),
      canOnboard: req.body?.canOnboard !== false,
      addedBy: (req.user as SessionUser).id,
    });
    res.json({ allowlist: platform.listAllowed() });
  });

  app.patch('/api/portal/allow/:id', requirePlatformAdmin, json, (req, res) => {
    const status = req.body?.status;
    if (status !== undefined && status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'Account status must be active or suspended.' });
    }
    const updated = platform.updateAllowed(req.params.id, {
      ...(typeof req.body?.note === 'string' ? { note: req.body.note.trim() } : {}),
      ...(typeof req.body?.canOnboard === 'boolean' ? { canOnboard: req.body.canOnboard } : {}),
      ...(status ? { status } : {}),
    });
    if (!updated) return res.status(404).json({ error: 'No such account.' });
    res.json({ account: updated, allowlist: platform.listAllowed() });
  });

  app.delete('/api/portal/allow/:id', requirePlatformAdmin, (req, res) => {
    platform.disallow(req.params.id);
    res.json({ allowlist: platform.listAllowed() });
  });

  app.delete('/api/portal/waitlist/:id', requirePlatformAdmin, (req, res) => {
    platform.removeWaitlist(req.params.id);
    res.json({ waitlist: platform.listWaitlist() });
  });

  app.post('/api/portal/cloud/reconcile', requirePlatformAdmin, json, async (req, res) => {
    try {
      res.json({ report: await reconcileCloudMedia(req.body?.apply === true) });
    } catch (err) {
      log.error('cloud reconciliation failed:', err);
      res.status(502).json({ error: (err as Error).message || 'Could not reconcile Deck Cloud.' });
    }
  });

  app.post('/api/portal/invites', requirePlatformAdmin, json, (req, res) => {
    const guildId = typeof req.body?.guildId === 'string' && platform.getGuild(req.body.guildId) ? req.body.guildId : null;
    const days = Math.min(30, Math.max(1, Number(req.body?.days) || 7));
    const created = platform.createInvite({ guildId, note: String(req.body?.note ?? '').trim().slice(0, 160),
      createdBy: (req.user as SessionUser).id, expiresAt: Date.now() + days * 86400000 });
    res.json({ invite: created.invite, url: `${config.http.publicUrl}/invite/${created.token}` });
  });

  app.get('/api/portal/invites', requirePlatformAdmin, (_req, res) => {
    res.json({ invites: platform.listInvites() });
  });

  app.delete('/api/portal/invites/:id', requirePlatformAdmin, (req, res) => {
    platform.revokeInvite(req.params.id);
    res.json({ ok: true });
  });

  const portalRig = async (id: string): Promise<Rig | null> => rigs.ensure(id);

  app.get('/api/portal/rigs/:id/bots', requirePlatformAdmin, async (req, res) => {
    const rig = await portalRig(req.params.id);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    res.json({ bots: rig.bots.list(), active: rig.bots.active() });
  });

  app.post('/api/portal/rigs/:id/bots', requirePlatformAdmin, json, async (req, res) => {
    const rig = await portalRig(req.params.id);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    try {
      await rig.bots.add(req.user as SessionUser, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        token: typeof req.body?.token === 'string' ? req.body.token : '',
      });
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) { sendBotError(res, err); }
  });

  app.post('/api/portal/rigs/:id/bots/:botId/activate', requirePlatformAdmin, async (req, res) => {
    const rig = await portalRig(req.params.id);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    try {
      await rig.bots.activate(req.user as SessionUser, req.params.botId);
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) { sendBotError(res, err); }
  });

  app.delete('/api/portal/rigs/:id/bots/:botId', requirePlatformAdmin, async (req, res) => {
    const rig = await portalRig(req.params.id);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    try {
      await rig.bots.remove(req.user as SessionUser, req.params.botId);
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) { sendBotError(res, err); }
  });

  app.post('/api/portal/rigs/:id/stop', requirePlatformAdmin, async (req, res) => {
    await rigs.stop(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/portal/rigs/:id/start', requirePlatformAdmin, async (req, res) => {
    const rig = await rigs.ensure(req.params.id);
    res.json({ ok: rig !== null });
  });

  app.patch('/api/portal/rigs/:id', requirePlatformAdmin, json, async (req, res) => {
    const guild = platform.getGuild(req.params.id);
    if (!guild) return res.status(404).json({ error: 'No such rig.' });
    const status = req.body?.status;
    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'Rig status must be active or suspended.' });
    }
    platform.updateGuild(guild.id, { status });
    invalidateAccess(guild.id);
    if (status === 'suspended') await rigs.stop(guild.id);
    else await rigs.ensure(guild.id);
    res.json({ guild: platform.getGuild(guild.id) });
  });

  app.delete('/api/portal/rigs/:id', requirePlatformAdmin, async (req, res) => {
    const billing = getBillingAccount(req.params.id);
    if (billing?.status === 'active' || billing?.status === 'trialing') {
      return res.status(409).json({
        error: 'Cancel this rig\'s active Stripe subscription before deleting it.',
      });
    }
    await rigs.stop(req.params.id);
    platform.deleteGuild(req.params.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------ guild scope ---

  /**
   * Everything below here belongs to one rig.
   *
   * The guild is resolved and the caller's access to it re-checked on every
   * request rather than trusted from the session - losing a DJ role has to take
   * effect on the next request, not whenever the token happens to expire.
   */
  async function withRig(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }

    const rig = await rigs.ensure(req.params.guildId);
    if (!rig) {
      res.status(404).json({ error: 'No such rig, or it is not running.' });
      return;
    }

    const access = await checkAccess(rig.guildId, user.id, user.displayName);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason ?? 'You do not have access to that rig.' });
      return;
    }

    req.rig = rig;
    req.user = { ...user, displayName: access.displayName, isAdmin: access.isAdmin };
    next();
  }

  const guild = express.Router({ mergeParams: true });
  guild.use((req, res, next) => void withRig(req, res, next));

  guild.get('/media', (req, res) => {
    res.json({ media: (req.rig as Rig).store.listMedia() });
  });

  guild.get('/cloud', async (req, res) => {
    const rig = req.rig as Rig;
    await expirePendingCloudMedia().catch((err) => log.warn('pending cloud cleanup failed:', err));
    res.json({ enabled: spacesEnabled, cdn: config.spaces.publicCdn, media: listCloudMedia(rig.guildId),
      quota: cloudUsage(rig.guildId), billing: billingSummary(rig.guildId),
      cacheMetrics: cloudCacheMetrics(rig.guildId) });
  });

  guild.post('/cloud/upload', express.json({ limit: '8kb' }), async (req, res) => {
    if (!spacesEnabled) return res.status(503).json({ error: 'The cloud library is not configured.' });
    const name = String(req.body?.name ?? '').trim().slice(0, 240);
    const sizeBytes = Number(req.body?.sizeBytes);
    const contentType = String(req.body?.contentType ?? 'application/octet-stream').trim().slice(0, 120);
    const sha256 = String(req.body?.sha256 ?? '').trim().toLowerCase();
    if (!name || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > config.spaces.maxObjectBytes) {
      return res.status(400).json({ error: `Choose a file no larger than ${Math.round(config.spaces.maxObjectBytes / 1048576)} MB.` });
    }
    if (!/^(audio|video)\//.test(contentType)) return res.status(400).json({ error: 'Only audio or video media can be stored.' });
    if (!/^[a-f0-9]{64}$/.test(sha256)) return res.status(400).json({ error: 'The file hash is missing or invalid.' });
    try {
      res.json(await prepareUpload((req.rig as Rig).guildId, (req.user as SessionUser).id, name, sizeBytes, contentType, sha256));
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('storage limit')) return res.status(413).json({ error: message });
      if (message.includes('subscription')) return res.status(402).json({ error: message });
      if (message.includes('already in progress')) return res.status(409).json({ error: message });
      log.error('cloud upload preparation failed:', err);
      res.status(502).json({ error: 'Could not prepare cloud storage.' });
    }
  });

  guild.post('/cloud/:id/complete', async (req, res) => {
    const item = getCloudMedia((req.rig as Rig).guildId, req.params.id);
    if (!item) return res.status(404).json({ error: 'No such cloud media.' });
    if (item.createdBy !== (req.user as SessionUser).id && !(req.user as SessionUser).isAdmin) return res.status(403).json({ error: 'That upload is not yours.' });
    try { res.json({ item: await confirmUpload(item) }); }
    catch (err) { res.status(400).json({ error: (err as Error).message }); }
  });

  guild.get('/cloud/:id/url', async (req, res) => {
    const item = getCloudMedia((req.rig as Rig).guildId, req.params.id);
    if (!item) return res.status(404).json({ error: 'No such cloud media.' });
    try { res.json({ url: await playbackUrl(item), expiresIn: config.spaces.publicCdn ? null : 600,
      etag: item.etag, sizeBytes: item.sizeBytes, acceptRanges: true,
      delivery: config.spaces.publicCdn ? 'cdn' : 'origin' }); }
    catch (err) { res.status(400).json({ error: (err as Error).message }); }
  });

  guild.post('/cloud/cache-metrics', express.json({ limit: '4kb' }), (req, res) => {
    recordCloudCacheMetrics((req.rig as Rig).guildId, req.body ?? {});
    res.status(204).end();
  });

  guild.delete('/cloud/:id', async (req, res) => {
    const item = getCloudMedia((req.rig as Rig).guildId, req.params.id);
    if (!item) return res.status(404).json({ error: 'No such cloud media.' });
    const user = req.user as SessionUser;
    if (item.createdBy !== user.id && !user.isAdmin) return res.status(403).json({ error: 'That file is not yours to remove.' });
    try { await removeCloudMedia(item); res.json({ ok: true }); }
    catch (err) { log.error('cloud delete failed:', err); res.status(502).json({ error: 'Could not remove that cloud file.' }); }
  });

  guild.get('/invites', (req, res) => {
    const user = req.user as SessionUser;
    if (!user.isAdmin) return res.status(403).json({ error: 'Only a rig owner or admin can invite DJs.' });
    const rig = req.rig as Rig;
    res.json({ invites: platform.listInvites(rig.guildId), members: platform.listGuildMembers(rig.guildId) });
  });

  guild.post('/invites', json, (req, res) => {
    const user = req.user as SessionUser;
    if (!user.isAdmin) return res.status(403).json({ error: 'Only a rig owner or admin can invite DJs.' });
    const rig = req.rig as Rig;
    const days = Math.min(30, Math.max(1, Number(req.body?.days) || 7));
    const created = platform.createInvite({ guildId: rig.guildId, note: String(req.body?.note ?? '').trim().slice(0, 160),
      createdBy: user.id, expiresAt: Date.now() + days * 86400000 });
    res.json({ invite: created.invite, url: `${config.http.publicUrl}/invite/${created.token}` });
  });

  guild.delete('/invites/:id', (req, res) => {
    const user = req.user as SessionUser;
    if (!user.isAdmin) return res.status(403).json({ error: 'Only a rig owner or admin can revoke invitations.' });
    const rig = req.rig as Rig;
    const invite = platform.listInvites(rig.guildId).find((entry) => entry.id === req.params.id);
    if (!invite) return res.status(404).json({ error: 'No such invitation.' });
    platform.revokeInvite(invite.id);
    res.json({ ok: true });
  });

  guild.delete('/members/:id', (req, res) => {
    const user = req.user as SessionUser;
    if (!user.isAdmin) return res.status(403).json({ error: 'Only a rig owner or admin can remove invited DJs.' });
    const rig = req.rig as Rig;
    platform.removeGuildMember(rig.guildId, req.params.id);
    invalidateAccess(rig.guildId, req.params.id);
    res.json({ ok: true });
  });

  /**
   * Serves a decoded upload so a DJ can pre-listen without touching the mix.
   *
   * Only ever finds anything for a track that came in through an upload; one
   * played off somebody's folder is already on their machine, and the console
   * cues it locally without asking the server for it at all.
   */
  /**
   * Which Discord account this rig plays through.
   *
   * On HTTP rather than the socket deliberately: the socket broadcasts state to
   * every signed-in DJ, and this is platform-admin territory - adding a bot
   * means handing the server a token. Tokens are never returned, only
   * fingerprints.
   */
  guild.get('/bots', requirePlatformAdmin, (req, res) => {
    const rig = req.rig as Rig;
    res.json({ bots: rig.bots.list(), active: rig.bots.active() });
  });

  guild.post('/bots', requirePlatformAdmin, json, async (req, res) => {
    const rig = req.rig as Rig;
    try {
      const added = await rig.bots.add(req.user as SessionUser, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        token: typeof req.body?.token === 'string' ? req.body.token : '',
      });
      res.json({ bot: added, bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) {
      sendBotError(res, err);
    }
  });

  guild.post('/bots/:id/activate', requirePlatformAdmin, async (req, res) => {
    const rig = req.rig as Rig;
    try {
      await rig.bots.activate(req.user as SessionUser, req.params.id);
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) {
      sendBotError(res, err);
    }
  });

  guild.delete('/bots/:id', requirePlatformAdmin, async (req, res) => {
    const rig = req.rig as Rig;
    try {
      await rig.bots.remove(req.user as SessionUser, req.params.id);
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) {
      sendBotError(res, err);
    }
  });

  app.use('/api/g/:guildId', guild);

  // ------------------------------------------------------------ tools ---

  /**
   * Live deck positions for lighting desks, overlays and video.
   *
   * Consumers of this cannot hold a Discord session, so the key in the query
   * string is the credential. It is rotated every time the tool is switched on,
   * and the endpoint disappears entirely when it is off.
   */
  app.get('/api/g/:guildId/timecode', (req, res) => {
    const rig = rigs.get(req.params.guildId);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    const billing = billingSummary(req.params.guildId);
    if (billing.configured && !billing.entitled) {
      return res.status(402).json({ error: 'The rig subscription is inactive.' });
    }

    const tools = rig.store.db.tools;
    if (!tools.timecode) return res.status(404).json({ error: 'The timecode feed is off.' });

    const supplied = String(req.query.key ?? '');
    const expected = tools.timecodeKey;
    // Compared over fixed-length digests so a wrong key cannot be narrowed down
    // by timing the response.
    const ok =
      expected.length > 0 &&
      crypto.timingSafeEqual(
        crypto.createHash('sha256').update(supplied).digest(),
        crypto.createHash('sha256').update(expected).digest(),
      );
    if (!ok) return res.status(403).json({ error: 'Bad or missing key.' });

    const state = rig.state();
    res.setHeader('cache-control', 'no-store');
    res.setHeader('access-control-allow-origin', '*');
    res.json({
      serverTime: state.serverTime,
      decks: DECK_IDS.map((id) => {
        const deck = state.decks[id];
        return {
          deck: id,
          mediaId: deck.mediaId,
          title: deck.title,
          playing: deck.playing,
          positionMs: deck.positionMs,
          durationMs: deck.durationMs,
          remainingMs: Math.max(0, deck.durationMs - deck.positionMs),
          rate: deck.rate,
          bpm: deck.bpm === null ? null : deck.bpm * deck.rate,
        };
      }),
      mixer: { crossfader: state.mixer.crossfader, master: state.mixer.master },
      voice: { status: state.voice.status, channelName: state.voice.channelName },
    });
  });

  // ----------------------------------------------------------- static ---

  const webDist = config.paths.webDist;
  if (fs.existsSync(webDist)) {
    // The product page is the canonical public front door. Authentication has
    // its own stable URL at /login, so adverts can safely point at the bare host.
    app.get('/', (_req, res) => res.redirect(301, '/home'));

    // Consolidate old public paths rather than asking search engines to infer
    // which spelling should rank. The SPA keeps the aliases as a client-side
    // fallback for development and static previews.
    const canonicalRedirects: Record<string, string> = {
      '/home/license': '/home/access',
      '/license': '/home/access',
      '/home/guides': '/home/help',
      '/home/guide': '/home/help',
      '/guide': '/home/help',
      '/home/blog': '/blog',
      '/writing': '/blog',
      '/cookie-policy': '/cookies',
      '/accessibility-statement': '/accessibility',
      '/a11y': '/accessibility',
    };
    for (const [from, to] of Object.entries(canonicalRedirects)) {
      app.get(from, (_req, res) => res.redirect(301, to));
    }

    const webShell = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('cache-control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();

      // A hashed asset express.static did not find is gone, not a route. Falling
      // through to index.html answers a stylesheet or module request with HTML,
      // which the browser refuses on the MIME mismatch - the page renders
      // unstyled, or blank, with nothing but 200s in the network log. A browser
      // holding index.html from an earlier build asks for exactly these, so let
      // it have the 404 and fetch the shell again.
      if (req.path.startsWith('/assets/')) return next();

      // The shell names the current build's hashed assets, so it has to be
      // revalidated every load; the assets it points at stay immutable.
      const seo = seoForPath(req.path);
      const missingArticle = /^\/blog\/[^/]+$/.test(req.path) && !seo.index;
      if (!seo.index) res.set('x-robots-tag', 'noindex, nofollow');
      res
        .status(missingArticle ? 404 : 200)
        .type('html')
        .set('content-language', 'en-GB')
        .set('cache-control', 'no-cache')
        .send(renderSeoShell(webShell, req.path));
    });
  } else {
    log.warn(`web build not found at ${webDist} - run "npm run build -w web"`);
    app.get('/', (_req, res) => {
      res.status(503).send('Web UI has not been built yet. Run: npm run build -w web');
    });
  }

  app.use((
    err: Error & { code?: string; type?: string },
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `Files must be under ${config.http.maxUploadBytes / 1048576} MB.` });
      return;
    }
    // A body past the JSON limit is the sender's to fix, and saying so beats
    // the 500 it would otherwise fall through to.
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'That was too long - shorten it and try again.' });
      return;
    }
    log.error('unhandled http error:', err?.message ?? err);
    res.status(500).json({ error: 'Internal error.' });
  });

  return app;
}
