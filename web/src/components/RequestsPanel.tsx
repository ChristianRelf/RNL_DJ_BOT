import { Check, ListEnd, Trash2, X } from 'lucide-react';
import type { RequestItem } from '../protocol';
import type { DjClient } from '../socket';

/**
 * What the room has asked for.
 *
 * Not the queue, and deliberately next to it rather than inside it: a request
 * is somebody without a console asking, and it stays an ask until whoever is on
 * the decks accepts it. Accepting one that came out of the library is a queue
 * entry credited to whoever asked; accepting one that is just words is not
 * something the rig can do at all, so those carry a note saying so rather than
 * a button that would fail.
 *
 * Acting on any of it needs the decks. Anyone signed in can queue a track
 * themselves - answering the room on the rig's behalf is a different thing, and
 * it belongs to whoever is driving.
 */

interface Props {
  requests: RequestItem[];
  locked: boolean;
  send: DjClient['send'];
}

/** How long ago, in the roughest terms that are still useful mid-set. */
function ago(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function RequestsPanel({ requests, locked, send }: Props) {
  const pending = requests.filter((entry) => entry.status === 'pending');
  const handled = requests.filter((entry) => entry.status !== 'pending');

  return (
    <section className="panel requests-panel">
      <header className="panel-head">
        <h2 className="panel-title">Requests</h2>
        <span className="hint">
          {pending.length === 0
            ? 'nothing waiting'
            : `${pending.length} waiting${handled.length > 0 ? ` · ${handled.length} done` : ''}`}
        </span>
      </header>

      {pending.length === 0 && handled.length === 0 ? (
        <p className="queue-empty">
          Nobody has asked for anything. Requests come in from{' '}
          <strong>/&lt;rig&gt;/request</strong> - switch them on, and share the link, from the
          tools page.
        </p>
      ) : null}

      {pending.length > 0 ? (
        <ul className="requests-list">
          {pending.map((entry) => (
            <li className="requests-row" key={entry.id}>
              <span className="requests-track">
                <strong>{entry.text}</strong>
                <em>
                  {entry.by.name} · {ago(entry.at)}
                  {entry.mediaId ? '' : ' · not from the library'}
                </em>
                {entry.note ? <span className="requests-note">“{entry.note}”</span> : null}
              </span>

              <span className="requests-actions">
                {entry.mediaId ? (
                  <>
                    <button
                      type="button"
                      className="wchrome-btn"
                      disabled={locked}
                      title="Queue it"
                      aria-label={`Queue ${entry.text}`}
                      onClick={() => void send('requests:accept', { id: entry.id })}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      className="wchrome-btn"
                      disabled={locked}
                      title="Queue it next"
                      aria-label={`Play ${entry.text} next`}
                      onClick={() => void send('requests:accept', { id: entry.id, next: true })}
                    >
                      <ListEnd size={12} />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="wchrome-btn wchrome-hide"
                  disabled={locked}
                  title={
                    entry.mediaId
                      ? 'Turn it down'
                      : 'Turn it down - or find it in the pool and queue it yourself'
                  }
                  aria-label={`Decline ${entry.text}`}
                  onClick={() => void send('requests:decline', { id: entry.id })}
                >
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {handled.length > 0 ? (
        <>
          <div className="requests-done-head">
            <span className="tool-label-sm">Dealt with</span>
            <button
              type="button"
              className="btn tiny danger"
              disabled={locked}
              title="Clear everything already dealt with"
              onClick={() => void send('requests:clear', {})}
            >
              <Trash2 size={12} />
              CLEAR
            </button>
          </div>
          <ul className="requests-done">
            {handled.slice(0, 12).map((entry) => (
              <li key={entry.id} className={`is-${entry.status}`}>
                <span className="requests-done-track">{entry.text}</span>
                <span className="mono">
                  {entry.status === 'accepted' ? 'queued' : 'declined'}
                  {entry.handledBy ? ` · ${entry.handledBy}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
