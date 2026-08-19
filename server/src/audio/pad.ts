import { PcmSource } from './source';
import type { WindowReader } from './windowReader';
import { clamp, smoothingCoefficient } from './dsp';
import { FRAME_SAMPLES, SAMPLE_RATE } from '../protocol';
import type { PadMode, PadState } from '../protocol';

const PAD_SMOOTHING = smoothingCoefficient(5);

/**
 * A sample-pad voice. Deliberately simpler than a deck: no pitch, no EQ, just
 * instant retriggering for stings, drops and shout-outs over the mix.
 */
export class Pad {
  readonly index: number;
  mediaId: string | null = null;
  title: string | null = null;
  gain = 0.9;
  mode: PadMode = 'oneshot';
  playing = false;

  private source: PcmSource | null = null;
  private position = 0;
  private envelope = 0;
  // Read into here first: the pad sums into a shared bus, and the source
  // overwrites what it writes to.
  private readonly blockL = new Float32Array(FRAME_SAMPLES);
  private readonly blockR = new Float32Array(FRAME_SAMPLES);

  constructor(index: number) {
    this.index = index;
  }

  get durationMs(): number {
    return this.source?.durationMs ?? 0;
  }

  get positionMs(): number {
    return (this.position / SAMPLE_RATE) * 1000;
  }

  /** True while the pad still contributes audio, including its release tail. */
  get active(): boolean {
    return this.source !== null && (this.playing || this.envelope > 0.0005);
  }

  assign(mediaId: string, title: string, reader: WindowReader): void {
    const next = new PcmSource(reader, this.index + 5);
    this.source?.close();
    this.source = next;
    this.mediaId = mediaId;
    this.title = title;
    this.playing = false;
    this.position = 0;
  }

  clear(): void {
    this.playing = false;
    this.source?.close();
    this.source = null;
    this.mediaId = null;
    this.title = null;
    this.position = 0;
    this.envelope = 0;
  }

  trigger(): void {
    if (!this.source) return;
    // Retrigger from the top — the 5 ms envelope ramp hides the discontinuity.
    this.position = 0;
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  set(patch: { gain?: number; mode?: PadMode }): void {
    if (patch.gain !== undefined) this.gain = clamp(patch.gain, 0, 1.5);
    if (patch.mode !== undefined) this.mode = patch.mode;
  }

  /**
   * Sums this pad into the shared pad bus.
   *
   * Split into runs at the end of the sample, exactly as a deck is, so the
   * source can be read a run at a time. A pad never changes rate, so every one
   * of those reads takes the source's straight-copy path.
   */
  render(outL: Float32Array, outR: Float32Array, n: number): void {
    const src = this.source;
    if (!src) {
      this.envelope = 0;
      return;
    }

    let i = 0;
    while (i < n) {
      // Stopped, but still fading out: the head holds where it is and the last
      // frame is held under the release, which is what rate zero reads.
      const run = this.playing
        ? Math.min(n - i, Math.max(1, Math.ceil(src.frames - 1 - this.position)))
        : n - i;
      const end = i + run;

      this.position = src.readBlock(
        this.position,
        this.playing ? 1 : 0,
        this.playing ? 1 : 0,
        this.blockL,
        this.blockR,
        i,
        run,
      );

      for (; i < end; i++) {
        this.envelope += ((this.playing ? 1 : 0) - this.envelope) * PAD_SMOOTHING;
        const g = this.gain * this.envelope;
        outL[i] += this.blockL[i] * g;
        outR[i] += this.blockR[i] * g;
      }

      if (this.playing && this.position >= src.frames - 1) {
        this.position = 0;
        if (this.mode !== 'loop') this.playing = false;
      }
    }
  }

  snapshot(): PadState {
    return {
      index: this.index,
      mediaId: this.mediaId,
      title: this.title,
      playing: this.playing,
      positionMs: Math.round(this.positionMs),
      durationMs: Math.round(this.durationMs),
      gain: this.gain,
      mode: this.mode,
    };
  }
}
