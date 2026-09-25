import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { browserStorageSupported, type FolderStatus, type ScannedTrack } from './folder';
import { Library } from './library';
import {
  cacheSnapshot,
  cloudSourceDirectory,
  completeCacheWrite,
  failCacheWrite,
  listCacheEntries,
  prepareCacheWrite,
  reconcileLocalCache,
  rememberTrackMappings,
  removeCachedSource,
  requestPersistence as askForPersistence,
  saveCacheEntry,
  scanHints,
  seedCacheFile,
  setCachePinned,
  setStorageBudget,
  touchCachedSource,
  type CloudCacheEntry,
  type CloudCacheSnapshot,
  type CloudMediaInfo,
  type PersistenceState,
} from './cloudCache';
import type { CloudDownloadReply, CloudDownloadRequest } from './cloudDownloadWorker';
import type { AudioNeedMessage } from '../protocol';

export interface CacheTransfer {
  mediaId: string;
  downloadedBytes: number;
  totalBytes: number;
  resumedBytes: number;
}

export interface LibraryClient {
  supported: boolean;
  status: FolderStatus;
  folderName: string | null;
  tracks: ScannedTrack[];
  scanning: boolean;
  progress: { found: number; current: string } | null;
  decoding: string[];
  error: string | null;
  cache: CloudCacheSnapshot | null;
  transfers: Record<string, CacheTransfer>;
  hashFile: (file: File) => Promise<string>;
  syncCloud: (items: CloudMediaInfo[]) => Promise<void>;
  cacheCloud: (
    item: CloudMediaInfo,
    url: string | null,
    protectedCloudIds: Set<string>,
    seed?: File,
    delivery?: 'cdn' | 'origin',
  ) => Promise<void>;
  cancelCache: (mediaId: string) => void;
  removeCached: (mediaId: string) => Promise<void>;
  pinCached: (mediaId: string, pinned: boolean) => Promise<void>;
  requestPersistence: () => Promise<PersistenceState>;
  setCacheBudget: (bytes: number | null) => Promise<void>;
  rescan: () => void;
}

interface PendingWorkerTask {
  mediaId?: string;
  entry?: CloudCacheEntry;
  resolve: (reply: CloudDownloadReply) => void;
  reject: (error: Error) => void;
}

type RunnableWorkerRequest = CloudDownloadRequest extends infer Request
  ? Request extends { kind: 'hash' | 'download' }
    ? Omit<Request, 'id'>
    : never
  : never;

/**
 * Hosts one rig's verified Deck Cloud sources and decoded audio. Source files,
 * manifests and decoded PCM are all namespaced by guild so browser storage can
 * never make one tenant's library visible to another.
 */
export function useLibrary(socket: Socket | null, guildId: string | null): LibraryClient {
  const [status, setStatus] = useState<FolderStatus>('none');
  const [folderName, setFolderName] = useState<string | null>(null);
  const [tracks, setTracks] = useState<ScannedTrack[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ found: number; current: string } | null>(null);
  const [decoding, setDecoding] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<CloudCacheSnapshot | null>(null);
  const [transfers, setTransfers] = useState<Record<string, CacheTransfer>>({});

  const socketRef = useRef<Socket | null>(null);
  socketRef.current = socket;
  const libraryRef = useRef<Library | null>(null);
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const tracksRef = useRef<ScannedTrack[]>([]);
  const cacheEntriesRef = useRef<CloudCacheEntry[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const workerTasksRef = useRef(new Map<number, PendingWorkerTask>());
  const workerSequenceRef = useRef(1);
  const transferIdsRef = useRef(new Map<string, number>());
  const sourceHitsRef = useRef(new Map<string, { trackId: string; at: number }>());
  const countersRef = useRef({ evictions: 0, corruptions: 0 });

  const supported = useMemo(() => browserStorageSupported(), []);

  const reportMetrics = useCallback((delta: Record<string, number>) => {
    if (!guildId) return;
    void fetch(`/api/g/${encodeURIComponent(guildId)}/cloud/cache-metrics`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(delta),
      keepalive: true,
    }).catch(() => undefined);
  }, [guildId]);

  if (guildId && !libraryRef.current && typeof Worker !== 'undefined') {
    libraryRef.current = new Library(guildId, {
      onScanProgress: (found, current) => setProgress({ found, current }),
      onDecodeStart: (id) => setDecoding((prev) => (prev.includes(id) ? prev : [...prev, id])),
      onDecodeDone: (id) => setDecoding((prev) => prev.filter((trackId) => trackId !== id)),
      onError: (message) => setError(message),
      onTracks: (next) => {
        tracksRef.current = next;
        setTracks(next);
        socketRef.current?.emit('host:tracks', { tracks: next });
      },
      onPeaks: (trackId, peaks, frames, loudnessLufs, truePeakDb) => {
        socketRef.current?.emit('media:peaks', { trackId, peaks, frames, loudnessLufs, truePeakDb });
      },
    });
  }

  if (guildId && !workerRef.current && typeof Worker !== 'undefined') {
    const worker = new Worker(new URL('./cloudDownloadWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<CloudDownloadReply>) => {
      const reply = event.data;
      const task = workerTasksRef.current.get(reply.id);
      if (!task) return;

      if (reply.kind === 'progress') {
        if (task.mediaId && task.entry) {
          setTransfers((current) => ({
            ...current,
            [task.mediaId as string]: {
              mediaId: task.mediaId as string,
              downloadedBytes: reply.downloadedBytes,
              totalBytes: task.entry?.byteLength ?? reply.downloadedBytes,
              resumedBytes: reply.resumedBytes,
            },
          }));
        }
        return;
      }

      workerTasksRef.current.delete(reply.id);
      if (task.mediaId) {
        transferIdsRef.current.delete(task.mediaId);
        setTransfers((current) => {
          const next = { ...current };
          delete next[task.mediaId as string];
          return next;
        });
      }
      if (reply.kind === 'error') task.reject(new Error(reply.error));
      else task.resolve(reply);
    });
    workerRef.current = worker;
  }

  const runWorker = useCallback((
    message: RunnableWorkerRequest,
    mediaId?: string,
    entry?: CloudCacheEntry,
  ): Promise<CloudDownloadReply> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('Cache worker is unavailable.'));
    const id = workerSequenceRef.current++;
    return new Promise((resolve, reject) => {
      workerTasksRef.current.set(id, { mediaId, entry, resolve, reject });
      if (mediaId) transferIdsRef.current.set(mediaId, id);
      worker.postMessage({ ...message, id } as CloudDownloadRequest);
    });
  }, []);

  const refreshSnapshot = useCallback(async (entries?: CloudCacheEntry[]) => {
    if (!guildId || !supported) return;
    const found = entries ?? await listCacheEntries(guildId);
    cacheEntriesRef.current = found;
    const [snapshot, decoded] = await Promise.all([
      cacheSnapshot(guildId, found, countersRef.current),
      libraryRef.current?.usage() ?? Promise.resolve({ bytes: 0, tracks: 0 }),
    ]);
    setCache({ ...snapshot, decodedBytes: decoded.bytes, usedBytes: snapshot.sourceBytes + decoded.bytes });
  }, [guildId, supported]);

  const scanAndClaim = useCallback(async (entries?: CloudCacheEntry[]) => {
    const library = libraryRef.current;
    const handle = handleRef.current;
    if (!library || !handle || !guildId) return;

    setScanning(true);
    setError(null);
    try {
      const manifest = entries ?? cacheEntriesRef.current;
      const found = await library.scan(handle, scanHints(manifest));
      tracksRef.current = found;
      setTracks(found);
      const mapped = await rememberTrackMappings(manifest, found);
      await refreshSnapshot(mapped);

      if (socket?.connected) {
        socket.emit('host:claim', { tracks: found }, (ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) setError(ack?.error ?? 'Could not start hosting.');
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [guildId, refreshSnapshot, socket]);

  useEffect(() => {
    let cancelled = false;
    if (!guildId || !supported) {
      setStatus(supported ? 'none' : 'unsupported');
      return;
    }
    void (async () => {
      try {
        const [handle, entries] = await Promise.all([
          cloudSourceDirectory(guildId),
          listCacheEntries(guildId),
        ]);
        if (cancelled) return;
        handleRef.current = handle;
        cacheEntriesRef.current = entries;
        setFolderName('Deck Cloud cache');
        setStatus('granted');
        await refreshSnapshot(entries);
        if (!cancelled) await scanAndClaim(entries);
      } catch (err) {
        if (!cancelled) {
          setStatus('none');
          setError(`Could not open the Deck Cloud cache: ${(err as Error).message}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [guildId, refreshSnapshot, scanAndClaim, supported]);

  useEffect(() => () => {
    libraryRef.current?.dispose();
    workerRef.current?.terminate();
    for (const task of workerTasksRef.current.values()) task.reject(new Error('Cache worker stopped.'));
    workerTasksRef.current.clear();
  }, []);

  useEffect(() => {
    if (!socket || status !== 'granted' || !handleRef.current) return;
    const offer = () => {
      if (tracksRef.current.length > 0) socket.emit('host:claim', { tracks: tracksRef.current });
      else void scanAndClaim();
    };
    if (socket.connected) offer();
    socket.on('connect', offer);
    return () => { socket.off('connect', offer); };
  }, [scanAndClaim, socket, status]);

  useEffect(() => {
    const library = libraryRef.current;
    if (!socket || !library) return;

    const onNeed = (need: AudioNeedMessage) => {
      const track = tracksRef.current.find((item) => item.trackId === need.trackId);
      const lastHit = sourceHitsRef.current.get(need.sourceKey);
      if (track?.cloudMediaId && (!lastHit || lastHit.trackId !== need.trackId || Date.now() - lastHit.at > 5 * 60_000)) {
        sourceHitsRef.current.set(need.sourceKey, { trackId: need.trackId, at: Date.now() });
        void touchCachedSource(guildId ?? 'default', track.cloudMediaId);
        reportMetrics({ hits: 1 });
      }
      void (async () => {
        try {
          const served = await library.serve(need);
          if (served && served.frames > 0) {
            socket.emit('audio:chunk', { sourceKey: need.sourceKey, fromFrame: need.fromFrame, seq: need.seq }, served.pcm);
            return;
          }
        } catch {
          // The explicit refusal below releases the server's in-flight slot.
        }
        socket.emit('audio:none', { sourceKey: need.sourceKey, fromFrame: need.fromFrame, seq: need.seq });
      })();
    };

    const onCueNeed = (need: { requestId: string; trackId: string; fromFrame: number; frames: number }) => {
      void (async () => {
        try {
          const served = await library.serve({ sourceKey: 'cue', trackId: need.trackId,
            fromFrame: need.fromFrame, frames: need.frames, seq: 0 });
          socket.emit('cue:chunk', { requestId: need.requestId }, served?.pcm ?? new ArrayBuffer(0));
        } catch {
          socket.emit('cue:chunk', { requestId: need.requestId }, new ArrayBuffer(0));
        }
      })();
    };
    socket.on('audio:need', onNeed);
    socket.on('cue:need', onCueNeed);
    return () => {
      socket.off('audio:need', onNeed);
      socket.off('cue:need', onCueNeed);
    };
  }, [guildId, reportMetrics, socket]);

  const hashFile = useCallback(async (file: File): Promise<string> => {
    const reply = await runWorker({ kind: 'hash', file });
    if (reply.kind !== 'hash') throw new Error('The cache worker returned an invalid hash response.');
    return reply.sha256;
  }, [runWorker]);

  const syncCloud = useCallback(async (items: CloudMediaInfo[]): Promise<void> => {
    if (!guildId || !supported) return;
    const result = await reconcileLocalCache(guildId, items);
    countersRef.current.corruptions += result.corruptions;
    if (result.corruptions) reportMetrics({ corruptions: result.corruptions });
    await refreshSnapshot(result.entries);
    await scanAndClaim(result.entries);
  }, [guildId, refreshSnapshot, reportMetrics, scanAndClaim, supported]);

  const cacheCloud = useCallback(async (
    item: CloudMediaInfo,
    url: string | null,
    protectedCloudIds: Set<string>,
    seed?: File,
    delivery?: 'cdn' | 'origin',
  ): Promise<void> => {
    if (!guildId) throw new Error('No rig is selected.');
    const decoded = await libraryRef.current?.usage();
    const prepared = await prepareCacheWrite(guildId, item, protectedCloudIds, decoded?.bytes ?? 0);
    countersRef.current.evictions += prepared.evicted.length;
    for (const evicted of prepared.evicted) {
      if (evicted.trackId) await libraryRef.current?.forget(evicted.trackId);
    }
    reportMetrics({ evictions: prepared.evicted.length });
    await refreshSnapshot();

    let entry = prepared.entry;
    try {
      let resumedBytes = 0;
      if (seed) {
        entry = await seedCacheFile(entry, seed);
      } else {
        if (!url) throw new Error('No download URL was supplied.');
        reportMetrics({ misses: 1 });
        setTransfers((current) => ({
          ...current,
          [item.id]: { mediaId: item.id, downloadedBytes: prepared.resumeAt,
            totalBytes: entry.byteLength, resumedBytes: prepared.resumeAt },
        }));
        const reply = await runWorker({ kind: 'download', scope: guildId,
          fileName: entry.fileName, url, expectedBytes: entry.byteLength,
          expectedEtag: entry.etag, resumeAt: prepared.resumeAt }, item.id, entry);
        if (reply.kind !== 'done') throw new Error('The cache worker returned an invalid download response.');
        resumedBytes = reply.resumedBytes;
        entry = await completeCacheWrite(entry);
        const transferred = entry.byteLength - resumedBytes;
        reportMetrics({ downloads: 1, downloadedBytes: transferred, resumedBytes,
          ...(delivery === 'cdn' ? { cdnBytes: transferred } : { originBytes: transferred }) });
      }
      await saveCacheEntry(entry);
      await refreshSnapshot();
      await scanAndClaim();
    } catch (err) {
      await failCacheWrite(entry, (err as Error).message);
      await refreshSnapshot();
      throw err;
    } finally {
      setTransfers((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
  }, [guildId, refreshSnapshot, reportMetrics, runWorker, scanAndClaim]);

  const cancelCache = useCallback((mediaId: string) => {
    const id = transferIdsRef.current.get(mediaId);
    if (id !== undefined) workerRef.current?.postMessage({ id, kind: 'cancel' } satisfies CloudDownloadRequest);
  }, []);

  const removeCached = useCallback(async (mediaId: string): Promise<void> => {
    const entry = cacheEntriesRef.current.find((item) => item.mediaId === mediaId);
    if (!entry) return;
    if (entry.trackId) await libraryRef.current?.forget(entry.trackId);
    const updated = await removeCachedSource(entry);
    await refreshSnapshot(cacheEntriesRef.current.map((item) => item.mediaId === mediaId ? updated : item));
    await scanAndClaim();
  }, [refreshSnapshot, scanAndClaim]);

  const pinCached = useCallback(async (mediaId: string, pinned: boolean): Promise<void> => {
    const entry = cacheEntriesRef.current.find((item) => item.mediaId === mediaId);
    if (!entry) return;
    const updated = await setCachePinned(entry, pinned);
    await refreshSnapshot(cacheEntriesRef.current.map((item) => item.mediaId === mediaId ? updated : item));
  }, [refreshSnapshot]);

  const requestPersistence = useCallback(async (): Promise<PersistenceState> => {
    const result = await askForPersistence();
    await refreshSnapshot();
    setCache((current) => current ? { ...current, persistent: result } : current);
    return result;
  }, [refreshSnapshot]);

  const setCacheBudget = useCallback(async (bytes: number | null): Promise<void> => {
    if (!guildId) return;
    await setStorageBudget(guildId, bytes);
    await refreshSnapshot();
  }, [guildId, refreshSnapshot]);

  const rescan = useCallback(() => { void scanAndClaim(); }, [scanAndClaim]);

  return useMemo(() => ({
    supported,
    status,
    folderName,
    tracks,
    scanning,
    progress,
    decoding,
    error,
    cache,
    transfers,
    hashFile,
    syncCloud,
    cacheCloud,
    cancelCache,
    removeCached,
    pinCached,
    requestPersistence,
    setCacheBudget,
    rescan,
  }), [cache, cacheCloud, cancelCache, decoding, error, folderName, hashFile, pinCached,
    progress, removeCached, requestPersistence, rescan, scanning, setCacheBudget, status,
    supported, syncCloud, tracks, transfers]);
}
