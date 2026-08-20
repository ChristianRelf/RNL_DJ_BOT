import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Cloud, CloudDownload, CloudUpload, RefreshCw, Radio, Trash2 } from 'lucide-react';
import type { HostState, MediaItem } from '../protocol';
import type { LibraryClient } from '../lib/useLibrary';
import { formatBytes } from '../lib/format';
import type { DjClient } from '../socket';

interface CloudItem {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  createdBy: string;
  createdAt: number;
  status: 'pending' | 'ready';
}

interface CloudState {
  enabled: boolean;
  cdn: boolean;
  media: CloudItem[];
  quota: { usedBytes: number; limitBytes: number; remainingBytes: number };
}

interface LibraryPanelProps {
  library: LibraryClient;
  host: HostState;
  meId: string;
  api: string;
  media: MediaItem[];
  send: DjClient['send'];
  locked: boolean;
}

async function json(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

export function LibraryPanel({ library, host, meId, api, media, send, locked }: LibraryPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [cloud, setCloud] = useState<CloudState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iAmHost = host.hosted && host.userId === meId;

  const load = useCallback(() => {
    void json(`${api}/cloud`).then(setCloud).catch((err: Error) => setError(err.message));
  }, [api]);
  useEffect(load, [load]);

  const cacheFiles = (files: File[]) => {
    library.importFiles(files);
  };

  const upload = async (files: FileList) => {
    setError(null);
    const cached: File[] = [];
    for (const file of Array.from(files)) {
      setBusy(file.name);
      try {
        const prepared = await json(`${api}/cloud/upload`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            sizeBytes: file.size,
            contentType: file.type || 'audio/mpeg',
          }),
        });
        const put = await fetch(prepared.uploadUrl, {
          method: 'PUT',
          headers: prepared.headers,
          body: file,
        });
        if (!put.ok) throw new Error(`Spaces upload failed (${put.status}).`);
        await json(`${api}/cloud/${prepared.item.id}/complete`, { method: 'POST' });
        // The source of truth is Spaces. This copy is the local playback cache
        // used while this browser is hosting the decks.
        cached.push(file);
      } catch (err) {
        setError(`${file.name}: ${(err as Error).message}`);
        break;
      } finally {
        setBusy(null);
      }
    }
    if (cached.length) cacheFiles(cached);
    load();
  };

  const cache = async (item: CloudItem) => {
    setBusy(item.id);
    setError(null);
    try {
      const { url } = await json(`${api}/cloud/${item.id}/url`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`CDN download failed (${response.status}).`);
      const blob = await response.blob();
      cacheFiles([new File([blob], item.name, { type: item.contentType })]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: CloudItem) => {
    if (!confirm(`Delete "${item.name}" from Deck Cloud?`)) return;
    setBusy(item.id);
    try {
      await json(`${api}/cloud/${item.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`panel library ${iAmHost ? 'is-hosting' : ''}`}>
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus,.aiff,.aif,.alac"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) void upload(event.target.files);
          event.target.value = '';
        }}
      />

      <header className="panel-head">
        <h2 className="panel-title"><Cloud size={13} /> Deck Cloud</h2>
        {iAmHost ? <span className="library-badge"><Radio size={11} /> HOSTING</span> : null}
      </header>

      {!cloud ? <p className="panel-empty">Connecting to Deck Cloud&hellip;</p> : !cloud.enabled ? (
        <p className="panel-empty">Deck Cloud has not been configured by the platform owner.</p>
      ) : (
        <>
          <div className="library-stats mono">
            {formatBytes(cloud.quota.usedBytes)} / {formatBytes(cloud.quota.limitBytes)}
            {cloud.cdn ? ' · CDN' : ' · private'}
          </div>
          <div className="library-actions">
            <button type="button" className="btn btn-primary" disabled={busy !== null || !library.supported} onClick={() => input.current?.click()}>
              <CloudUpload size={13} /> {busy ? 'WORKING…' : 'UPLOAD MUSIC'}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={load}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          <ul className="cloud-list">
            {cloud.media.map((item) => {
              const cached = media.find((track) => track.originalName === item.name && track.status === 'ready');
              return <li key={item.id} className={`cloud-row ${cached ? 'is-draggable' : ''}`}
                draggable={Boolean(cached)}
                onDragStart={(event) => {
                  if (!cached) return;
                  event.dataTransfer.setData('application/x-dj-media', cached.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}>
                <span className="cloud-name" title={item.name}>{item.name}</span>
                <span className="mono library-note">{formatBytes(item.sizeBytes)} · {cached ? 'ready to drag' : item.status}</span>
                <span className="cloud-actions">
                  {cached ? <><button type="button" className="btn tiny" disabled={locked} onClick={() => void send('deck:load', { deck: 'A', mediaId: cached.id })}>A</button>
                    <button type="button" className="btn tiny" disabled={locked} onClick={() => void send('deck:load', { deck: 'B', mediaId: cached.id })}>B</button></> :
                    <button type="button" className="btn tiny" disabled={busy !== null || item.status !== 'ready'} title="Cache in this browser for playback" onClick={() => void cache(item)}>
                      <CloudDownload size={12} /> CACHE
                    </button>}
                  <button type="button" className="btn tiny danger" disabled={busy !== null} aria-label={`Delete ${item.name}`} onClick={() => void remove(item)}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </li>;
            })}
            {cloud.media.length === 0 ? <li className="panel-empty">No cloud tracks yet.</li> : null}
          </ul>
        </>
      )}

      {library.scanning ? <p className="library-note">Preparing playback cache… {library.progress?.found ?? 0}</p> : null}
      {library.tracks.length ? <p className="library-note">{library.tracks.length} cloud track{library.tracks.length === 1 ? '' : 's'} cached in this browser. Use the Deck Cloud tracks panel to drag them onto a deck.</p> : null}
      {error || library.error ? <p className="library-error"><AlertTriangle size={12} /> {error ?? library.error}</p> : null}
    </section>
  );
}
