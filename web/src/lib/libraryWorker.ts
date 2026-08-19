/**
 * The decoded-audio cache, and the thing that reads out of it.
 *
 * Runs in a dedicated worker for two reasons. The reads are synchronous - OPFS
 * sync access handles are the only random-access file API a browser has, and
 * they are worker-only - so doing them anywhere else would block the tab on
 * every request. And a backgrounded tab has its main thread throttled hard,
 * while a worker servicing messages does not, which is the difference between a
 * set surviving somebody switching windows and not.
 *
 * Nothing here ever touches the user's music folder. It caches what the main
 * thread has already decoded, and the originals stay where they are.
 */

/// <reference lib="webworker" />

const CHANNELS = 2;
const BYTES_PER_FRAME = CHANNELS * 2;

/**
 * Ceiling on the decoded cache. About 85 minutes of audio - far more than the
 * ten sources a rig can have loaded at once, so eviction only ever touches
 * tracks nobody is playing.
 */
const CACHE_LIMIT_BYTES = 1024 * 1024 * 1024;

interface Entry {
  trackId: string;
  frames: number;
  bytes: number;
  lastUsed: number;
}

type Manifest = Record<string, Entry>;

let scope = 'default';
let manifest: Manifest = {};
let pcmDir: FileSystemDirectoryHandle | null = null;
/** Open sync handles, by track. A file may only have one at a time. */
const handles = new Map<string, FileSystemSyncAccessHandle>();
/** Tracks being written right now - never evicted out from under a decode. */
const writing = new Set<string>();

async function root(): Promise<FileSystemDirectoryHandle> {
  if (pcmDir) return pcmDir;
  const opfs = await navigator.storage.getDirectory();
  const deck = await opfs.getDirectoryHandle('deck', { create: true });
  const guild = await deck.getDirectoryHandle(scope, { create: true });
  pcmDir = await guild.getDirectoryHandle('pcm', { create: true });
  return pcmDir;
}

async function loadManifest(): Promise<void> {
  try {
    const dir = await root();
    const handle = await dir.getFileHandle('index.json');
    const text = await (await handle.getFile()).text();
    manifest = JSON.parse(text) as Manifest;
  } catch {
    // No manifest yet, or an unreadable one. Starting empty costs a re-decode
    // and nothing else, which is the right trade against refusing to start.
    manifest = {};
  }
}

let saveQueued = false;
function saveManifest(): void {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    void (async () => {
      try {
        const dir = await root();
        const handle = await dir.getFileHandle('index.json', { create: true });
        const access = await handle.createSyncAccessHandle();
        const bytes = new TextEncoder().encode(JSON.stringify(manifest));
        access.truncate(0);
        access.write(bytes, { at: 0 });
        access.flush();
        access.close();
      } catch {
        /* the cache is a cache; a manifest that failed to write costs a re-decode */
      }
    })();
  }, 500);
}

async function handleFor(trackId: string): Promise<FileSystemSyncAccessHandle> {
  const open = handles.get(trackId);
  if (open) return open;
  const dir = await root();
  const file = await dir.getFileHandle(`${trackId}.pcm`, { create: true });
  const access = await file.createSyncAccessHandle();
  handles.set(trackId, access);
  return access;
}

function closeHandle(trackId: string): void {
  const open = handles.get(trackId);
  if (!open) return;
  try {
    open.close();
  } catch {
    /* already closed */
  }
  handles.delete(trackId);
}

/** Drops least-recently-used tracks until the cache is back under its ceiling. */
async function evict(keep: Set<string>): Promise<void> {
  let total = 0;
  for (const entry of Object.values(manifest)) total += entry.bytes;
  if (total <= CACHE_LIMIT_BYTES) return;

  const candidates = Object.values(manifest)
    .filter((e) => !keep.has(e.trackId) && !writing.has(e.trackId))
    .sort((a, b) => a.lastUsed - b.lastUsed);

  const dir = await root();
  for (const entry of candidates) {
    if (total <= CACHE_LIMIT_BYTES) break;
    closeHandle(entry.trackId);
    try {
      await dir.removeEntry(`${entry.trackId}.pcm`);
    } catch {
      /* already gone */
    }
    delete manifest[entry.trackId];
    total -= entry.bytes;
  }
  saveManifest();
}

/* ------------------------------------------------------------- messages */

export type WorkerRequest =
  | { id: number; kind: 'init'; scope: string }
  | { id: number; kind: 'have'; trackId: string }
  | { id: number; kind: 'begin'; trackId: string }
  | { id: number; kind: 'append'; trackId: string; pcm: ArrayBuffer }
  | { id: number; kind: 'commit'; trackId: string }
  | { id: number; kind: 'abort'; trackId: string }
  | { id: number; kind: 'read'; trackId: string; fromFrame: number; frames: number }
  | { id: number; kind: 'forget'; trackId: string }
  | { id: number; kind: 'usage' };

export type WorkerReply =
  | { id: number; ok: true; frames?: number; pcm?: ArrayBuffer; bytes?: number; tracks?: number }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function handle(msg: WorkerRequest): Promise<{ reply: WorkerReply; transfer: Transferable[] }> {
  const { id } = msg;

  switch (msg.kind) {
    case 'init': {
      scope = msg.scope;
      pcmDir = null;
      await loadManifest();
      return { reply: { id, ok: true, tracks: Object.keys(manifest).length }, transfer: [] };
    }

    case 'have': {
      const entry = manifest[msg.trackId];
      if (!entry) return { reply: { id, ok: false, error: 'not cached' }, transfer: [] };
      entry.lastUsed = Date.now();
      saveManifest();
      return { reply: { id, ok: true, frames: entry.frames }, transfer: [] };
    }

    case 'begin': {
      writing.add(msg.trackId);
      const access = await handleFor(msg.trackId);
      access.truncate(0);
      delete manifest[msg.trackId];
      return { reply: { id, ok: true }, transfer: [] };
    }

    case 'append': {
      const access = await handleFor(msg.trackId);
      access.write(new Uint8Array(msg.pcm), { at: access.getSize() });
      return { reply: { id, ok: true }, transfer: [] };
    }

    case 'commit': {
      const access = await handleFor(msg.trackId);
      access.flush();
      const bytes = access.getSize();
      const frames = Math.floor(bytes / BYTES_PER_FRAME);
      manifest[msg.trackId] = { trackId: msg.trackId, frames, bytes, lastUsed: Date.now() };
      writing.delete(msg.trackId);
      saveManifest();
      // Whatever was just written is obviously in use, so it is exempt from the
      // sweep it may itself have triggered.
      await evict(new Set([msg.trackId]));
      return { reply: { id, ok: true, frames }, transfer: [] };
    }

    case 'abort': {
      writing.delete(msg.trackId);
      closeHandle(msg.trackId);
      delete manifest[msg.trackId];
      try {
        (await root()).removeEntry(`${msg.trackId}.pcm`);
      } catch {
        /* nothing written yet */
      }
      return { reply: { id, ok: true }, transfer: [] };
    }

    case 'read': {
      const entry = manifest[msg.trackId];
      if (!entry) return { reply: { id, ok: false, error: 'not cached' }, transfer: [] };

      const from = Math.max(0, Math.min(msg.fromFrame, entry.frames));
      const frames = Math.max(0, Math.min(msg.frames, entry.frames - from));
      if (frames === 0) {
        return { reply: { id, ok: true, frames: 0, pcm: new ArrayBuffer(0) }, transfer: [] };
      }

      const access = await handleFor(msg.trackId);
      const buffer = new ArrayBuffer(frames * BYTES_PER_FRAME);
      const view = new Uint8Array(buffer);
      const read = access.read(view, { at: from * BYTES_PER_FRAME });

      entry.lastUsed = Date.now();
      const got = Math.floor(read / BYTES_PER_FRAME);
      // Handed over rather than copied - this is the hot path, several times a
      // second per playing deck.
      return { reply: { id, ok: true, frames: got, pcm: buffer }, transfer: [buffer] };
    }

    case 'forget': {
      closeHandle(msg.trackId);
      delete manifest[msg.trackId];
      try {
        (await root()).removeEntry(`${msg.trackId}.pcm`);
      } catch {
        /* already gone */
      }
      saveManifest();
      return { reply: { id, ok: true }, transfer: [] };
    }

    case 'usage': {
      let bytes = 0;
      for (const entry of Object.values(manifest)) bytes += entry.bytes;
      return {
        reply: { id, ok: true, bytes, tracks: Object.keys(manifest).length },
        transfer: [],
      };
    }
  }
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void (async () => {
    try {
      const { reply, transfer } = await handle(event.data);
      ctx.postMessage(reply, transfer);
    } catch (err) {
      ctx.postMessage({
        id: event.data.id,
        ok: false,
        error: (err as Error).message,
      } satisfies WorkerReply);
    }
  })();
});
