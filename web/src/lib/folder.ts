/**
 * The music folder.
 *
 * Deck plays straight off a folder on your machine. Nothing is uploaded, and
 * nothing is copied - the files stay where they are and are opened read-only,
 * a window at a time, as the decks ask for them.
 *
 * The folder handle itself is kept in IndexedDB, which is what makes this
 * survive a refresh: reopening the console is one click to re-grant access
 * rather than picking the folder again.
 */

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'm4a', 'aac', 'flac', 'wav', 'aiff', 'aif', 'ogg', 'oga', 'opus', 'wma', 'alac', 'mp4',
]);

/** Guards against somebody pointing this at a whole drive. */
const MAX_DEPTH = 8;
const MAX_FILES = 20_000;

/** Bytes taken from each end of a file to identify it. See `identify`. */
const FINGERPRINT_BYTES = 64 * 1024;

const DB_NAME = 'deck-library';
const DB_VERSION = 1;
const STORE = 'handles';
const META_STORE = 'meta';
const HANDLE_KEY = 'music-folder';

export interface ScannedTrack {
  trackId: string;
  title: string;
  /** Path relative to the chosen folder, for telling two copies apart. */
  path: string;
  frames: number;
  sizeBytes: number;
}

/** What a scan found, plus the handles needed to actually read any of it. */
export interface ScanResult {
  tracks: ScannedTrack[];
  files: Map<string, FileSystemFileHandle>;
  skipped: number;
}

export type FolderStatus = 'none' | 'granted' | 'needs-permission' | 'unsupported';

/* --------------------------------------------------------------- storage */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ------------------------------------------------------------ the folder */

export function folderPickerSupported(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

type PermissionMode = { mode: 'read' };
type WithPermissions = FileSystemDirectoryHandle & {
  queryPermission?: (d: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (d: PermissionMode) => Promise<PermissionState>;
};

/**
 * The folder from last time, if there is one.
 *
 * A handle can come back in three states, and they need different things from
 * the person sitting there: already granted, needing a click to re-grant, or
 * gone entirely. `requestPermission` cannot be called here - it needs a user
 * gesture - which is exactly why "needs-permission" is a state and not an error.
 */
export async function restoreFolder(): Promise<{
  status: FolderStatus;
  handle: FileSystemDirectoryHandle | null;
}> {
  if (!folderPickerSupported()) return { status: 'unsupported', handle: null };

  const handle = await idbGet<WithPermissions>(STORE, HANDLE_KEY).catch(() => undefined);
  if (!handle) return { status: 'none', handle: null };

  const state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'prompt';
  if (state === 'granted') return { status: 'granted', handle };
  return { status: 'needs-permission', handle };
}

/** Re-grants access to a remembered folder. Must be called from a click. */
export async function regrantFolder(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const withPermissions = handle as WithPermissions;
  const state = (await withPermissions.requestPermission?.({ mode: 'read' })) ?? 'denied';
  return state === 'granted';
}

/** Asks for a folder and remembers it. Must be called from a click. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (
    globalThis as unknown as {
      showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;

  try {
    const handle = await picker({ mode: 'read', id: 'deck-library', startIn: 'music' });
    await idbPut(STORE, HANDLE_KEY, handle);
    return handle;
  } catch {
    // The picker throws on cancel, which is not an error worth reporting.
    return null;
  }
}

export async function forgetFolder(): Promise<void> {
  await idbPut(STORE, HANDLE_KEY, undefined).catch(() => undefined);
}

/* ------------------------------------------------------------- identity */

/**
 * What makes a file the same file across a rescan.
 *
 * A hash of its size and the bytes at each end, rather than its path - so
 * renaming a track, or moving it between folders, keeps everything the server
 * knows about it: the beat grid, the cue point, the tags. Paths are the one
 * thing about a music library that changes constantly.
 *
 * Only the ends are read, because hashing whole files would mean reading the
 * entire library off disk on every scan. Two different tracks sharing a size,
 * their first 64 KB and their last 64 KB is not a thing that happens by
 * accident.
 */
async function identify(file: File): Promise<string> {
  const head = await file.slice(0, FINGERPRINT_BYTES).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - FINGERPRINT_BYTES)).arrayBuffer();

  const stamp = new TextEncoder().encode(`${file.size}:`);
  const buffer = new Uint8Array(stamp.length + head.byteLength + tail.byteLength);
  buffer.set(stamp, 0);
  buffer.set(new Uint8Array(head), stamp.length);
  buffer.set(new Uint8Array(tail), stamp.length + head.byteLength);

  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Duration, read off the file's own metadata rather than by decoding it.
 *
 * Approximate for variable-bitrate files, and deliberately so: an exact frame
 * count costs a full decode, which is the thing that makes pointing at a large
 * folder unbearable. The exact number lands later, the first time the track is
 * actually loaded onto a deck, and corrects this one.
 */
function probeFrames(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (frames: number) => {
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(frames);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const seconds = Number.isFinite(audio.duration) ? audio.duration : 0;
      done(Math.round(seconds * 48000));
    };
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

/* ----------------------------------------------------------------- scan */

interface CachedMeta {
  trackId: string;
  frames: number;
}

/** Keyed on the things that change when a file's contents change. */
const metaKey = (path: string, size: number, modified: number) => `${path}|${size}|${modified}`;

function titleOf(name: string): string {
  return name.replace(/\.[^.]+$/, '').slice(0, 200) || name;
}

/**
 * Walks the folder and reports what is playable.
 *
 * Fingerprints and durations are cached against size and modified-time, so a
 * rescan of a folder that has not changed does almost no work - which matters,
 * because a rescan happens every time the console reconnects.
 */
export async function scanFolder(
  handle: FileSystemDirectoryHandle,
  onProgress?: (found: number, current: string) => void,
): Promise<ScanResult> {
  const cache =
    (await idbGet<Record<string, CachedMeta>>(META_STORE, 'scan').catch(() => undefined)) ?? {};
  const next: Record<string, CachedMeta> = {};

  const tracks: ScannedTrack[] = [];
  const files = new Map<string, FileSystemFileHandle>();
  let skipped = 0;

  async function walk(dir: FileSystemDirectoryHandle, prefix: string, depth: number) {
    if (depth > MAX_DEPTH || tracks.length >= MAX_FILES) return;

    const entries = (
      dir as unknown as {
        entries: () => AsyncIterable<[string, FileSystemHandle]>;
      }
    ).entries();

    for await (const [name, entry] of entries) {
      if (tracks.length >= MAX_FILES) return;
      // Hidden folders are where operating systems keep things nobody chose to
      // put there. Walking them is slow and never finds music.
      if (name.startsWith('.')) continue;

      const path = prefix ? `${prefix}/${name}` : name;

      if (entry.kind === 'directory') {
        await walk(entry as FileSystemDirectoryHandle, path, depth + 1);
        continue;
      }

      const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(extension)) continue;

      const fileHandle = entry as FileSystemFileHandle;
      let file: File;
      try {
        file = await fileHandle.getFile();
      } catch {
        // Vanished between listing and opening, or on a drive that just went
        // away. Not worth failing the whole scan over.
        skipped++;
        continue;
      }

      const key = metaKey(path, file.size, file.lastModified);
      let meta = cache[key];
      if (!meta) {
        const [trackId, frames] = await Promise.all([identify(file), probeFrames(file)]);
        meta = { trackId, frames };
      }
      next[key] = meta;

      files.set(meta.trackId, fileHandle);
      tracks.push({
        trackId: meta.trackId,
        title: titleOf(name),
        path,
        frames: meta.frames,
        sizeBytes: file.size,
      });
      onProgress?.(tracks.length, path);
    }
  }

  await walk(handle, '', 0);
  await idbPut(META_STORE, 'scan', next).catch(() => undefined);

  return { tracks, files, skipped };
}

/** Records an exact frame count learned from a decode, so a rescan keeps it. */
export async function rememberFrames(trackId: string, frames: number): Promise<void> {
  const cache =
    (await idbGet<Record<string, CachedMeta>>(META_STORE, 'scan').catch(() => undefined)) ?? {};
  let changed = false;
  for (const meta of Object.values(cache)) {
    if (meta.trackId === trackId && meta.frames !== frames) {
      meta.frames = frames;
      changed = true;
    }
  }
  if (changed) await idbPut(META_STORE, 'scan', cache).catch(() => undefined);
}
