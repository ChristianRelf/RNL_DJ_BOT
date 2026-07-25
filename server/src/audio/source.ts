import fs from 'node:fs';
import { CHANNELS, SAMPLE_RATE } from '../protocol';

const BYTES_PER_SAMPLE_FRAME = CHANNELS * 2;
/** Files at or under this size are held in RAM (≈2.5 minutes of stereo audio). */
const PRELOAD_MAX_BYTES = 28 * 1024 * 1024;
/** Sliding window for larger files: 2 seconds of audio. */
const WINDOW_FRAMES = SAMPLE_RATE * 2;
const WINDOW_BYTES = WINDOW_FRAMES * BYTES_PER_SAMPLE_FRAME;

/**
 * Random-access reader over a decoded s16le/48k/stereo file.
 *
 * Small files are preloaded; larger ones stream through a sliding window that
 * is refilled with a positional synchronous read. A refill is ~192 KB out of
 * the page cache roughly once every 2 seconds of playback per deck, which is
 * far below the 20 ms budget of a mix tick and avoids the latency jitter an
 * async prefetch would introduce.
 */
export class PcmSource {
  readonly frames: number;
  private readonly fd: number | null;
  private readonly memory: Buffer | null;
  private window: Buffer | null = null;
  private windowStartFrame = 0;
  private windowFrames = 0;
  private closed = false;

  constructor(private readonly filePath: string) {
    const stat = fs.statSync(filePath);
    const usable = stat.size - (stat.size % BYTES_PER_SAMPLE_FRAME);
    this.frames = Math.floor(usable / BYTES_PER_SAMPLE_FRAME);

    if (stat.size <= PRELOAD_MAX_BYTES) {
      this.memory = fs.readFileSync(filePath);
      this.fd = null;
    } else {
      this.memory = null;
      this.fd = fs.openSync(filePath, 'r');
      this.window = Buffer.allocUnsafe(WINDOW_BYTES);
    }
  }

  get durationMs(): number {
    return (this.frames / SAMPLE_RATE) * 1000;
  }

  /**
   * Linearly interpolated stereo sample at a fractional frame position.
   * Writes into `out` to avoid allocating on the audio path.
   */
  sample(position: number, out: Float32Array): void {
    const i0 = Math.floor(position);
    if (i0 < 0 || i0 >= this.frames || this.closed) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    const frac = position - i0;
    const i1 = i0 + 1 < this.frames ? i0 + 1 : i0;

    const buf = this.bufferFor(i0, i1);
    if (!buf) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    const base = this.offsetIn(i0);
    const next = this.offsetIn(i1);

    const l0 = buf.readInt16LE(base) / 32768;
    const r0 = buf.readInt16LE(base + 2) / 32768;
    const l1 = buf.readInt16LE(next) / 32768;
    const r1 = buf.readInt16LE(next + 2) / 32768;

    out[0] = l0 + (l1 - l0) * frac;
    out[1] = r0 + (r1 - r0) * frac;
  }

  private offsetIn(frame: number): number {
    if (this.memory) return frame * BYTES_PER_SAMPLE_FRAME;
    return (frame - this.windowStartFrame) * BYTES_PER_SAMPLE_FRAME;
  }

  private bufferFor(first: number, last: number): Buffer | null {
    if (this.memory) return this.memory;
    if (
      this.window &&
      first >= this.windowStartFrame &&
      last < this.windowStartFrame + this.windowFrames
    ) {
      return this.window;
    }
    return this.refill(first);
  }

  /** Refill the window so that `frame` sits a little inside its left edge. */
  private refill(frame: number): Buffer | null {
    if (!this.window || this.fd === null) return null;
    // Leave a small margin behind the playhead so scrubbing backwards by a few
    // samples (nudge, loop wrap) does not force another read immediately.
    const start = Math.max(0, frame - SAMPLE_RATE / 10);
    const read = fs.readSync(this.fd, this.window, 0, WINDOW_BYTES, start * BYTES_PER_SAMPLE_FRAME);
    this.windowStartFrame = start;
    this.windowFrames = Math.floor(read / BYTES_PER_SAMPLE_FRAME);
    if (this.windowFrames === 0) return null;
    if (frame < start || frame >= start + this.windowFrames) return null;
    return this.window;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        /* already gone */
      }
    }
    this.window = null;
  }

  get path(): string {
    return this.filePath;
  }
}
