import { PcmSource } from './source';
import { clamp, smoothingCoefficient } from './dsp';
import { SAMPLE_RATE } from '../protocol';
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
  private readonly scratch = new Float32Array(2);

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

  assign(mediaId: string, title: string, pcmPath: string): void {
    const next = new PcmSource(pcmPath);
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

  /** Sums this pad into the shared pad bus. */
  render(outL: Float32Array, outR: Float32Array, n: number): void {
    const src = this.source;
    if (!src) {
      this.envelope = 0;
      return;
    }
    for (let i = 0; i < n; i++) {
      this.envelope += ((this.playing ? 1 : 0) - this.envelope) * PAD_SMOOTHING;
      src.sample(this.position, this.scratch);
      const g = this.gain * this.envelope;
      outL[i] += this.scratch[0] * g;
      outR[i] += this.scratch[1] * g;

      if (this.playing) {
        this.position += 1;
        if (this.position >= src.frames - 1) {
          if (this.mode === 'loop') {
            this.position = 0;
          } else {
            this.position = 0;
            this.playing = false;
          }
        }
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
