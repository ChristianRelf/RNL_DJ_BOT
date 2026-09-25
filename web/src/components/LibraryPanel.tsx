import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  CloudDownload,
  CloudUpload,
  Database,
  Pin,
  PinOff,
  Radio,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { HostState, MediaItem } from '../protocol';
import type { CloudMediaInfo } from '../lib/cloudCache';
import type { LibraryClient } from '../lib/useLibrary';
import { formatBytes } from '../lib/format';
import type { DjClient } from '../socket';

interface CloudItem extends CloudMediaInfo {
  createdBy: string;
  createdAt: number;
  verifiedAt: number | null;
  error: string | null;
}

interface CloudState {
  enabled: boolean;
  cdn: boolean;
  media: CloudItem[];
  quota: { usedBytes: number; limitBytes: number; remainingBytes: number; entitled: boolean; billingRequired: boolean };
  billing: { configured: boolean; entitled: boolean; status: string };
  cacheMetrics: { hits: number; misses: number; resumedBytes: number; evictions: number; corruptions: number };
}

interface LibraryPanelProps {
  library: LibraryClient;
  host: HostState;
  meId: string;
  api: string;
  media: MediaItem[];
  protectedMediaIds: string[];
  send: DjClient['send'];
  locked: boolean;
}

async function json(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

function stateLabel(state: string, pinned: boolean, progress?: number): string {
  if (progress !== undefined) return `${Math.round(progress * 100)}%`;
  if (state === 'ready') return pinned ? 'pinned locally' : 'ready locally';
  if (state === 'error') return 'retry available';
  if (state === 'stale') return 'stale';
  return 'cloud only';
}

export function LibraryPanel({
  library,
  host,
  meId,
  api,
  media,
  protectedMediaIds,
  send,
  locked,
}: LibraryPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [cloud, setCloud] = useState<CloudState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [budgetGb, setBudgetGb] = useState('');
  const iAmHost = host.hosted && host.userId === meId;
  const syncCloud = library.syncCloud;

  const protectedCloudIds = useMemo(() => new Set(
    media
      .filter((item) => protectedMediaIds.includes(item.id))
      .map((item) => item.cloudMediaId
        ?? cloud?.media.find((candidate) => candidate.name === item.originalName)?.id)
      .filter((id): id is string => Boolean(id)),
  ), [cloud?.media, media, protectedMediaIds]);

  const load = useCallback(async () => {
    try {
      const next = await json(`${api}/cloud`) as CloudState;
      setCloud(next);
      await syncCloud(next.media);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, syncCloud]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (files: FileList) => {
    setError(null);
    setNotice(null);
    for (const file of Array.from(files)) {
      setBusy(`Hashing ${file.name}`);
      try {
        const sha256 = await library.hashFile(file);
        setBusy(`Uploading ${file.name}`);
        const prepared = await json(`${api}/cloud/upload`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            sizeBytes: file.size,
            contentType: file.type || 'audio/mpeg',
            sha256,
          }),
        });

        let item = prepared.item as CloudItem;
        if (prepared.uploadUrl) {
          const put = await fetch(prepared.uploadUrl, {
            method: 'PUT',
            headers: prepared.headers,
            body: file,
          });
          if (!put.ok) throw new Error(`Cloud upload failed (${put.status}).`);
          item = (await json(`${api}/cloud/${item.id}/complete`, { method: 'POST' })).item;
        }

        setBusy(`Caching ${file.name}`);
        await library.cacheCloud(item, null, protectedCloudIds, file);
        setNotice(prepared.deduplicated
          ? `${file.name} was already in this rig; the existing cloud object was reused.`
          : `${file.name} is stored and verified locally.`);
      } catch (err) {
        setError(`${file.name}: ${(err as Error).message}`);
        break;
      } finally {
        setBusy(null);
      }
    }
    await load();
  };

  const cacheOne = async (item: CloudItem) => {
    setBusy(item.id);
    setError(null);
    setNotice(null);
    try {
      const { url, delivery } = await json(`${api}/cloud/${item.id}/url`);
      await library.cacheCloud(item, url, protectedCloudIds, undefined, delivery);
      setNotice(`${item.name} is ready on this device.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const preflight = async () => {
    if (!cloud) return;
    const targets = cloud.media.filter((item) => protectedCloudIds.has(item.id) && item.status === 'ready');
    const needed = targets.filter((item) => library.cache?.entries.find((entry) => entry.mediaId === item.id)?.state !== 'ready');
    if (!targets.length) {
      setNotice('Load or queue cloud tracks first; there is nothing to preflight yet.');
      return;
    }
    setBusy('preflight');
    setError(null);
    try {
      for (const item of needed) {
        const { url, delivery } = await json(`${api}/cloud/${item.id}/url`);
        await library.cacheCloud(item, url, protectedCloudIds, undefined, delivery);
      }
      setNotice(`${targets.length} protected track${targets.length === 1 ? '' : 's'} verified for the set.`);
    } catch (err) {
      setError(`Preflight stopped: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const removeCloud = async (item: CloudItem) => {
    if (!confirm(`Delete "${item.name}" from Deck Cloud?`)) return;
    setBusy(item.id);
    try {
      await json(`${api}/cloud/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const applyBudget = async () => {
    const gb = Number(budgetGb);
    if (!Number.isFinite(gb) || gb < 0.25) {
      setError('Enter a device cache budget of at least 0.25 GB.');
      return;
    }
    await library.setCacheBudget(gb * 1024 * 1024 * 1024);
    setNotice(`Device cache budget set to ${gb.toFixed(2)} GB.`);
  };

  const readyEntries = library.cache?.entries.filter((entry) => entry.state === 'ready').length ?? 0;
  const cacheUsed = library.cache?.usedBytes ?? 0;
  const cacheBudget = library.cache?.budgetBytes ?? 0;

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
          <div className="cloud-usage-grid mono">
            <span><Cloud size={11} /> Cloud <strong>{formatBytes(cloud.quota.usedBytes)}</strong> / {formatBytes(cloud.quota.limitBytes)}</span>
            <span><Database size={11} /> This device <strong>{formatBytes(cacheUsed)}</strong> / {formatBytes(cacheBudget)}</span>
          </div>
          <div className="library-stats mono">
            {readyEntries} local · {cloud.billing.configured ? cloud.billing.status : 'self-hosted'}
            {cloud.cdn ? ' · CDN' : ' · signed private links'}
          </div>
          {!cloud.quota.entitled ? (
            <p className="library-error"><AlertTriangle size={12} /> Subscription inactive. Ask the rig owner to update billing.</p>
          ) : null}

          <div className="cache-controls">
            <button type="button" className="btn btn-primary" disabled={busy !== null || !library.supported || !cloud.quota.entitled} onClick={() => input.current?.click()}>
              <CloudUpload size={13} /> {busy?.startsWith('Hashing') || busy?.startsWith('Uploading') ? busy.toUpperCase() : 'UPLOAD MUSIC'}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void preflight()}>
              <ShieldCheck size={13} /> PREFLIGHT SET
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void load()}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          <details className="cache-settings">
            <summary>Device cache settings</summary>
            <div className="cache-settings-body">
              <p>
                Browser storage is <strong>{library.cache?.persistent ?? 'unknown'}</strong>. Persistence prevents routine
                storage pressure from clearing prepared tracks; Deck still works if the browser declines it.
              </p>
              <div className="cache-setting-row">
                <button type="button" className="btn tiny" onClick={() => void library.requestPersistence().then((result) => setNotice(`Persistent storage: ${result}.`))}>
                  Request persistence
                </button>
                <input className="input" type="number" min="0.25" step="0.25" placeholder="Budget GB"
                  value={budgetGb} onChange={(event) => setBudgetGb(event.target.value)} />
                <button type="button" className="btn tiny" onClick={() => void applyBudget()}>Apply</button>
                <button type="button" className="btn tiny" onClick={() => void library.setCacheBudget(null).then(() => setNotice('Automatic cache budget restored.'))}>Auto</button>
              </div>
            </div>
          </details>

          <ul className="cloud-list">
            {cloud.media.map((item) => {
              const entry = library.cache?.entries.find((candidate) => candidate.mediaId === item.id);
              const cached = media.find((track) => track.cloudMediaId === item.id && track.status === 'ready')
                ?? media.find((track) => track.originalName === item.name && track.status === 'ready');
              const transfer = library.transfers[item.id];
              const ratio = transfer ? transfer.downloadedBytes / Math.max(1, transfer.totalBytes) : undefined;
              const ready = entry?.state === 'ready' && Boolean(cached);
              return <li key={item.id} className={`cloud-row ${ready ? 'is-draggable' : ''}`}
                draggable={ready}
                onDragStart={(event) => {
                  if (!cached || !ready) return;
                  event.dataTransfer.setData('application/x-dj-media', cached.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}>
                <span className="cloud-name" title={item.name}>{item.name}</span>
                <span className={`cloud-cache-state is-${entry?.state ?? 'cloud-only'}`}>
                  {entry?.pinned ? <Pin size={10} /> : null}
                  {formatBytes(item.sizeBytes)} · {stateLabel(entry?.state ?? 'cloud-only', entry?.pinned ?? false, ratio)}
                </span>
                {transfer ? <span className="cloud-progress"><span style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }} /></span> : null}
                {entry?.error ? <span className="cloud-entry-error">{entry.error}</span> : null}
                <span className="cloud-actions">
                  {ready && cached ? <>
                    <button type="button" className="btn tiny" disabled={locked} onClick={() => void send('deck:load', { deck: 'A', mediaId: cached.id })}>A</button>
                    <button type="button" className="btn tiny" disabled={locked} onClick={() => void send('deck:load', { deck: 'B', mediaId: cached.id })}>B</button>
                    <button type="button" className="btn tiny" title={entry?.pinned ? 'Allow automatic eviction' : 'Protect from automatic eviction'}
                      onClick={() => void library.pinCached(item.id, !entry?.pinned)}>
                      {entry?.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </button>
                    <button type="button" className="btn tiny" title="Remove only this device's copy"
                      onClick={() => void library.removeCached(item.id)}><X size={12} /> LOCAL</button>
                  </> : transfer ? (
                    <button type="button" className="btn tiny" onClick={() => library.cancelCache(item.id)}><X size={12} /> CANCEL</button>
                  ) : (
                    <button type="button" className="btn tiny" disabled={busy !== null || item.status !== 'ready'}
                      title={entry?.state === 'error' ? 'Resume the interrupted download' : 'Cache in this browser for playback'}
                      onClick={() => void cacheOne(item)}>
                      <CloudDownload size={12} /> {entry?.state === 'error' ? 'RETRY' : 'CACHE'}
                    </button>
                  )}
                  <button type="button" className="btn tiny danger" disabled={busy !== null}
                    aria-label={`Delete ${item.name} from Deck Cloud`} onClick={() => void removeCloud(item)}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </li>;
            })}
            {cloud.media.length === 0 ? <li className="panel-empty">No cloud tracks yet.</li> : null}
          </ul>
        </>
      )}

      {library.scanning ? <p className="library-note">Verifying playback cache… {library.progress?.found ?? 0}</p> : null}
      {notice ? <p className="library-success"><ShieldCheck size={12} /> {notice}</p> : null}
      {error || library.error ? <p className="library-error"><AlertTriangle size={12} /> {error ?? library.error}</p> : null}
    </section>
  );
}
