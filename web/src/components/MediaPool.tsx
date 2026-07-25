import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Headphones, Square, Trash2, Upload } from 'lucide-react';
import { formatBytes, formatTime, relativeTime } from '../lib/format';
import type { MediaItem, SessionUser } from '../protocol';
import type { DjClient } from '../socket';

interface MediaPoolProps {
  media: MediaItem[];
  user: SessionUser;
  locked: boolean;
  send: DjClient['send'];
}

interface UploadJob {
  id: number;
  name: string;
  progress: number;
  error?: string;
}

let uploadSeq = 0;

export function MediaPool({ media, user, locked, send }: MediaPoolProps) {
  const [query, setQuery] = useState('');
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const upload = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (list.length === 0) return;

    for (const file of list) {
      const id = ++uploadSeq;
      setUploads((prev) => [...prev, { id, name: file.name, progress: 0 }]);
      const patch = (changes: Partial<UploadJob>) =>
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...changes } : u)));

      const body = new FormData();
      body.append('files', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/media');
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) patch({ progress: event.loaded / event.total });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // The item is already in the pool as "processing" — drop the row.
          setUploads((prev) => prev.filter((u) => u.id !== id));
        } else {
          let message = `Upload failed (${xhr.status})`;
          try {
            message = JSON.parse(xhr.responseText).error ?? message;
          } catch {
            /* keep the status message */
          }
          patch({ error: message });
        }
      };
      xhr.onerror = () => patch({ error: 'Network error' });
      xhr.send(body);
    }
  }, []);

  // One preview player, wired to whichever row asked for it.
  useEffect(() => {
    if (!previewId) {
      audioRef.current?.pause();
      return;
    }
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = `/api/media/${previewId}/audio`;
    audio.volume = 0.7;
    audio.onended = () => setPreviewId(null);
    void audio.play().catch(() => setPreviewId(null));
    return () => {
      audio.pause();
    };
  }, [previewId]);

  useEffect(() => () => audioRef.current?.pause(), []);

  return (
    <section
      className={`panel pool ${dragOver ? 'is-drop' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (!event.dataTransfer.files?.length) return;
        event.preventDefault();
        setDragOver(false);
        upload(event.dataTransfer.files);
      }}
    >
      <header className="panel-head">
        <h2 className="panel-title">Media pool</h2>
        <button type="button" className="btn tiny" onClick={() => inputRef.current?.click()}>
          <Upload size={12} />
          UPLOAD
        </button>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) upload(event.target.files);
          event.target.value = '';
        }}
      />

      <input
        className="search"
        placeholder="Search title, tag, uploader"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {uploads.length > 0 ? (
        <ul className="upload-list">
          {uploads.map((job) => (
            <li key={job.id} className={job.error ? 'is-error' : ''}>
              <span className="upload-name">{job.name}</span>
              {job.error ? (
                <span className="upload-error">{job.error}</span>
              ) : (
                <span className="upload-bar">
                  <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="track-list">
        {filtered.length === 0 ? (
          <li className="empty">
            {media.length === 0 ? 'Drop audio files here to build the pool' : 'No matches'}
          </li>
        ) : null}

        {filtered.map((item) => {
          const mine = item.uploadedBy.id === user.id || user.isAdmin;
          return (
            <li
              key={item.id}
              className={`track ${item.status}`}
              draggable={item.status === 'ready'}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-dj-media', item.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <div className="track-main">
                {editing === item.id ? (
                  <input
                    className="track-rename"
                    defaultValue={item.title}
                    autoFocus
                    onBlur={(event) => {
                      const title = event.target.value.trim();
                      if (title && title !== item.title) {
                        void send('media:update', { id: item.id, title });
                      }
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  // Deliberately not a <button>: an interactive control here
                  // swallows the drag gesture, leaving almost no draggable
                  // surface on the row.
                  <span
                    className="track-title"
                    title={mine ? `${item.title} (double-click to rename)` : item.title}
                    onDoubleClick={() => mine && setEditing(item.id)}
                  >
                    {item.title}
                  </span>
                )}
                <span className="track-meta mono">
                  {item.status === 'ready'
                    ? `${formatTime(item.durationMs)}  ${formatBytes(item.sizeBytes)}`
                    : item.status === 'processing'
                      ? 'decoding...'
                      : item.error ?? 'failed'}
                  {'   '}
                  {item.uploadedBy.name} {relativeTime(item.uploadedAt)}
                </span>
              </div>

              <div className="track-actions">
                <button
                  type="button"
                  className={`btn tiny ${previewId === item.id ? 'is-active' : ''}`}
                  disabled={item.status !== 'ready'}
                  title="Pre-listen in your browser only, not on air"
                  aria-label="Pre-listen"
                  onClick={() => setPreviewId(previewId === item.id ? null : item.id)}
                >
                  {previewId === item.id ? <Square size={12} /> : <Headphones size={12} />}
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
                  title={mine ? 'Delete from pool' : 'Only the uploader or an admin can delete this'}
                  aria-label="Delete from pool"
                  onClick={() => {
                    if (confirm(`Delete "${item.title}" from the pool?`)) {
                      void send('media:delete', { id: item.id });
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
