import { useMemo, useState } from 'react';
import { ListPlus, Pencil, Trash2 } from 'lucide-react';
import { formatBytes, formatTime, relativeTime } from '../lib/format';
import type { ClientCommands, MediaItem, SessionUser } from '../protocol';
import type { DjClient } from '../socket';

/** Matches the server's media:update schema, so an edit is never rejected whole. */
const BPM_MIN = 20;
const BPM_MAX = 300;
const TAG_MAX_LENGTH = 24;
const TAG_MAX_COUNT = 12;

/**
 * Title, tempo and tags for one track.
 *
 * The pool could only ever rename a track, which left the tempo - the thing
 * sync and beat loops depend on - unreachable unless detection happened to get
 * it right.
 */
function TrackEditor({
  item,
  send,
  onClose,
}: {
  item: MediaItem;
  send: DjClient['send'];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [bpm, setBpm] = useState(item.bpm === null ? '' : String(item.bpm));
  const [tags, setTags] = useState(item.tags.join(', '));

  const save = () => {
    const patch: ClientCommands['media:update'] = { id: item.id };
    let changed = false;

    const nextTitle = title.trim().slice(0, 120);
    if (nextTitle && nextTitle !== item.title) {
      patch.title = nextTitle;
      changed = true;
    }

    const raw = bpm.trim();
    if (raw === '') {
      if (item.bpm !== null) {
        patch.bpm = null;
        changed = true;
      }
    } else {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        const clamped = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(parsed * 10) / 10));
        if (clamped !== item.bpm) {
          patch.bpm = clamped;
          changed = true;
        }
      }
    }

    const nextTags = [
      ...new Set(
        tags
          .split(',')
          .map((tag) => tag.trim().slice(0, TAG_MAX_LENGTH))
          .filter(Boolean),
      ),
    ].slice(0, TAG_MAX_COUNT);
    const tagsUnchanged =
      nextTags.length === item.tags.length &&
      nextTags.every((tag, index) => tag === item.tags[index]);
    if (!tagsUnchanged) {
      patch.tags = nextTags;
      changed = true;
    }

    if (changed) void send('media:update', patch);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="track-editor" onKeyDown={onKeyDown}>
      <label className="track-field">
        <span>Title</span>
        <input
          className="track-input"
          value={title}
          autoFocus
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <div className="track-field-row">
        <label className="track-field track-field-bpm">
          <span>BPM</span>
          <input
            className="track-input mono"
            value={bpm}
            inputMode="decimal"
            placeholder="-"
            onChange={(event) => setBpm(event.target.value)}
          />
        </label>
        <label className="track-field">
          <span>Tags</span>
          <input
            className="track-input"
            value={tags}
            placeholder="house, warmup"
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
      </div>

      <div className="track-editor-actions">
        <button type="button" className="btn tiny primary" onClick={save}>
          SAVE
        </button>
        <button type="button" className="btn tiny" onClick={onClose}>
          CANCEL
        </button>
        <span className="hint">enter saves · esc cancels</span>
      </div>
    </div>
  );
}

interface MediaPoolProps {
  media: MediaItem[];
  user: SessionUser;
  locked: boolean;
  send: DjClient['send'];
}

export function MediaPool({ media, user, locked, send }: MediaPoolProps) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return media;
    return media.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)) ||
        m.uploadedBy.name.toLowerCase().includes(q),
    );
  }, [media, query]);

  return (
    <section className="panel pool">
      <header className="panel-head">
        <h2 className="panel-title">Deck Cloud tracks</h2>
      </header>

      <input
        className="search"
        placeholder="Search title, tag, uploader"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <ul className="track-list">
        {filtered.length === 0 ? (
          <li className="empty">
            {media.length === 0 ? 'Upload or cache music from Deck Cloud first' : 'No matches'}
          </li>
        ) : null}

        {filtered.map((item) => {
          const mine = item.uploadedBy.id === user.id || user.isAdmin;
          return (
            <li
              key={item.id}
              className={`track ${item.status} ${editing === item.id ? 'is-editing' : ''}`}
              // Dragging a row while typing in it would fight the text cursor.
              draggable={item.status === 'ready' && editing !== item.id}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-dj-media', item.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <div className="track-row">
                <div className="track-main">
                  {/* Deliberately not a <button>: an interactive control here
                      swallows the drag gesture, leaving almost no draggable
                      surface on the row. */}
                  <span
                    className="track-title"
                    title={mine ? `${item.title} (double-click to edit)` : item.title}
                    onDoubleClick={() => mine && setEditing(item.id)}
                  >
                    {item.title}
                  </span>
                  <span className="track-meta mono">
                    {item.status === 'ready'
                      ? `${formatTime(item.durationMs)}  ${formatBytes(item.sizeBytes)}`
                      : item.status === 'processing'
                        ? 'decoding...'
                        : item.status === 'missing'
                          ? 'not in the playback cache'
                          : item.error ?? 'failed'}
                    {'   '}
                    {item.uploadedBy.name} {relativeTime(item.uploadedAt)}
                  </span>
                  {item.bpm || item.tags.length > 0 ? (
                    <span className="track-marks">
                      {item.bpm ? <span className="track-bpm mono">{item.bpm} bpm</span> : null}
                      {item.tags.map((tag) => (
                        <span className="track-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>

                <div className="track-actions">
                  <button
                    type="button"
                    className={`btn tiny ${editing === item.id ? 'is-active' : ''}`}
                    disabled={!mine}
                    title={
                      mine
                        ? 'Edit title, BPM and tags'
                        : 'Only the uploader or an admin can edit this'
                    }
                    aria-label="Edit track"
                    onClick={() => setEditing(editing === item.id ? null : item.id)}
                  >
                    <Pencil size={12} />
                  </button>
                  {/* Not gated on the control lock: lining a track up is open
                      to anyone signed in, which is the point of a shared
                      queue. Only playing it needs the decks. */}
                  <button
                    type="button"
                    className="btn tiny"
                    disabled={item.status !== 'ready'}
                    title="Add to the queue"
                    aria-label={`Queue ${item.title}`}
                    onClick={() => void send('queue:add', { mediaId: item.id })}
                  >
                    <ListPlus size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn tiny"
                    disabled={locked || item.status !== 'ready'}
                    onClick={() => void send('deck:load', { deck: 'A', mediaId: item.id })}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    className="btn tiny"
                    disabled={locked || item.status !== 'ready'}
                    onClick={() => void send('deck:load', { deck: 'B', mediaId: item.id })}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    className="btn tiny danger"
                    disabled={!mine}
                    title={mine ? 'Forget track metadata' : 'Only the host or an admin can remove this'}
                    aria-label="Forget track"
                    onClick={() => {
                      if (confirm(`Forget "${item.title}" from this track catalogue? The Deck Cloud object is untouched.`)) {
                        void send('media:delete', { id: item.id });
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {editing === item.id ? (
                <TrackEditor item={item} send={send} onClose={() => setEditing(null)} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
