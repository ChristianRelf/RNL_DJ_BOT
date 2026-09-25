const DB_NAME = 'deck-cloud-cache';
const DB_VERSION = 1;
const ENTRY_STORE = 'entries';
const SETTINGS_STORE = 'settings';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 * 1024;
const HIGH_WATER = 0.85;
const LOW_WATER = 0.7;
const RECENT_MS = 60 * 60 * 1000;

export type CloudCacheEntryState =
  | 'cloud-only'
  | 'downloading'
  | 'ready'
  | 'stale'
  | 'error';

export interface CloudMediaInfo {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  status: 'pending' | 'ready' | 'error';
  etag: string | null;
  sha256: string | null;
}

export interface CloudCacheEntry {
  key: string;
  scope: string;
  mediaId: string;
  name: string;
  fileName: string;
  contentType: string;
  etag: string | null;
  byteLength: number;
  downloadedBytes: number;
  lastAccess: number;
  verifiedAt: number | null;
  state: CloudCacheEntryState;
  pinned: boolean;
  retryCount: number;
  error: string | null;
  trackId?: string;
}

export type PersistenceState = 'unsupported' | 'unknown' | 'granted' | 'denied';

export interface CloudCacheSnapshot {
  entries: CloudCacheEntry[];
  sourceBytes: number;
  decodedBytes: number;
  usedBytes: number;
  budgetBytes: number;
  quotaBytes: number;
  persistent: PersistenceState;
  evictions: number;
  corruptions: number;
}

export interface ScanHint {
  name: string;
  cloudMediaId: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ENTRY_STORE)) {
        const entries = database.createObjectStore(ENTRY_STORE, { keyPath: 'key' });
        entries.createIndex('scope', 'scope');
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function request<T>(run: (database: IDBDatabase) => IDBRequest<T>): Promise<T> {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const found = run(database);
    found.onsuccess = () => resolve(found.result);
    found.onerror = () => reject(found.error);
  });
}

async function write(store: string, run: (objectStore: IDBObjectStore) => void): Promise<void> {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    run(transaction.objectStore(store));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was aborted.'));
  });
}

function entryKey(scope: string, mediaId: string): string {
  return `${scope}:${mediaId}`;
}

export async function listCacheEntries(scope: string): Promise<CloudCacheEntry[]> {
  return request((database) => database
    .transaction(ENTRY_STORE, 'readonly')
    .objectStore(ENTRY_STORE)
    .index('scope')
    .getAll(scope));
}

export async function saveCacheEntry(entry: CloudCacheEntry): Promise<void> {
  await write(ENTRY_STORE, (store) => { store.put(entry); });
}

async function deleteEntry(key: string): Promise<void> {
  await write(ENTRY_STORE, (store) => { store.delete(key); });
}

function safeScope(scope: string): string {
  return scope.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'default';
}

let legacySourceCleanupStarted = false;

function extension(name: string): string {
  return name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0]?.toLowerCase() ?? '.media';
}

export function cloudFileName(item: Pick<CloudMediaInfo, 'id' | 'name'>): string {
  return `${item.id}${extension(item.name)}`;
}

export async function cloudSourceDirectory(scope: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const deck = await root.getDirectoryHandle('deck', { create: true });
  if (!legacySourceCleanupStarted) {
    legacySourceCleanupStarted = true;
    // Older Deck builds put every rig's disposable sources in deck/music and
    // matched them by filename. They cannot be assigned to a tenant safely, so
    // discard that cache once and let the verified per-rig cache refill it.
    await deck.removeEntry('music', { recursive: true }).catch(() => undefined);
  }
  const cloud = await deck.getDirectoryHandle('cloud', { create: true });
  const rig = await cloud.getDirectoryHandle(safeScope(scope), { create: true });
  return rig.getDirectoryHandle('source', { create: true });
}

async function sourceSize(scope: string, fileName: string): Promise<number> {
  try {
    const handle = await (await cloudSourceDirectory(scope)).getFileHandle(fileName);
    return (await handle.getFile()).size;
  } catch {
    return 0;
  }
}

async function removeSource(scope: string, fileName: string): Promise<void> {
  try {
    await (await cloudSourceDirectory(scope)).removeEntry(fileName);
  } catch {
    // A cache entry can outlive a browser storage purge. Missing is success.
  }
}

function freshEntry(scope: string, item: CloudMediaInfo): CloudCacheEntry {
  return {
    key: entryKey(scope, item.id),
    scope,
    mediaId: item.id,
    name: item.name,
    fileName: cloudFileName(item),
    contentType: item.contentType,
    etag: item.etag,
    byteLength: item.sizeBytes,
    downloadedBytes: 0,
    lastAccess: 0,
    verifiedAt: null,
    state: 'cloud-only',
    pinned: false,
    retryCount: 0,
    error: null,
  };
}

/**
 * Makes the IndexedDB manifest agree with the server and the bytes in OPFS.
 * A ready entry is trusted only after both identity and byte length match.
 */
export async function reconcileLocalCache(
  scope: string,
  media: CloudMediaInfo[],
): Promise<{ entries: CloudCacheEntry[]; corruptions: number }> {
  const existing = new Map((await listCacheEntries(scope)).map((entry) => [entry.mediaId, entry]));
  const server = new Map(media.map((item) => [item.id, item]));
  let corruptions = 0;

  for (const entry of existing.values()) {
    if (server.has(entry.mediaId)) continue;
    await removeSource(scope, entry.fileName);
    await deleteEntry(entry.key);
    existing.delete(entry.mediaId);
  }

  for (const item of media) {
    let entry = existing.get(item.id) ?? freshEntry(scope, item);
    const identityChanged = entry.etag !== item.etag || entry.byteLength !== item.sizeBytes;
    if (identityChanged) {
      await removeSource(scope, entry.fileName);
      entry = { ...freshEntry(scope, item), pinned: entry.pinned, state: 'stale' };
    } else {
      entry = { ...entry, name: item.name, contentType: item.contentType };
    }

    const bytes = await sourceSize(scope, entry.fileName);
    if (entry.state === 'ready' && bytes !== entry.byteLength) {
      await removeSource(scope, entry.fileName);
      entry = {
        ...entry,
        downloadedBytes: 0,
        verifiedAt: null,
        state: 'error',
        error: 'The local copy was incomplete and has been removed.',
        trackId: undefined,
      };
      corruptions++;
    } else if (bytes === entry.byteLength && item.status === 'ready') {
      entry = {
        ...entry,
        downloadedBytes: bytes,
        verifiedAt: Date.now(),
        state: 'ready',
        error: null,
      };
    } else if (bytes > 0 && bytes < entry.byteLength) {
      entry = { ...entry, downloadedBytes: bytes, state: 'error', error: 'Download paused; retry to resume.' };
    } else if (item.status !== 'ready') {
      entry = { ...entry, state: item.status === 'error' ? 'error' : 'cloud-only' };
    }
    await saveCacheEntry(entry);
    existing.set(item.id, entry);
  }

  return { entries: [...existing.values()], corruptions };
}

export function scanHints(entries: CloudCacheEntry[]): Map<string, ScanHint> {
  return new Map(entries
    .filter((entry) => entry.state === 'ready')
    .map((entry) => [entry.fileName, { name: entry.name, cloudMediaId: entry.mediaId }]));
}

export async function rememberTrackMappings(
  entries: CloudCacheEntry[],
  tracks: Array<{ path: string; trackId: string }>,
): Promise<CloudCacheEntry[]> {
  const byPath = new Map(tracks.map((track) => [track.path, track.trackId]));
  const next: CloudCacheEntry[] = [];
  for (const entry of entries) {
    const trackId = byPath.get(entry.fileName);
    const updated = trackId && entry.trackId !== trackId ? { ...entry, trackId } : entry;
    if (updated !== entry) await saveCacheEntry(updated);
    next.push(updated);
  }
  return next;
}

async function setting<T>(key: string): Promise<T | undefined> {
  return request((database) => database
    .transaction(SETTINGS_STORE, 'readonly')
    .objectStore(SETTINGS_STORE)
    .get(key));
}

async function saveSetting(key: string, value: unknown): Promise<void> {
  await write(SETTINGS_STORE, (store) => { store.put(value, key); });
}

export async function storageBudget(scope: string): Promise<{ budgetBytes: number; quotaBytes: number }> {
  const estimate = await navigator.storage.estimate();
  const quotaBytes = estimate.quota ?? DEFAULT_MAX_BYTES;
  const automatic = Math.min(
    quotaBytes,
    Math.max(256 * 1024 * 1024, Math.min(DEFAULT_MAX_BYTES, quotaBytes * 0.6)),
  );
  const override = await setting<number>(`budget:${scope}`).catch(() => undefined);
  return { budgetBytes: override && override > 0 ? Math.min(override, quotaBytes) : automatic, quotaBytes };
}

export async function setStorageBudget(scope: string, bytes: number | null): Promise<void> {
  await saveSetting(`budget:${scope}`, bytes && bytes > 0 ? Math.round(bytes) : null);
}

export async function persistenceState(): Promise<PersistenceState> {
  if (!navigator.storage?.persisted) return 'unsupported';
  return (await navigator.storage.persisted()) ? 'granted' : 'unknown';
}

export async function requestPersistence(): Promise<PersistenceState> {
  if (!navigator.storage?.persist) return 'unsupported';
  return (await navigator.storage.persist()) ? 'granted' : 'denied';
}

export async function cacheSnapshot(
  scope: string,
  entries?: CloudCacheEntry[],
  counters: { evictions?: number; corruptions?: number } = {},
): Promise<CloudCacheSnapshot> {
  const found = entries ?? await listCacheEntries(scope);
  const { budgetBytes, quotaBytes } = await storageBudget(scope);
  return {
    entries: found,
    sourceBytes: found.reduce((total, entry) => total + entry.downloadedBytes, 0),
    decodedBytes: 0,
    usedBytes: found.reduce((total, entry) => total + entry.downloadedBytes, 0),
    budgetBytes,
    quotaBytes,
    persistent: await persistenceState(),
    evictions: counters.evictions ?? 0,
    corruptions: counters.corruptions ?? 0,
  };
}

export async function prepareCacheWrite(
  scope: string,
  item: CloudMediaInfo,
  protectedMediaIds: Set<string>,
  otherUsedBytes = 0,
): Promise<{ entry: CloudCacheEntry; evicted: CloudCacheEntry[]; resumeAt: number }> {
  const entries = await listCacheEntries(scope);
  const current = entries.find((entry) => entry.mediaId === item.id) ?? freshEntry(scope, item);
  const sameObject = current.etag === item.etag && current.byteLength === item.sizeBytes;
  const resumeAt = sameObject ? Math.min(await sourceSize(scope, current.fileName), item.sizeBytes) : 0;
  if (!sameObject) await removeSource(scope, current.fileName);

  const { budgetBytes } = await storageBudget(scope);
  let used = otherUsedBytes + entries.reduce((total, entry) => total + entry.downloadedBytes, 0) - current.downloadedBytes;
  const projected = used + item.sizeBytes;
  const evicted: CloudCacheEntry[] = [];
  if (projected >= budgetBytes * HIGH_WATER) {
    const targetBeforeWrite = Math.max(0, budgetBytes * LOW_WATER - item.sizeBytes);
    const candidates = entries
      .filter((entry) => entry.mediaId !== item.id && entry.state === 'ready' && !entry.pinned)
      .filter((entry) => !protectedMediaIds.has(entry.mediaId) && Date.now() - entry.lastAccess > RECENT_MS)
      .sort((a, b) => a.lastAccess - b.lastAccess);
    for (const candidate of candidates) {
      if (used <= targetBeforeWrite) break;
      await removeSource(scope, candidate.fileName);
      const cleared = { ...candidate, downloadedBytes: 0, verifiedAt: null,
        state: 'cloud-only' as const, error: null, trackId: undefined };
      await saveCacheEntry(cleared);
      used -= candidate.downloadedBytes;
      evicted.push(candidate);
    }
  }
  if (used + item.sizeBytes > budgetBytes) {
    throw new Error('The local cache budget is full. Unpin or remove a track, or increase the device budget.');
  }

  const entry: CloudCacheEntry = {
    ...current,
    key: entryKey(scope, item.id),
    scope,
    mediaId: item.id,
    name: item.name,
    fileName: sameObject ? current.fileName : cloudFileName(item),
    contentType: item.contentType,
    etag: item.etag,
    byteLength: item.sizeBytes,
    downloadedBytes: resumeAt,
    state: 'downloading',
    error: null,
  };
  await saveCacheEntry(entry);
  return { entry, evicted, resumeAt };
}

export async function completeCacheWrite(entry: CloudCacheEntry): Promise<CloudCacheEntry> {
  const bytes = await sourceSize(entry.scope, entry.fileName);
  if (bytes !== entry.byteLength) throw new Error(`Downloaded ${bytes} bytes; expected ${entry.byteLength}.`);
  const updated = { ...entry, downloadedBytes: bytes, lastAccess: Date.now(), verifiedAt: Date.now(),
    state: 'ready' as const, retryCount: 0, error: null };
  await saveCacheEntry(updated);
  return updated;
}

export async function failCacheWrite(entry: CloudCacheEntry, error: string): Promise<CloudCacheEntry> {
  const downloadedBytes = await sourceSize(entry.scope, entry.fileName);
  const updated = { ...entry, downloadedBytes, state: 'error' as const,
    retryCount: entry.retryCount + 1, error: error.slice(0, 240) };
  await saveCacheEntry(updated);
  return updated;
}

export async function seedCacheFile(
  entry: CloudCacheEntry,
  file: File,
): Promise<CloudCacheEntry> {
  if (file.size !== entry.byteLength) throw new Error('The upload and local cache sizes do not match.');
  const directory = await cloudSourceDirectory(entry.scope);
  const handle = await directory.getFileHandle(entry.fileName, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(file);
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => undefined);
    throw err;
  }
  return completeCacheWrite(entry);
}

export async function removeCachedSource(entry: CloudCacheEntry): Promise<CloudCacheEntry> {
  await removeSource(entry.scope, entry.fileName);
  const updated = { ...entry, downloadedBytes: 0, verifiedAt: null,
    state: 'cloud-only' as const, error: null, trackId: undefined };
  await saveCacheEntry(updated);
  return updated;
}

export async function setCachePinned(entry: CloudCacheEntry, pinned: boolean): Promise<CloudCacheEntry> {
  const updated = { ...entry, pinned };
  await saveCacheEntry(updated);
  return updated;
}

export async function touchCachedSource(scope: string, mediaId: string): Promise<void> {
  const entries = await listCacheEntries(scope);
  const entry = entries.find((item) => item.mediaId === mediaId);
  if (!entry || entry.state !== 'ready') return;
  await saveCacheEntry({ ...entry, lastAccess: Date.now() });
}
