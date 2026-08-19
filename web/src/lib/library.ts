import {
  rememberFrames,
  scanFolder,
  type ScannedTrack,
} from './folder';
import type { WorkerReply, WorkerRequest } from './libraryWorker';
import { PEAK_BUCKETS, type AudioNeedMessage } from '../protocol';

const CHANNELS = 2;
const SAMPLE_RATE = 48000;

/**
 * The longest file this will decode.
 *
 * `decodeAudioData` is all-or-nothing: it hands back the whole track as float
 * samples, which for a stereo hour is about 1.4 GB of memory in one go. Twelve
 * minutes is roughly 230 MB, which a browser will part with. Lifting this means
 * decoding incrementally through WebCodecs, which is a real piece of work and
 * deliberately not in this pass - so the limit is stated plainly rather than
 * discovered as a tab crash.
 */
export const MAX_DECODE_MINUTES = 12;
const MAX_DECODE_FRAMES = MAX_DECODE_MINUTES * 60 * SAMPLE_RATE;

/** Written to the cache a slice at a time, so peak memory stays the AudioBuffer. */
const WRITE_CHUNK_FRAMES = SAMPLE_RATE * 30;

/**
 * `Omit` over a union collapses it to the properties they share, which for a
 * message union is just the discriminant. Distributing it keeps each variant.
 */
type Request = WorkerRequest extends infer T ? (T extends WorkerRequest ? Omit<T, 'id'> : never) : never;

export interface LibraryEvents {
  onTracks?: (tracks: ScannedTrack[]) => void;
  onScanProgress?: (found: number, current: string) => void;
  onDecodeStart?: (trackId: string) => void;
  onDecodeDone?: (trackId: string, frames: number) => void;
  /** The waveform envelope, once there is one. Sent on to the server. */
  onPeaks?: (trackId: string, peaks: number[], frames: number) => void;
  onError?: (message: string) => void;
}

/**
 * Everything the browser side of a rig's audio needs to do.
 *
 * Holds the folder, answers the server's requests for audio out of a decoded
 * cache, and decodes a track the first time something asks for it. Decoding is
 * deliberately lazy: a scan of five hundred tracks reads names and durations,
 * and the expensive part happens per track, when it is actually loaded.
 */
export class Library {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (reply: WorkerReply) => void>();

  private files = new Map<string, FileSystemFileHandle>();
  private tracks = new Map<string, ScannedTrack>();
  /** Decodes in flight, so ten requests for one track cause one decode. */
  private decoding = new Map<string, Promise<number>>();
  private failed = new Map<string, string>();

  constructor(
    private readonly scope: string,
    private readonly events: LibraryEvents = {},
  ) {
    this.worker = new Worker(new URL('./libraryWorker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const resolve = this.pending.get(event.data.id);
      if (!resolve) return;
      this.pending.delete(event.data.id);
      resolve(event.data);
    });
    void this.ask({ kind: 'init', scope: this.scope });
  }

  private ask(message: Request, transfer: Transferable[] = []): Promise<WorkerReply> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...message, id } as WorkerRequest, transfer);
    });
  }

  get trackList(): ScannedTrack[] {
    return [...this.tracks.values()];
  }

  /* ----------------------------------------------------------------- scan */

  async scan(handle: FileSystemDirectoryHandle): Promise<ScannedTrack[]> {
    const result = await scanFolder(handle, (found, current) =>
      this.events.onScanProgress?.(found, current),
    );

    this.files = result.files;
    this.tracks = new Map(result.tracks.map((t) => [t.trackId, t]));
    // A track that failed to decode before might simply have been mid-copy.
    this.failed.clear();

    this.events.onTracks?.(result.tracks);
    return result.tracks;
  }

  /* ---------------------------------------------------------------- serve */

  /**
   * Answers one request for audio, or null when there is nothing to send yet.
   *
   * Null is a perfectly ordinary answer: the server's ring treats an
   * unanswered request as an underrun, fades, and asks again. That is what
   * covers the seconds a first decode takes, without needing a protocol for it.
   */
  async serve(need: AudioNeedMessage): Promise<{ frames: number; pcm: ArrayBuffer } | null> {
    const ready = await this.ensure(need.trackId);
    if (!ready) return null;

    const reply = await this.ask({
      kind: 'read',
      trackId: need.trackId,
      fromFrame: need.fromFrame,
      frames: need.frames,
    });
    if (!reply.ok || !reply.pcm || !reply.frames) return null;
    return { frames: reply.frames, pcm: reply.pcm };
  }

  /** True once a track's audio is in the cache and readable. */
  private async ensure(trackId: string): Promise<boolean> {
    if (this.failed.has(trackId)) return false;

    const have = await this.ask({ kind: 'have', trackId });
    if (have.ok) return true;

    const existing = this.decoding.get(trackId);
    if (existing) {
      await existing.catch(() => 0);
      return !this.failed.has(trackId);
    }

    const job = this.decode(trackId);
    this.decoding.set(trackId, job);
    try {
      await job;
      return true;
    } catch (err) {
      this.failed.set(trackId, (err as Error).message);
      this.events.onError?.(`Could not decode that track: ${(err as Error).message}`);
      return false;
    } finally {
      this.decoding.delete(trackId);
    }
  }

  /* --------------------------------------------------------------- decode */

  /**
   * Decodes one track into the cache.
   *
   * The decode happens on the main thread because there is no `AudioContext` in
   * a worker and `decodeAudioData` is the only decoder a browser exposes that
   * handles every format people actually have. It is written out a slice at a
   * time so the only large thing alive is the `AudioBuffer` itself.
   */
  private async decode(trackId: string): Promise<number> {
    const handle = this.files.get(trackId);
    if (!handle) throw new Error('that track is not in the folder any more');

    const track = this.tracks.get(trackId);
    if (track && track.frames > MAX_DECODE_FRAMES) {
      throw new Error(`it is longer than ${MAX_DECODE_MINUTES} minutes`);
    }

    this.events.onDecodeStart?.(trackId);

    const file = await handle.getFile();
    const bytes = await file.arrayBuffer();

    // Created at the output rate, so anything at 44.1k is resampled on the way
    // in and everything downstream - the ring, the mixer, Opus - sees one rate.
    const context = new OfflineAudioContext(CHANNELS, 1, SAMPLE_RATE);
    const audio = await context.decodeAudioData(bytes);

    if (audio.length > MAX_DECODE_FRAMES) {
      throw new Error(`it is longer than ${MAX_DECODE_MINUTES} minutes`);
    }

    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;

    // The waveform envelope is built in the same pass as the conversion. It is
    // the only pass over the samples there will be, and walking a decoded track
    // twice to draw a picture of it would be the expensive kind of tidy.
    const peaks = new Float32Array(PEAK_BUCKETS);
    const perBucket = audio.length / PEAK_BUCKETS;

    await this.ask({ kind: 'begin', trackId });
    try {
      for (let start = 0; start < audio.length; start += WRITE_CHUNK_FRAMES) {
        const frames = Math.min(WRITE_CHUNK_FRAMES, audio.length - start);
        const buffer = new ArrayBuffer(frames * CHANNELS * 2);
        const view = new Int16Array(buffer);
        for (let i = 0; i < frames; i++) {
          // Clamped before scaling: decoded float can sit above 1.0 on material
          // that was mastered into the ceiling, and wrapping that would be a
          // full-scale click rather than the clip it actually is.
          const l = Math.max(-1, Math.min(1, left[start + i]));
          const r = Math.max(-1, Math.min(1, right[start + i]));
          view[i * 2] = l < 0 ? l * 32768 : l * 32767;
          view[i * 2 + 1] = r < 0 ? r * 32768 : r * 32767;

          const bucket = Math.min(PEAK_BUCKETS - 1, ((start + i) / perBucket) | 0);
          const magnitude = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
          if (magnitude > peaks[bucket]) peaks[bucket] = magnitude;
        }
        await this.ask({ kind: 'append', trackId, pcm: buffer }, [buffer]);
      }
    } catch (err) {
      await this.ask({ kind: 'abort', trackId });
      throw err;
    }

    const committed = await this.ask({ kind: 'commit', trackId });
    const frames = committed.ok && committed.frames ? committed.frames : audio.length;

    // The scan's duration was read off the file's metadata and is approximate.
    // This one came from the decoder, so it replaces it - everywhere, including
    // on the server, whose ring sizes its requests against it.
    if (track && track.frames !== frames) {
      track.frames = frames;
      void rememberFrames(trackId, frames);
      this.events.onTracks?.(this.trackList);
    }

    this.events.onPeaks?.(trackId, Array.from(peaks, (v) => Math.round(v * 1000) / 1000), frames);
    this.events.onDecodeDone?.(trackId, frames);
    return frames;
  }

  /* ---------------------------------------------------------------- misc */

  async usage(): Promise<{ bytes: number; tracks: number }> {
    const reply = await this.ask({ kind: 'usage' });
    return reply.ok ? { bytes: reply.bytes ?? 0, tracks: reply.tracks ?? 0 } : { bytes: 0, tracks: 0 };
  }

  /** A file the folder no longer has. The server is told separately. */
  async forget(trackId: string): Promise<void> {
    this.files.delete(trackId);
    this.tracks.delete(trackId);
    await this.ask({ kind: 'forget', trackId });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
