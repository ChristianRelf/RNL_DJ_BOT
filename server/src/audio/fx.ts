import { Biquad, DelayLine, clamp, lowPass, smoothingCoefficient } from './dsp';
import { SAMPLE_RATE } from '../protocol';
import type { FxState, FxType } from '../protocol';

/**
 * The send effects bus.
 *
 * One effect at a time, like the unit bolted to the side of a hardware mixer:
 * the decks feed it post-fader through their send knobs, and the wet return is
 * summed back into the master. Every effect is fed from the same bus and reset
 * when the type changes, so switching never drags the tail of the last one
 * along with it.
 */

/** Longest echo the line has to hold, with a little headroom past the 2 s cap. */
const MAX_DELAY_SAMPLES = Math.ceil(2.2 * SAMPLE_RATE);
/** Delay time is smoothed rather than jumped, so a time sweep pitches like tape. */
const TIME_SMOOTHING = smoothingCoefficient(120);

const DEFAULTS: FxState = {
  type: 'echo',
  mix: 0,
  timeMs: 375,
  feedback: 0.35,
  tone: 0.6,
};

export class FxBus {
  type: FxType = DEFAULTS.type;
  mix = DEFAULTS.mix;
  timeMs = DEFAULTS.timeMs;
  feedback = DEFAULTS.feedback;
  tone = DEFAULTS.tone;

  /** Post-return peak, for the console's FX meter. */
  readonly meter: [number, number] = [0, 0];

  private readonly echo = [new DelayLine(MAX_DELAY_SAMPLES), new DelayLine(MAX_DELAY_SAMPLES)];
  private readonly damp = [new Biquad(), new Biquad()];
  private readonly reverb = [new Reverb(0), new Reverb(1)];
  private readonly flanger = [new DelayLine(2048), new DelayLine(2048)];
  private lfo = 0;
  private smoothedDelay = (DEFAULTS.timeMs / 1000) * SAMPLE_RATE;
  private dampFreq = -1;

  apply(patch: Partial<FxState>): void {
    if (patch.type !== undefined && patch.type !== this.type) {
      this.type = patch.type;
      // A tail from the old effect ringing out under the new one reads as a
      // fault rather than a flourish.
      this.reset();
    }
    if (patch.mix !== undefined) this.mix = clamp(patch.mix, 0, 1);
    if (patch.timeMs !== undefined) this.timeMs = clamp(patch.timeMs, 20, 2000);
    if (patch.feedback !== undefined) this.feedback = clamp(patch.feedback, 0, 0.95);
    if (patch.tone !== undefined) this.tone = clamp(patch.tone, 0, 1);
  }

  snapshot(): FxState {
    return {
      type: this.type,
      mix: this.mix,
      timeMs: this.timeMs,
      feedback: this.feedback,
      tone: this.tone,
    };
  }

  /** True while the bus can still be heard — silence lets the mixer skip it. */
  get active(): boolean {
    return this.mix > 0.0005;
  }

  /**
   * Runs one block of the send through the effect, writing the wet return into
   * the same buffers. Level is applied by the caller.
   */
  render(sendL: Float32Array, sendR: Float32Array, n: number): void {
    this.updateDamping();
    const targetDelay = (this.timeMs / 1000) * SAMPLE_RATE;

    if (this.type === 'reverb') {
      // Room size and decay are set per block: the comb lengths only change
      // when the knob moves, and moving them per sample would smear the tail.
      const size = clamp(this.timeMs / 2000, 0.05, 1);
      const decay = 0.7 + this.feedback * 0.28;
      for (let ch = 0; ch < 2; ch++) this.reverb[ch].configure(size, decay);
      for (let i = 0; i < n; i++) {
        sendL[i] = this.damp[0].process(this.reverb[0].process(sendL[i]));
        sendR[i] = this.damp[1].process(this.reverb[1].process(sendR[i]));
      }
      return;
    }

    if (this.type === 'flanger') {
      // The time knob becomes the sweep rate: 20 ms reads as a fast warble,
      // 2 s as a slow jet. Depth stays in the 1–5 ms band a flanger lives in.
      const hz = clamp(1000 / this.timeMs, 0.05, 8);
      const step = (2 * Math.PI * hz) / SAMPLE_RATE;
      const centre = 0.003 * SAMPLE_RATE;
      const depth = 0.002 * SAMPLE_RATE;
      for (let i = 0; i < n; i++) {
        this.lfo += step;
        if (this.lfo > Math.PI * 2) this.lfo -= Math.PI * 2;
        for (let ch = 0; ch < 2; ch++) {
          const buffer = ch === 0 ? sendL : sendR;
          const line = this.flanger[ch];
          // Quadrature between the channels is what makes it sound wide.
          const phase = ch === 0 ? Math.sin(this.lfo) : Math.cos(this.lfo);
          const wet = line.read(centre + depth * phase);
          line.push(buffer[i] + wet * this.feedback);
          buffer[i] = this.damp[ch].process(wet);
        }
      }
      return;
    }

    for (let i = 0; i < n; i++) {
      this.smoothedDelay += (targetDelay - this.smoothedDelay) * TIME_SMOOTHING;
      for (let ch = 0; ch < 2; ch++) {
        const buffer = ch === 0 ? sendL : sendR;
        const line = this.echo[ch];
        const wet = line.read(this.smoothedDelay);
        // Damping sits inside the loop, so each repeat is darker than the last.
        line.push(buffer[i] + this.damp[ch].process(wet) * this.feedback);
        buffer[i] = wet;
      }
    }
  }

  /** Tone maps onto the cutoff of the damping filter, 800 Hz to 16 kHz. */
  private updateDamping(): void {
    const freq = 800 * Math.pow(20, clamp(this.tone, 0, 1));
    if (Math.abs(freq - this.dampFreq) < 1) return;
    this.dampFreq = freq;
    const coefficients = lowPass(freq, 0.707);
    for (const filter of this.damp) filter.setCoefficients(coefficients);
  }

  reset(): void {
    for (const line of [...this.echo, ...this.flanger]) line.reset();
    for (const filter of this.damp) filter.reset();
    for (const room of this.reverb) room.reset();
    this.lfo = 0;
    this.meter[0] = 0;
    this.meter[1] = 0;
  }
}

/* ------------------------------------------------------------------ reverb */

/**
 * Schroeder reverb: four parallel combs into two allpasses. Cheap, and at the
 * short-to-medium sizes a DJ actually reaches for it holds up perfectly well.
 * The second channel's lengths are offset so the two sides decorrelate.
 */
const COMB_MS = [29.7, 37.1, 41.1, 43.7];
const ALLPASS_MS = [5.0, 1.7];

class Reverb {
  private readonly combs: DelayLine[];
  private readonly combStore: number[];
  private readonly allpasses: DelayLine[];
  private combDelays: number[] = [];
  private allpassDelays: number[] = [];
  private decay = 0.8;

  constructor(private readonly channel: number) {
    const spread = 1 + channel * 0.031;
    this.combs = COMB_MS.map((ms) => new DelayLine((ms * spread * 2 * SAMPLE_RATE) / 1000 + 4));
    this.allpasses = ALLPASS_MS.map((ms) => new DelayLine((ms * spread * 2 * SAMPLE_RATE) / 1000 + 4));
    this.combStore = COMB_MS.map(() => 0);
    this.configure(0.5, 0.8);
  }

  configure(size: number, decay: number): void {
    const spread = 1 + this.channel * 0.031;
    const scale = (0.35 + size * 1.65) * spread;
    this.combDelays = COMB_MS.map((ms) => (ms * scale * SAMPLE_RATE) / 1000);
    this.allpassDelays = ALLPASS_MS.map((ms) => (ms * spread * SAMPLE_RATE) / 1000);
    this.decay = decay;
  }

  process(x: number): number {
    let sum = 0;
    for (let i = 0; i < this.combs.length; i++) {
      const delayed = this.combs[i].read(this.combDelays[i]);
      // One-pole damping in the comb loop keeps the tail from turning metallic.
      this.combStore[i] = delayed * 0.75 + this.combStore[i] * 0.25;
      this.combs[i].push(x + this.combStore[i] * this.decay);
      sum += delayed;
    }
    let y = sum * 0.25;
    for (let i = 0; i < this.allpasses.length; i++) {
      const delayed = this.allpasses[i].read(this.allpassDelays[i]);
      const input = y + delayed * 0.5;
      this.allpasses[i].push(input);
      y = delayed - input * 0.5;
    }
    return y;
  }

  reset(): void {
    for (const line of [...this.combs, ...this.allpasses]) line.reset();
    this.combStore.fill(0);
  }
}
