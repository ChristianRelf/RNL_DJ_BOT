import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import type { ActiveBot, BotSummary, SessionUser } from '../protocol';

/**
 * Which Discord account the rig plays through.
 *
 * Owner-only, and deliberately not part of the console's shared state: adding a
 * bot means handing the server a token, so it goes over its own HTTP endpoints
 * and nothing about it rides the broadcast every DJ receives. Tokens are
 * write-only — what comes back is a name, an application id and a fingerprint,
 * which is enough to tell two bots apart and to check that the token that got
 * stored is the one you pasted.
 */

interface Props {
  user: SessionUser;
  /** The bot the console currently believes is on air, from the rig state. */
  live: ActiveBot;
  voiceLive: boolean;
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

export function BotsPanel({ user, live, voiceLive }: Props) {
  const [bots, setBots] = useState<BotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');

  const load = useCallback(() => {
    api('/api/bots')
      .then((body) => {
        setBots(body.bots);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  // The rig state names the bot on air, so a swap made from another tab shows
  // up here without polling for it. Keyed on the id changing rather than on the
  // list disagreeing: if the two ever failed to converge, the latter would
  // refetch on every render for as long as the disagreement lasted.
  const shown = useRef(live.id);
  useEffect(() => {
    if (shown.current === live.id) return;
    shown.current = live.id;
    load();
  }, [live.id, load]);

  if (!user.isOwner) return null;

  const run = async (label: string, work: () => Promise<any>) => {
    setBusy(label);
    setError(null);
    try {
      const body = await work();
      if (body?.bots) setBots(body.bots);
      else load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submit = () =>
    run('add', async () => {
      const body = await api('/api/bots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || undefined, token: token.trim() }),
      });
      setToken('');
      setName('');
      setAdding(false);
      return body;
    });

  return (
    <section className="tool is-on bots-tool">
      <header className="tool-head">
        <div className="tool-heading">
          <h2>Playback bot</h2>
          <p>
            The Discord account the room hears. <strong>deck</strong> is the default; add your own
            bots here and switch between them without a restart. Signing in is separate — that
            stays on <strong>deck auth</strong> whatever is playing.
          </p>
        </div>
        <button type="button" className="btn tiny" onClick={load} title="Reload the list">
          <RefreshCw size={12} />
          REFRESH
        </button>
      </header>

      <div className="tool-body">
        {error ? <p className="tool-result is-bad">{error}</p> : null}
        {live.error ? (
          <p className="tool-result is-bad">
            <TriangleAlert size={12} /> {live.error}
          </p>
        ) : null}

        {bots === null ? (
          <p className="tool-note">Loading…</p>
        ) : (
          <ul className="bot-list">
            {bots.map((entry) => (
              <li className={`bot-row ${entry.active ? 'is-active' : ''}`} key={entry.id}>
                <span className="bot-mark" aria-hidden="true">
                  {entry.active ? <Check size={13} /> : <Bot size={13} />}
                </span>

                <span className="bot-identity">
                  <strong>
                    {entry.name}
                    {entry.isDefault ? <em className="bot-tag-default">default</em> : null}
                  </strong>
                  <em className="mono">
                    {entry.tag ?? entry.applicationId} · {entry.fingerprint}
                  </em>
                  {entry.addedBy ? (
                    <em>
                      added by {entry.addedBy.name}
                      {entry.addedAt
                        ? ` on ${new Date(entry.addedAt).toLocaleDateString()}`
                        : ''}
                    </em>
                  ) : (
                    <em>from the server environment</em>
                  )}
                  {entry.error ? <em className="bot-error">{entry.error}</em> : null}
                </span>

                <span className="bot-actions">
                  {entry.active ? (
                    <span className="bot-live mono">{live.status === 'ready' ? 'ON AIR' : live.status.toUpperCase()}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn tiny"
                      disabled={busy !== null}
                      title={
                        voiceLive
                          ? 'Switches the stream over — the bot in the channel changes'
                          : 'Play through this bot'
                      }
                      onClick={() =>
                        run(entry.id, () =>
                          api(`/api/bots/${entry.id}/activate`, { method: 'POST' }),
                        )
                      }
                    >
                      {busy === entry.id ? 'SWITCHING' : 'USE THIS'}
                    </button>
                  )}
                  {entry.isDefault ? null : (
                    <button
                      type="button"
                      className="btn tiny danger"
                      disabled={busy !== null}
                      title="Forget this bot and its token"
                      aria-label={`Remove ${entry.name}`}
                      onClick={() =>
                        run(entry.id, () => api(`/api/bots/${entry.id}`, { method: 'DELETE' }))
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="bot-add">
            <label className="tool-field">
              <span>Name (optional)</span>
              <input
                className="tool-input"
                placeholder="What to call it on this list"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="tool-field">
              <span>Bot token</span>
              <input
                className="tool-input mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="From the Bot tab of your Discord application"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && token.trim()) void submit();
                }}
              />
            </label>
            <div className="tool-row">
              <button
                type="button"
                className="btn primary"
                disabled={busy !== null || !token.trim()}
                onClick={() => void submit()}
              >
                {busy === 'add' ? 'CHECKING' : 'ADD BOT'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => {
                  setAdding(false);
                  setToken('');
                  setName('');
                }}
              >
                CANCEL
              </button>
            </div>
            <p className="tool-note">
              The application id is read from the token, so there is nothing else to copy. The bot
              has to already be in this server with <strong>Connect</strong> and{' '}
              <strong>Speak</strong> — that is checked before anything is saved.
            </p>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            <Plus size={13} />
            ADD A BOT
          </button>
        )}

        <p className="tool-note">
          Switching drops the voice connection and remakes it as the new bot — the old one leaves
          the channel, the new one rejoins it. The decks keep running throughout, but the room
          hears a gap, so it is not a mid-drop move. Tokens are encrypted with this rig's
          <code> SESSION_SECRET</code> before they are written to disk and are never sent back to
          a browser; rotating that secret invalidates them.
        </p>
      </div>
    </section>
  );
}
