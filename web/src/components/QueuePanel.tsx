import { useState } from 'react';
import { ChevronDown, ChevronUp, ListEnd, Trash2, X } from 'lucide-react';
import { formatSpan, formatTime } from '../lib/format';
import { DECK_IDS, type DeckId, type MediaItem, type QueueState, type SessionUser } from '../protocol';
import type { DjClient } from '../socket';

/**
 * What is lined up to play.
 *
 * The queue is rig state, not a personal playlist: everyone sees the same list,
 * and anyone signed in can add to it whether or not they hold the decks. That
 * is deliberate - a room full of people who can queue a track but not touch the
 * mixer is most of what a shared DJ rig is for. Rearranging or dropping
 * somebody else's track needs the decks, the same way editing their upload
 * needs to be them or an admin.
 *
 * Only media ids are stored server-side, so titles and durations are resolved
 * from the pool here and a rename never leaves a stale copy behind.
 */

interface Props {
  queue: QueueState;
  media: MediaItem[];
  me: SessionUser;
  locked: boolean;
  send: DjClient['send'];
}

export function QueuePanel({ queue, media, me, locked, send }: Props) {
  const [over, setOver] = useState(false);
  const byId = new Map(media.map((item) => [item.id, item]));

  const total = queue.items.reduce(
    (sum, entry) => sum + (byId.get(entry.mediaId)?.durationMs ?? 0),
    0,
  );

  const load = (deck: DeckId, play: boolean) => void send('queue:load', { deck, play });

  return (
    <section
      className={`panel queue-panel ${over ? 'is-dropping' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('application/x-dj-media')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        const mediaId = event.dataTransfer.getData('application/x-dj-media');
        setOver(false);
        if (!mediaId) return;
        event.preventDefault();
        void send('queue:add', { mediaId });
      }}
    >
      <header className="panel-head">
        <h2 className="panel-title">Queue</h2>
        <span className="hint">
          {queue.items.length === 0
            ? 'drag tracks in from the pool'
            : `${queue.items.length} track${queue.items.length === 1 ? '' : 's'} · ${formatSpan(total)}`}
        </span>
      </header>

      <div className="queue-actions">
        {DECK_IDS.map((id) => (
          <button
            type="button"
            className={`btn tiny strip-${id.toLowerCase()}`}
            key={id}
            disabled={locked || queue.items.length === 0}
            title={`Load the next track onto deck ${id}`}
            onClick={() => load(id, false)}
          >
            <ListEnd size={12} />
            LOAD {id}
          </button>
        ))}

        <button
          type="button"
          className={`btn tiny ${queue.auto ? 'is-on' : ''}`}
          disabled={locked}
          aria-pressed={queue.auto}
          title={
            queue.auto
              ? 'A deck running out takes the next queued track and plays it'
              : 'A deck running out just stops'
          }
          onClick={() => void send('queue:set', { auto: !queue.auto })}
        >
          AUTO
        </button>

        <button
          type="button"
          className="btn tiny danger"
          disabled={locked || queue.items.length === 0}
          title="Empty the queue"
          onClick={() => void send('queue:clear', {})}
        >
          <Trash2 size={12} />
          CLEAR
        </button>
      </div>

      {queue.items.length === 0 ? (
        <p className="queue-empty">
          Nothing lined up. Drag a track here from the pool, or use its <strong>queue</strong>{' '}
          button - you do not need the decks to do it.
        </p>
      ) : (
        <ol className="queue-list">
          {queue.items.map((entry, index) => {
            const item = byId.get(entry.mediaId);
            // Removing your own is always allowed; anyone else's needs the decks.
            const canRemove = entry.addedBy.id === me.id || me.isAdmin || !locked;
            return (
              <li className="queue-row" key={entry.id}>
                <span className="queue-index mono">{index + 1}</span>

                <span className="queue-track">
                  <strong>{item?.title ?? 'Removed from the pool'}</strong>
                  <em>
                    {item ? formatTime(item.durationMs) : 'unavailable'}
                    {item?.bpm ? ` · ${item.bpm.toFixed(0)} bpm` : ''} · {entry.addedBy.name}
                  </em>
                </span>

                <span className="queue-row-actions">
                  <button
                    type="button"
                    className="wchrome-btn"
                    disabled={locked || index === 0}
                    title="Move up"
                    aria-label={`Move ${item?.title ?? 'track'} up`}
                    onClick={() => void send('queue:move', { id: entry.id, to: index - 1 })}
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    className="wchrome-btn"
                    disabled={locked || index === queue.items.length - 1}
                    title="Move down"
                    aria-label={`Move ${item?.title ?? 'track'} down`}
                    onClick={() => void send('queue:move', { id: entry.id, to: index + 1 })}
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    type="button"
                    className="wchrome-btn wchrome-hide"
                    disabled={!canRemove}
                    title={canRemove ? 'Take it off the queue' : 'Take control to remove this'}
                    aria-label={`Remove ${item?.title ?? 'track'} from the queue`}
                    onClick={() => void send('queue:remove', { id: entry.id })}
                  >
                    <X size={12} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
