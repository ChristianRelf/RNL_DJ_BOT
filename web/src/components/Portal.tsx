import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot as BotIcon,
  CreditCard,
  HardDrive,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Search,
  Square,
  Trash2,
  UserCog,
  UserPlus,
  Wrench,
} from 'lucide-react';
import type { ActiveBot } from '../protocol';
import { BotsPanel } from './BotsPanel';
import { InvitePanel } from './InvitePanel';

/**
 * The owner portal.
 *
 * Everything here is platform-level: which rigs exist, who is allowed to sign
 * in at all, which Discord accounts can be played through. None of it is a
 * thing a guild admin can reach - a guild admin runs one server's decks, and
 * this runs the platform those servers are on.
 */

interface PortalGuild {
  id: string;
  slug: string;
  name: string;
  createdAt: number;
  createdBy: string;
  status: 'active' | 'suspended';
  running: boolean;
  host: { hosted: boolean; userName: string | null; trackCount: number } | null;
  voice: { status: string; channelName: string | null } | null;
  bot: ActiveBot | null;
  tracks: number;
  billing: {
    configured: boolean;
    status: string;
    entitled: boolean;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    plan: { amountCents: number; storageBytes: number };
  };
  cloud: { usedBytes: number; limitBytes: number; remainingBytes: number; entitled: boolean };
  cacheMetrics: { hits: number; misses: number; resumedBytes: number; evictions: number;
    corruptions: number; cdnBytes: number; originBytes: number };
}

interface AllowEntry {
  discordId: string;
  note: string;
  canOnboard: boolean;
  status: 'active' | 'suspended';
  addedBy: string;
  addedAt: number;
}

interface Overview {
  guilds: PortalGuild[];
  allowlist: AllowEntry[];
  bots: Array<{ id: string; name: string; tag: string | null; fingerprint: string }>;
  health: { rigs: number; memoryMb: number; uptime: number };
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

function ago(at: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function uptime(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function storage(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function Portal() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [section, setSection] = useState<'overview' | 'accounts' | 'infrastructure'>('overview');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await api('/api/portal/overview'));
      setUpdatedAt(Date.now());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Rigs start, stop and go on air without anybody clicking anything here, so
    // this refreshes on its own. Slowly - it is a status page, not a meter.
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      await load();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <div className="boot">
        <AlertTriangle size={18} />
        <p>{error}</p>
        <a className="btn" href="/api/auth/login?next=/portal">
          Sign in
        </a>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="boot">
        <div className="boot-spinner" />
        <p>loading</p>
      </div>
    );
  }

  const liveRigs = data.guilds.filter((guild) => guild.voice?.status === 'ready').length;
  const runningRigs = data.guilds.filter((guild) => guild.running).length;
  const tracks = data.guilds.reduce((total, guild) => total + guild.tracks, 0);
  const subscriptions = data.guilds.filter((guild) => guild.billing.entitled).length;
  const cloudUsed = data.guilds.reduce((total, guild) => total + guild.cloud.usedBytes, 0);
  const suspendedAccounts = data.allowlist.filter((account) => account.status === 'suspended').length;

  return (
    <div className="portal">
      <header className="portal-head">
        <div>
          <span className="portal-eyebrow mono">PLATFORM ADMIN</span>
          <h1 className="portal-title">Deck operations</h1>
          <p className="portal-subtitle">Operate rigs, accounts, subscriptions and playback infrastructure.</p>
        </div>
        <div className="portal-head-actions">
          <span className="portal-health mono">
            {data.health.memoryMb} MB · up {uptime(data.health.uptime)}
            {updatedAt ? ` · updated ${ago(updatedAt)}` : ''}
          </span>
          <button type="button" className="btn btn-small" disabled={refreshing} onClick={() => void load()}>
            <RefreshCw size={12} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <p className="portal-error">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      <section className="portal-summary" aria-label="Platform summary">
        <Summary label="On air" value={liveRigs} tone={liveRigs > 0 ? 'live' : undefined} detail={`${runningRigs} running`} />
        <Summary label="Rigs" value={data.guilds.length} detail={`${data.guilds.length - runningRigs} stopped`} />
        <Summary label="Known tracks" value={tracks} detail="across all rigs" />
        <Summary label="Accounts" value={data.allowlist.length} detail={`${suspendedAccounts} suspended`} />
        <Summary label="Subscribers" value={subscriptions} detail={`${storage(cloudUsed)} stored`} />
      </section>

      <nav className="portal-nav" aria-label="Management sections">
        <button type="button" className={section === 'overview' ? 'is-active' : ''} onClick={() => setSection('overview')}>Operations</button>
        <button type="button" className={section === 'accounts' ? 'is-active' : ''} onClick={() => setSection('accounts')}>
          <UserCog size={13} /> Accounts <span>{data.allowlist.length}</span>
        </button>
        <button type="button" className={section === 'infrastructure' ? 'is-active' : ''} onClick={() => setSection('infrastructure')}>Infrastructure</button>
      </nav>

      <div className="portal-grid">
        {section === 'overview' ? <Rigs guilds={data.guilds} busy={busy} run={run} /> : null}
        {section === 'accounts' ? <>
          <Allowlist entries={data.allowlist} busy={busy} run={run} />
          <PortalInvites guilds={data.guilds} />
        </> : null}
        {section === 'infrastructure' ? <>
          <PortalBots guilds={data.guilds} />
          <CloudRepair />
          <section className="portal-panel portal-infrastructure-note">
            <h2 className="portal-panel-title"><HardDrive size={13} /> Platform capacity</h2>
            <p className="portal-hint">{data.bots.length} playback bots · {data.health.rigs} loaded rigs · {storage(cloudUsed)} in Deck Cloud.</p>
          </section>
        </> : null}
      </div>
    </div>
  );
}

interface ReconcileReport {
  expiredPending: string[];
  orphanObjects: string[];
  missingObjects: string[];
  sizeMismatches: string[];
  verified: number;
  applied: boolean;
}

function CloudRepair() {
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = report
    ? report.expiredPending.length + report.orphanObjects.length + report.missingObjects.length + report.sizeMismatches.length
    : 0;

  const run = async (apply: boolean) => {
    if (apply && !confirm(`Apply Deck Cloud repair to ${issues} reported item${issues === 1 ? '' : 's'}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api('/api/portal/cloud/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apply }),
      });
      setReport(result.report);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="portal-panel">
    <h2 className="portal-panel-title"><Wrench size={13} /> Deck Cloud repair</h2>
    <p className="portal-hint">Compare database records with object storage. A dry run is required before any orphan or broken record is removed.</p>
    <div className="portal-rig-actions">
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run(false)}>
        <RefreshCw size={12} className={busy ? 'spin' : ''} /> Dry run
      </button>
      <button type="button" className="btn btn-small danger" disabled={busy || !report || report.applied || issues === 0}
        onClick={() => void run(true)}><Wrench size={12} /> Apply repair</button>
    </div>
    {report ? <div className="portal-reconcile-report mono">
      <span>{report.verified} verified</span>
      <span>{report.expiredPending.length} expired uploads</span>
      <span>{report.orphanObjects.length} orphan objects</span>
      <span>{report.missingObjects.length} missing objects</span>
      <span>{report.sizeMismatches.length} size mismatches</span>
      {report.applied ? <strong>Repair applied</strong> : null}
    </div> : null}
    {error ? <p className="portal-error"><AlertTriangle size={12} /> {error}</p> : null}
  </section>;
}

function PortalInvites({ guilds }: { guilds: PortalGuild[] }) {
  const [scope, setScope] = useState('platform');
  const guildId = scope === 'platform' ? null : scope;
  return <section className="portal-panel">
    <h2 className="portal-panel-title"><UserPlus size={13} /> Invite access</h2>
    <p className="portal-hint">Send a one-use link instead of collecting somebody&rsquo;s Discord ID.</p>
    <label className="tool-field"><span>Access to grant</span><select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
      <option value="platform">Deck platform</option>
      {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name} — DJ access</option>)}
    </select></label>
    <InvitePanel api="/api/portal/invites" guildId={guildId} title={guildId ? 'Create rig invitation' : 'Create platform invitation'}
      description={guildId ? 'The recipient gets access to this rig after Discord confirms they are a server member. No admin powers are granted.' : 'The recipient can sign in to Deck. Their Discord roles still decide which rigs they can open.'} />
  </section>;
}

function Summary({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: 'live' | 'attention' }) {
  return (
    <article className={`portal-stat${tone ? ` is-${tone}` : ''}`}>
      <span className="portal-stat-label">{label}</span>
      <strong className="portal-stat-value mono">{value}</strong>
      <span className="portal-stat-detail">{detail}</span>
    </article>
  );
}

/* ------------------------------------------------------------------ rigs */

function Rigs({
  guilds,
  busy,
  run,
}: {
  guilds: PortalGuild[];
  busy: string | null;
  run: (key: string, work: () => Promise<unknown>) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'live' | 'idle' | 'stopped' | 'suspended'>('all');
  const needle = query.trim().toLowerCase();
  const visible = guilds.filter((guild) => {
    const live = guild.voice?.status === 'ready';
    const matchesState =
      filter === 'all' ||
      (filter === 'live' && live) ||
      (filter === 'idle' && guild.running && !live) ||
      (filter === 'stopped' && !guild.running && guild.status === 'active') ||
      (filter === 'suspended' && guild.status === 'suspended');
    const matchesText =
      !needle ||
      guild.name.toLowerCase().includes(needle) ||
      guild.slug.toLowerCase().includes(needle) ||
      Boolean(guild.bot?.name.toLowerCase().includes(needle)) ||
      Boolean(guild.voice?.channelName?.toLowerCase().includes(needle));
    return matchesState && matchesText;
  });

  return (
    <section className="portal-panel portal-rigs">
      <div className="portal-section-head">
        <h2 className="portal-panel-title">Rigs <span className="portal-count mono">{guilds.length}</span></h2>
        {guilds.length > 0 ? (
          <div className="portal-rig-tools">
            <label className="portal-search">
              <Search size={12} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rigs" aria-label="Search rigs" />
            </label>
            <select className="portal-filter mono" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter rigs by status">
              <option value="all">ALL</option>
              <option value="live">ON AIR</option>
              <option value="idle">IDLE</option>
              <option value="stopped">STOPPED</option>
              <option value="suspended">SUSPENDED</option>
            </select>
          </div>
        ) : null}
      </div>

      {guilds.length === 0 ? (
        <p className="panel-empty">
          None yet. Someone allowed to onboard will create the first one from the wizard.
        </p>
      ) : (
        <ul className="portal-list">
          {visible.map((guild) => {
            const live = guild.voice?.status === 'ready';
            return (
              <li key={guild.id} className={`portal-rig${live ? ' is-live' : ''}${guild.status === 'suspended' ? ' is-suspended' : ''}`}>
                <div className="portal-rig-main">
                  <a className="portal-rig-name" href={`/g/${guild.slug}/deck`}>
                    {guild.name}
                  </a>
                  <span className="portal-rig-slug mono">/{guild.slug}</span>
                </div>

                <div className="portal-rig-meta mono">
                  <span className={live ? 'is-live' : ''}>
                    {live ? (
                      <>
                        <Radio size={10} /> {guild.voice?.channelName ?? 'on air'}
                      </>
                    ) : guild.running ? (
                      'idle'
                    ) : (
                      'stopped'
                    )}
                  </span>
                  <span>
                    {guild.host?.hosted
                      ? `${guild.host.userName} hosting ${guild.host.trackCount}`
                      : 'no library'}
                  </span>
                  <span>{guild.tracks} known</span>
                  <span className={guild.billing.entitled ? 'is-paid' : 'is-unpaid'}>
                    <CreditCard size={10} /> {guild.billing.configured ? guild.billing.status : 'billing off'}
                  </span>
                  <span><HardDrive size={10} /> {storage(guild.cloud.usedBytes)} / {storage(guild.cloud.limitBytes)}</span>
                  <span>cache {guild.cacheMetrics.hits + guild.cacheMetrics.misses > 0
                    ? `${Math.round(guild.cacheMetrics.hits / (guild.cacheMetrics.hits + guild.cacheMetrics.misses) * 100)}% hit`
                    : 'no plays'} · {guild.cacheMetrics.evictions} evicted · {storage(guild.cacheMetrics.cdnBytes + guild.cacheMetrics.originBytes)} egress</span>
                  {guild.bot && <span>{guild.bot.name}</span>}
                </div>

                <div className="portal-rig-actions">
                  {guild.running ? (
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy !== null}
                      onClick={() =>
                        run(guild.id, () =>
                          api(`/api/portal/rigs/${guild.id}/stop`, { method: 'POST' }),
                        )
                      }
                    >
                      {busy === guild.id ? <Loader2 size={12} className="spin" /> : <Square size={12} />}
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy !== null}
                      onClick={() =>
                        run(guild.id, () =>
                          api(`/api/portal/rigs/${guild.id}/start`, { method: 'POST' }),
                        )
                      }
                    >
                      {busy === guild.id ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
                      Start
                    </button>
                  )}
                  <a className="btn btn-small" href={`/onboard?rig=${encodeURIComponent(guild.slug)}`} title={`Manage ${guild.name} setup and billing`}>
                    <CreditCard size={12} /> Billing
                  </a>
                  <button
                    type="button"
                    className={`btn btn-small${guild.status === 'active' ? ' btn-warning' : ''}`}
                    disabled={busy !== null}
                    onClick={() => {
                      const status = guild.status === 'active' ? 'suspended' : 'active';
                      if (status === 'suspended' && !window.confirm(`Suspend ${guild.name}? DJs will lose access and the rig will stop.`)) return;
                      void run(`status:${guild.id}`, () => api(`/api/portal/rigs/${guild.id}`, {
                        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }),
                      }));
                    }}
                  >
                    {guild.status === 'active' ? 'Suspend' : 'Restore'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    title={guild.billing.entitled ? 'Cancel the active subscription before deleting this rig' : `Delete ${guild.name}`}
                    disabled={busy !== null || guild.billing.entitled}
                    onClick={() => {
                      // Deleting a rig throws away its library metadata, its
                      // queue and every cue point in it. Worth one question.
                      if (
                        !window.confirm(
                          `Delete "${guild.name}"? Its tempos, beat grids and queue go with it. ` +
                            'The music on anyone’s machine is untouched.',
                        )
                      ) {
                        return;
                      }
                      void run(guild.id, () =>
                        api(`/api/portal/rigs/${guild.id}`, { method: 'DELETE' }),
                      );
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            );
          })}
          {visible.length === 0 ? <li className="portal-no-results">No rigs match this view.</li> : null}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- allowlist */

function Allowlist({
  entries,
  busy,
  run,
}: {
  entries: AllowEntry[];
  busy: string | null;
  run: (key: string, work: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <section className="portal-panel">
      <h2 className="portal-panel-title">
        <UserPlus size={13} /> Deck accounts <span className="portal-count mono">{entries.length}</span>
      </h2>
      <p className="portal-hint">
        Accounts appear automatically after a first Discord sign-in. Suspend an account to block
        new sessions and rig creation without losing its audit record.
      </p>

      {entries.length === 0 ? (
        <p className="panel-empty">Nobody yet.</p>
      ) : (
        <ul className="portal-list">
          {entries.map((entry) => (
            <li key={entry.discordId} className={`portal-allow${entry.status === 'suspended' ? ' is-suspended' : ''}`}>
              <div className="portal-account-main">
                <span className="mono portal-allow-id">{entry.discordId}</span>
                <span className="portal-allow-note">{entry.note || 'No account note'}</span>
                <span className="mono portal-dim">Added {ago(entry.addedAt)}</span>
              </div>
              <button
                type="button"
                className={`btn btn-small${entry.status === 'active' ? ' btn-warning' : ''}`}
                disabled={busy !== null}
                onClick={() => void run(`account:${entry.discordId}`, () => api(`/api/portal/allow/${entry.discordId}`, {
                  method: 'PATCH', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ status: entry.status === 'active' ? 'suspended' : 'active' }),
                }))}
              >
                {entry.status === 'active' ? 'Suspend' : 'Restore'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ bots */

function PortalBots({ guilds }: { guilds: PortalGuild[] }) {
  const [guildId, setGuildId] = useState(guilds[0]?.id ?? '');
  const guild = guilds.find((entry) => entry.id === guildId) ?? guilds[0];

  if (!guild) {
    return <section className="portal-panel"><p className="panel-empty">Create a rig before adding a playback bot.</p></section>;
  }

  return (
    <section className="portal-panel">
      <h2 className="portal-panel-title">
        <BotIcon size={13} /> Playback bot control
      </h2>
      <p className="portal-hint">
        Add, remove and switch bot accounts here. Tokens never appear on a rig&rsquo;s normal tools page.
      </p>
      <label className="tool-field">
        <span>Rig</span>
        <select className="input" value={guild.id} onChange={(event) => setGuildId(event.target.value)}>
          {guilds.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>
      <BotsPanel
        key={guild.id}
        api={`/api/portal/rigs/${guild.id}`}
        live={guild.bot}
        voiceLive={guild.voice?.status === 'ready'}
      />
    </section>
  );
}
