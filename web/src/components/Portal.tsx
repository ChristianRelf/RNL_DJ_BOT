import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot as BotIcon,
  Check,
  Copy,
  Loader2,
  Play,
  Radio,
  Square,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { ActiveBot } from '../protocol';

/**
 * The owner portal.
 *
 * Everything here is platform-level: which rigs exist, who is allowed to sign
 * in at all, which Discord accounts can be played through. None of it is a
 * thing a guild admin can reach — a guild admin runs one server's decks, and
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
}

interface AllowEntry {
  discordId: string;
  note: string;
  canOnboard: boolean;
  addedBy: string;
  addedAt: number;
}

interface WaitEntry {
  id: string;
  discord: string;
  email: string;
  community: string;
  size: string;
  note: string;
  at: number;
}

interface Overview {
  guilds: PortalGuild[];
  allowlist: AllowEntry[];
  waitlist: WaitEntry[];
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

export function Portal() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api('/api/portal/overview'));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    // Rigs start, stop and go on air without anybody clicking anything here, so
    // this refreshes on its own. Slowly — it is a status page, not a meter.
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
        <a className="btn" href="/login">
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

  return (
    <div className="portal">
      <header className="portal-head">
        <h1 className="portal-title">deck portal</h1>
        <span className="portal-health mono">
          {data.health.rigs} rig{data.health.rigs === 1 ? '' : 's'} · {data.health.memoryMb} MB ·
          up {uptime(data.health.uptime)}
        </span>
      </header>

      {error && (
        <p className="portal-error">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      <div className="portal-grid">
        <Rigs guilds={data.guilds} busy={busy} run={run} />
        <Allowlist entries={data.allowlist} busy={busy} run={run} />
        <Waitlist entries={data.waitlist} busy={busy} run={run} />
        <Bots bots={data.bots} />
      </div>
    </div>
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
  return (
    <section className="portal-panel portal-rigs">
      <h2 className="portal-panel-title">Rigs</h2>

      {guilds.length === 0 ? (
        <p className="panel-empty">
          None yet. Someone allowed to onboard will create the first one from the wizard.
        </p>
      ) : (
        <ul className="portal-list">
          {guilds.map((guild) => {
            const live = guild.voice?.status === 'ready';
            return (
              <li key={guild.id} className="portal-rig">
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
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    disabled={busy !== null}
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
  const [discordId, setDiscordId] = useState('');
  const [note, setNote] = useState('');

  const add = () => {
    const id = discordId.trim();
    if (!id) return;
    void run('allow', async () => {
      await api('/api/portal/allow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ discordId: id, note: note.trim() }),
      });
      setDiscordId('');
      setNote('');
    });
  };

  return (
    <section className="portal-panel">
      <h2 className="portal-panel-title">
        <UserPlus size={13} /> Who can sign in
      </h2>
      <p className="portal-hint">
        A Discord user id. Being on this list is what lets somebody log in at all — which rigs
        they can open is still up to each server&rsquo;s roles.
      </p>

      <div className="portal-add">
        <input
          className="input mono"
          placeholder="Discord user id"
          value={discordId}
          inputMode="numeric"
          onChange={(e) => setDiscordId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          className="input"
          placeholder="note — who is this?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" className="btn btn-primary" onClick={add} disabled={busy !== null}>
          Add
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="panel-empty">Nobody yet.</p>
      ) : (
        <ul className="portal-list">
          {entries.map((entry) => (
            <li key={entry.discordId} className="portal-allow">
              <span className="mono portal-allow-id">{entry.discordId}</span>
              <span className="portal-allow-note">{entry.note || '—'}</span>
              <span className="mono portal-dim">{ago(entry.addedAt)}</span>
              <button
                type="button"
                className="btn btn-small btn-danger"
                disabled={busy !== null}
                onClick={() =>
                  run(entry.discordId, () =>
                    api(`/api/portal/allow/${entry.discordId}`, { method: 'DELETE' }),
                  )
                }
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- waitlist */

function Waitlist({
  entries,
  busy,
  run,
}: {
  entries: WaitEntry[];
  busy: string | null;
  run: (key: string, work: () => Promise<unknown>) => Promise<void>;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <section className="portal-panel">
      <h2 className="portal-panel-title">Asking for access</h2>

      {entries.length === 0 ? (
        <p className="panel-empty">Nobody waiting.</p>
      ) : (
        <ul className="portal-list">
          {entries.map((entry) => (
            <li key={entry.id} className="portal-wait">
              <div className="portal-wait-main">
                <strong>{entry.community}</strong>
                <span className="mono portal-dim">
                  {entry.discord} · {entry.email} · {entry.size || 'size unsaid'}
                </span>
                {entry.note && <span className="portal-wait-note">{entry.note}</span>}
              </div>
              <div className="portal-wait-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  title="Copy the Discord handle, to look their id up"
                  onClick={() => {
                    void navigator.clipboard.writeText(entry.discord);
                    setCopied(entry.id);
                    setTimeout(() => setCopied(null), 1500);
                  }}
                >
                  {copied === entry.id ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  disabled={busy !== null}
                  onClick={() =>
                    run(entry.id, () =>
                      api(`/api/portal/waitlist/${entry.id}`, { method: 'DELETE' }),
                    )
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ bots */

function Bots({ bots }: { bots: Array<{ id: string; name: string; tag: string | null; fingerprint: string }> }) {
  return (
    <section className="portal-panel">
      <h2 className="portal-panel-title">
        <BotIcon size={13} /> Playback bots
      </h2>
      <p className="portal-hint">
        Shared across every rig. Added from a rig&rsquo;s tools page, where the token can be
        checked against the server it is meant to play in.
      </p>

      {bots.length === 0 ? (
        <p className="panel-empty">Only the default bot from the environment.</p>
      ) : (
        <ul className="portal-list">
          {bots.map((bot) => (
            <li key={bot.id} className="portal-bot">
              <span>{bot.name}</span>
              <span className="mono portal-dim">{bot.tag ?? bot.fingerprint}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
