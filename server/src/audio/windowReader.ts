import fs from 'node:fs';
import os from 'node:os';
import { CHANNELS } from '../protocol';

export const BYTES_PER_SAMPLE_FRAME = CHANNELS * 2;

/**
 * Whether `fs.readSync` into an `Int16Array`'s backing store already lands in
 * host order. On a little-endian host — every machine this runs on — reading
 * s16le straight into the typed array is free, which is what keeps the
 * de-interleave loop reading aligned 16-bit words instead of assembling them a
 * byte at a time. Big-endian hosts pay one native `swap16` per read.
 */
const LITTLE_ENDIAN = os.endianness() === 'LE';

/**
 * Where a `PcmSource` gets its bytes.
 *
 * The source owns the window, the interpolation and the anti-alias ring; this
 * owns nothing but "give me these frames". Splitting them is what lets the same
 * audio path be fed from a local decoded file, from a ring buffer filled over a
 * socket by the operator's device, or from anything later that can answer the
 * same question.
 *
 * Implementations must never block the audio path. A reader that does not have
 * the bytes yet returns short, and the source fades rather than stalling.
 */
export interface WindowReader {
  /** Total frames available in the whole source. */
  readonly totalFrames: number;

  /**
   * Fills `into` with up to `frames` frames of interleaved host-order Int16
   * starting at file frame `fromFrame`, and returns how many frames were
   * actually written.
   *
   * `fromFrame` and `frames` are already clamped inside the source by the
   * caller, so a short return means the bytes are not here *yet* — an underrun,
   * not the end of the file.
   */
  read(fromFrame: number, frames: number, into: Int16Array): number;

  /**
   * Playback is heading towards this span. May start a fetch; must not block
   * and must not be required for correctness — `read` is still the only thing
   * that actually delivers bytes.
   */
  prefetch(fromFrame: number, frames: number): void;

  dispose(): void;
}

/**
 * Reads a decoded s16le/48k/stereo file off local disk.
 *
 * Synchronous by design: a refill is ~1.5 MB out of the page cache, and going
 * async here would mean the audio path waiting on a microtask it cannot wait
 * for. This never returns short except at the true end of the file.
 */
export class FileWindowReader implements WindowReader {
  readonly totalFrames: number;

  private readonly fd: number;
  private closed = false;

  constructor(private readonly filePath: string) {
    const stat = fs.statSync(filePath);
    const usable = stat.size - (stat.size % BYTES_PER_SAMPLE_FRAME);
    this.totalFrames = Math.floor(usable / BYTES_PER_SAMPLE_FRAME);
    this.fd = fs.openSync(filePath, 'r');
  }

  get path(): string {
    return this.filePath;
  }

  read(fromFrame: number, frames: number, into: Int16Array): number {
    if (this.closed || frames <= 0) return 0;

    const wantedBytes = frames * BYTES_PER_SAMPLE_FRAME;
    // A view over the caller's buffer rather than a copy: `readSync` writes
    // s16le straight into the typed array's backing store.
    const view = Buffer.from(into.buffer, into.byteOffset, wantedBytes);

    let bytes = 0;
    try {
      bytes = fs.readSync(this.fd, view, 0, wantedBytes, fromFrame * BYTES_PER_SAMPLE_FRAME);
    } catch {
      // A file pulled out from under a loaded deck. Reported as an underrun so
      // the source fades instead of throwing on the audio path.
      return 0;
    }

    if (!LITTLE_ENDIAN && bytes > 0) view.subarray(0, bytes).swap16();
    return Math.floor(bytes / BYTES_PER_SAMPLE_FRAME);
  }

  /** The page cache is the prefetch. Nothing useful to do ahead of time. */
  prefetch(): void {}

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      fs.closeSync(this.fd);
    } catch {
      /* already gone */
    }
  }
}
