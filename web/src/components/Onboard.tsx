import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Cloud,
  CreditCard,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { SitePage } from './SiteNav';

const PURCHASE_TERMS_VERSION = '2026-09-26';

interface BillingSummary {
  configured: boolean;
  status: string;
  entitled: boolean;
  customer: boolean;
  subscription: boolean;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  plan: { amountCents: number; currency: 'usd'; interval: 'month'; storageBytes: number };
}

interface OnboardRig {
  id: string;
  slug: string;
  name: string;
  createdBy: string;
  billing: BillingSummary;
}

interface OnboardState {
  mayOnboard: boolean;
  billingRequired: boolean;
  rigs: OnboardRig[];
}

interface Role {
  id: string;
  name: string;
  color: number;
  isEveryone: boolean;
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

function roleColour(color: number): string | undefined {
  return color ? `#${color.toString(16).padStart(6, '0')}` : undefined;
}

function bytes(value: number): string {
  return `${(value / 1024 ** 3).toFixed(value % 1024 ** 3 === 0 ? 0 : 1)} GB`;
}

function BillingBadge({ billing }: { billing: BillingSummary }) {
  const label = billing.entitled
    ? billing.cancelAtPeriodEnd
      ? 'Active · cancels at period end'
      : 'Active'
    : billing.status === 'past_due' || billing.status === 'unpaid'
      ? 'Payment needs attention'
      : 'Subscription required';
  return <span className={`onboard-billing-badge ${billing.entitled ? 'is-ready' : ''}`}>{label}</span>;
}

function Steps({ current, billingRequired }: { current: number; billingRequired: boolean }) {
  const items = [
    { label: 'Connect Discord', icon: Server },
    ...(billingRequired ? [{ label: 'Choose plan', icon: CreditCard }] : []),
    { label: 'Set access', icon: ShieldCheck },
    { label: 'Open console', icon: SlidersHorizontal },
  ];
  return (
    <ol className="onboard-progress" aria-label="Setup progress">
      {items.map((item, index) => {
        const Icon = item.icon;
        const done = index < current;
        const active = index === current;
        return (
          <li key={item.label} className={`${done ? 'is-done' : ''}${active ? ' is-active' : ''}`}>
            <span>{done ? <Check size={14} /> : <Icon size={14} />}</span>
            <strong>{item.label}</strong>
          </li>
        );
      })}
    </ol>
  );
}

export function Onboard() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('rig');
  const gateMissing = params.get('gate') === 'missing';
  const checkout = params.get('checkout');

  const [state, setState] = useState<OnboardState | null>(null);
  const [error, setError] = useState<string | null>(params.get('error'));

  useEffect(() => {
    api('/api/onboard/state')
      .then(setState)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error && !state) {
    return (
      <div className="boot">
        <AlertTriangle size={18} />
        <p>{error}</p>
        <a className="btn" href="/login">Sign in</a>
      </div>
    );
  }

  if (!state) {
    return <div className="boot"><div className="boot-spinner" /><p>loading</p></div>;
  }

  return (
    <SitePage>
      <div className="onboard onboard-v2">
        {error && <p className="onboard-error"><AlertTriangle size={13} /> {error}</p>}

        {!state.mayOnboard ? (
          <section className="onboard-step">
            <h1 className="onboard-title">Your account is ready, but rig creation is off</h1>
            <p className="onboard-body">
              A platform admin can enable rig creation for your account. If you are bringing a new
              community to Deck, <a href="/home/access">send an access request</a>.
            </p>
          </section>
        ) : slug ? (
          <Configure
            state={state}
            slug={slug}
            gateMissing={gateMissing}
            checkout={checkout}
            onError={setError}
          />
        ) : (
          <Invite existing={state.rigs.length} billingRequired={state.billingRequired} />
        )}
      </div>
    </SitePage>
  );
}

function Invite({ existing, billingRequired }: { existing: number; billingRequired: boolean }) {
  return (
    <section className="onboard-step onboard-welcome">
      <Steps current={0} billingRequired={billingRequired} />
      <span className="onboard-kicker">NEW RIG</span>
      <h1 className="onboard-title">Bring your Discord room on air</h1>
      <p className="onboard-body">
        Connect Deck to a server, choose who can operate it, and run a quick readiness check before
        the first set. Discord&rsquo;s own server picker keeps IDs and permissions out of the form.
      </p>

      <div className="onboard-permissions">
        <span><Check size={13} /> View channels</span>
        <span><Check size={13} /> Connect</span>
        <span><Check size={13} /> Speak</span>
      </div>

      <a className="btn btn-primary btn-large" href="/api/onboard/invite">
        <Plus size={15} /> Connect a Discord server
      </a>

      {existing > 0 && <p className="onboard-note">Already set one up? <a href="/rigs">Open your rigs</a>.</p>}
    </section>
  );
}

function Configure({
  state,
  slug,
  gateMissing,
  checkout,
  onError,
}: {
  state: OnboardState;
  slug: string;
  gateMissing: boolean;
  checkout: string | null;
  onError: (message: string | null) => void;
}) {
  const initialRig = state.rigs.find((entry) => entry.slug === slug);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [name, setName] = useState(initialRig?.name ?? '');
  const [rigSlug, setRigSlug] = useState(initialRig?.slug ?? '');
  const [djRole, setDjRole] = useState('');
  const [adminRole, setAdminRole] = useState('');
  const [billing, setBilling] = useState<BillingSummary | null>(initialRig?.billing ?? null);
  const [saving, setSaving] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [acceptedPurchaseTerms, setAcceptedPurchaseTerms] = useState(false);

  const guildId = initialRig?.id;
  const billingReady = !state.billingRequired || Boolean(billing?.entitled);
  const rolesReady = roles !== null;
  const currentStep = state.billingRequired && !billingReady ? 1 : rolesReady ? (state.billingRequired ? 2 : 1) : 1;

  const refreshBilling = useCallback(async () => {
    if (!guildId) return;
    const body = await api(`/api/billing/${guildId}`);
    setBilling(body.billing);
  }, [guildId]);

  useEffect(() => {
    if (!guildId) return;
    api(`/api/onboard/roles/${guildId}`)
      .then((body: { roles: Role[]; guild: { name: string }; djRoleIds: string[]; adminRoleIds: string[] }) => {
        setRoles(body.roles.filter((role) => !role.isEveryone));
        setName((current) => current || body.guild.name);
        setDjRole(body.djRoleIds[0] ?? '');
        setAdminRole(body.adminRoleIds[0] ?? '');
      })
      .catch((err: Error) => onError(err.message));
  }, [guildId, onError]);

  useEffect(() => {
    if (checkout !== 'success' || billingReady || !guildId) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void refreshBilling().catch(() => undefined);
      if (attempts >= 15) window.clearInterval(timer);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [checkout, billingReady, guildId, refreshBilling]);

  const cleanSlug = useMemo(
    () => rigSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40),
    [rigSlug],
  );

  const openStripe = async (kind: 'checkout' | 'portal') => {
    if (!guildId || billingBusy) return;
    if (kind === 'checkout' && !acceptedPurchaseTerms) {
      onError('Accept the recurring purchase terms before continuing to Stripe.');
      return;
    }
    setBillingBusy(true);
    try {
      const body = await api(`/api/billing/${guildId}/${kind}`, {
        method: 'POST',
        ...(kind === 'checkout'
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                termsVersion: PURCHASE_TERMS_VERSION,
                immediateService: true,
              }),
            }
          : {}),
      });
      window.location.assign(body.url);
    } catch (err) {
      onError((err as Error).message);
      setBillingBusy(false);
    }
  };

  const finish = useCallback(() => {
    if (!guildId || saving || !billingReady) return;
    setSaving(true);
    void api('/api/onboard/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guildId,
        name,
        slug: cleanSlug,
        djRoleIds: djRole ? [djRole] : [],
        adminRoleIds: adminRole ? [adminRole] : [],
      }),
    })
      .then((body: { slug: string }) => { window.location.href = `/g/${body.slug}/deck`; })
      .catch((err: Error) => { onError(err.message); setSaving(false); });
  }, [guildId, saving, billingReady, name, cleanSlug, djRole, adminRole, onError]);

  if (!initialRig) {
    return (
      <section className="onboard-step">
        <h1 className="onboard-title">We&rsquo;re finishing the connection</h1>
        <p className="onboard-body">Give Discord a moment, then <a href={`/onboard?rig=${slug}`}>check again</a>.</p>
      </section>
    );
  }

  return (
    <section className="onboard-step onboard-configure">
      <Steps current={currentStep} billingRequired={state.billingRequired} />
      <div className="onboard-heading-row">
        <div>
          <span className="onboard-kicker">CONNECTED</span>
          <h1 className="onboard-title"><Check size={18} className="onboard-tick" /> {initialRig.name}</h1>
        </div>
        {billing && <BillingBadge billing={billing} />}
      </div>

      {gateMissing && (
        <p className="onboard-warn"><AlertTriangle size={13} /> Deck cannot read the server yet. Check the bot is still present, then reload.</p>
      )}
      {checkout === 'success' && !billingReady && (
        <p className="onboard-note"><Loader2 size={13} className="spin" /> Confirming the subscription with Stripe&hellip;</p>
      )}
      {checkout === 'cancelled' && <p className="onboard-note">Checkout was cancelled. Nothing was charged.</p>}

      {state.billingRequired && billing && (
        <article className={`onboard-plan ${billing.entitled ? 'is-ready' : ''}`}>
          <div>
            <span className="onboard-kicker">DECK CLOUD PLAN</span>
            <h2>${(billing.plan.amountCents / 100).toFixed(0)} <small>/ month</small></h2>
            <p>{bytes(billing.plan.storageBytes)} private cloud storage, all console modules, integrations, and multi-screen control.</p>
          </div>
          <ul>
            <li><Check size={13} /> Direct-to-cloud uploads</li>
            <li><Check size={13} /> Cancel any time in Stripe</li>
            <li><Check size={13} /> Card data never reaches Deck</li>
          </ul>
          {!billing.entitled && (
            <label className="onboard-plan-consent">
              <input
                type="checkbox"
                checked={acceptedPurchaseTerms}
                onChange={(event) => setAcceptedPurchaseTerms(event.target.checked)}
              />
              <span>
                I am 18 or authorised by the payer. I agree to a recurring $5 USD monthly charge,
                the <a href="/terms" target="_blank" rel="noreferrer">Deck Terms</a>, and immediate
                provision of the service during any cancellation period.
              </span>
            </label>
          )}
          <div className="onboard-plan-actions">
            {billing.entitled || billing.customer ? (
              <button type="button" className="btn" onClick={() => void openStripe('portal')} disabled={billingBusy}>
                {billingBusy ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />} Manage billing
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void openStripe('checkout')} disabled={billingBusy || !acceptedPurchaseTerms}>
                {billingBusy ? <Loader2 size={14} className="spin" /> : <CreditCard size={14} />} Subscribe securely
              </button>
            )}
            {!billing.entitled && billing.customer && (!billing.subscription || billing.status === 'canceled' || billing.status === 'incomplete_expired') && (
              <button type="button" className="btn btn-primary" onClick={() => void openStripe('checkout')} disabled={billingBusy || !acceptedPurchaseTerms}>
                Subscribe
              </button>
            )}
            <button type="button" className="btn btn-small" onClick={() => void refreshBilling()} title="Refresh billing status">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {!billing.entitled && (
            <p className="onboard-plan-legal">
              Stripe shows the final amount before charging. Continuing starts a recurring $5 USD
              monthly subscription and asks us to provision the service immediately. See the{' '}
              <a href="/terms" target="_blank" rel="noreferrer">Terms, cancellation and refund details</a>{' '}
              and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </p>
          )}
        </article>
      )}

      <div className="onboard-form-grid">
        <label className="onboard-field">
          <span>Rig name</span>
          <input className="input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="onboard-field">
          <span>Console URL</span>
          <div className="onboard-slug"><span>/g/</span><input className="input mono" value={rigSlug} onChange={(event) => setRigSlug(event.target.value)} /><span>/deck</span></div>
        </label>
        <label className="onboard-field">
          <span>Who can DJ</span>
          <select className="input" value={djRole} onChange={(event) => setDjRole(event.target.value)}>
            <option value="">Anyone in the server</option>
            {(roles ?? []).map((role) => <option key={role.id} value={role.id} style={{ color: roleColour(role.color) }}>{role.name}</option>)}
          </select>
        </label>
        <label className="onboard-field">
          <span>Who can force a takeover</span>
          <select className="input" value={adminRole} onChange={(event) => setAdminRole(event.target.value)}>
            <option value="">Only the server owner</option>
            {(roles ?? []).map((role) => <option key={role.id} value={role.id} style={{ color: roleColour(role.color) }}>{role.name}</option>)}
          </select>
        </label>
      </div>

      <div className="onboard-readiness">
        <h2>Launch check</h2>
        <span className="is-ready"><Check size={13} /> Discord connected</span>
        <span className={billingReady ? 'is-ready' : ''}>{billingReady ? <Check size={13} /> : <CreditCard size={13} />} Deck Cloud plan</span>
        <span className={rolesReady ? 'is-ready' : ''}>{rolesReady ? <Check size={13} /> : <Loader2 size={13} className="spin" />} Access rules loaded</span>
        <p><Cloud size={14} /> Your first stop in the console is Deck Cloud. Upload a track, take control, choose a voice channel, then go on air.</p>
      </div>

      <button type="button" className="btn btn-primary btn-large" onClick={finish} disabled={saving || !billingReady || !rolesReady || !name.trim() || !cleanSlug}>
        {saving ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
        {billingReady ? 'Save and open console' : 'Subscribe to continue'}
      </button>
    </section>
  );
}
