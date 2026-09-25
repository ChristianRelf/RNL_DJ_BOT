/// <reference lib="webworker" />

export type CloudDownloadRequest =
  | { id: number; kind: 'hash'; file: File }
  | { id: number; kind: 'download'; scope: string; fileName: string; url: string;
      expectedBytes: number; expectedEtag: string | null; resumeAt: number }
  | { id: number; kind: 'cancel' };

export type CloudDownloadReply =
  | { id: number; kind: 'hash'; ok: true; sha256: string }
  | { id: number; kind: 'progress'; downloadedBytes: number; resumedBytes: number }
  | { id: number; kind: 'done'; ok: true; downloadedBytes: number; resumedBytes: number }
  | { id: number; kind: 'error'; ok: false; error: string; downloadedBytes: number };

const active = new Map<number, AbortController>();
const ctx = self as unknown as DedicatedWorkerGlobalScope;

function safeScope(scope: string): string {
  return scope.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'default';
}

async function sourceDirectory(scope: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const deck = await root.getDirectoryHandle('deck', { create: true });
  const cloud = await deck.getDirectoryHandle('cloud', { create: true });
  const rig = await cloud.getDirectoryHandle(safeScope(scope), { create: true });
  return rig.getDirectoryHandle('source', { create: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function existingSize(scope: string, fileName: string): Promise<number> {
  try {
    return (await (await (await sourceDirectory(scope)).getFileHandle(fileName)).getFile()).size;
  } catch {
    return 0;
  }
}

async function hash(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function download(message: Extract<CloudDownloadRequest, { kind: 'download' }>): Promise<void> {
  const controller = new AbortController();
  active.set(message.id, controller);
  let resumeAt = Math.min(message.resumeAt, message.expectedBytes);
  let downloaded = resumeAt;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const headers = new Headers();
        if (resumeAt > 0) {
          headers.set('range', `bytes=${resumeAt}-`);
          if (message.expectedEtag) headers.set('if-range', `"${message.expectedEtag}"`);
        }
        const response = await fetch(message.url, { headers, signal: controller.signal, cache: 'no-store' });
        if (response.status === 416 && resumeAt > 0) {
          resumeAt = 0;
          downloaded = 0;
          continue;
        }
        if (!response.ok && response.status !== 206) throw new Error(`Download failed (${response.status}).`);
        const responseEtag = response.headers.get('etag')?.replace(/^"|"$/g, '') ?? null;
        if (message.expectedEtag && responseEtag && responseEtag !== message.expectedEtag) {
          throw new Error('The cloud object changed while it was being downloaded.');
        }

        // Some origins ignore Range. Restart rather than appending a full body
        // to a partial file and incorrectly declaring it ready.
        if (resumeAt > 0 && response.status !== 206) resumeAt = 0;
        const directory = await sourceDirectory(message.scope);
        const handle = await directory.getFileHandle(message.fileName, { create: true });
        const writable = await handle.createWritable({ keepExistingData: resumeAt > 0 });
        if (resumeAt > 0) await writable.seek(resumeAt);
        else await writable.truncate(0);

        const reader = response.body?.getReader();
        if (!reader) throw new Error('This browser cannot stream the download.');
        downloaded = resumeAt;
        let lastReport = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
            downloaded += value.byteLength;
            if (downloaded - lastReport >= 1024 * 1024) {
              lastReport = downloaded;
              ctx.postMessage({ id: message.id, kind: 'progress', downloadedBytes: downloaded,
                resumedBytes: resumeAt } satisfies CloudDownloadReply);
            }
          }
          await writable.close();
        } catch (err) {
          // Commit the bytes received so far. The manifest remains non-ready,
          // and the next attempt resumes from this exact length.
          await writable.close().catch(async () => {
            await writable.abort().catch(() => undefined);
          });
          throw err;
        }

        const actual = await existingSize(message.scope, message.fileName);
        if (actual !== message.expectedBytes) {
          throw new Error(`Download ended at ${actual} of ${message.expectedBytes} bytes.`);
        }
        ctx.postMessage({ id: message.id, kind: 'done', ok: true, downloadedBytes: actual,
          resumedBytes: resumeAt } satisfies CloudDownloadReply);
        return;
      } catch (err) {
        if (controller.signal.aborted) throw new Error('Download cancelled.');
        downloaded = await existingSize(message.scope, message.fileName);
        resumeAt = downloaded < message.expectedBytes ? downloaded : 0;
        if (attempt === 3) throw err;
        await sleep(500 * (2 ** attempt));
      }
    }
  } catch (err) {
    ctx.postMessage({ id: message.id, kind: 'error', ok: false,
      error: (err as Error).message, downloadedBytes: downloaded } satisfies CloudDownloadReply);
  } finally {
    active.delete(message.id);
  }
}

ctx.addEventListener('message', (event: MessageEvent<CloudDownloadRequest>) => {
  const message = event.data;
  if (message.kind === 'cancel') {
    active.get(message.id)?.abort();
    return;
  }
  if (message.kind === 'hash') {
    void hash(message.file)
      .then((sha256) => ctx.postMessage({ id: message.id, kind: 'hash', ok: true, sha256 } satisfies CloudDownloadReply))
      .catch((err) => ctx.postMessage({ id: message.id, kind: 'error', ok: false,
        error: (err as Error).message, downloadedBytes: 0 } satisfies CloudDownloadReply));
    return;
  }
  void download(message);
});
