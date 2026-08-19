import { SAMPLE_RATE } from '../protocol';
import type { DeckEq } from '../protocol';

/**
 * Direct-form-I biquad. One instance per channel - the coefficients are shared
 * but the delay line must not be.
 */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private bypass = true;

  setCoefficients(c: BiquadCoefficients | null): void {
    if (!c) {
      this.bypass = true;
      return;
    }
    this.bypass = false;
    this.b0 = c.b0;
    this.b1 = c.b1;
    this.b2 = c.b2;
    this.a1 = c.a1;
    this.a2 = c.a2;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  /**
   * Starts the filter as if it had been fed `x` since the beginning of time,
   * rather than silence. A filter picked up mid-signal - after a seek, or when
   * one is switched into a running path - otherwise has to climb out of zero,
   * and that climb is a click. Only meaningful for filters with unity gain at
   * DC, which is every one this file makes.
   */
  prime(x: number): void {
    this.x1 = this.x2 = this.y1 = this.y2 = x;
  }

  process(x: number): number {
    if (this.bypass) return x;
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    // Flush denormals; they cost far more than the comparison.
    this.y1 = Math.abs(y) < 1e-15 ? 0 : y;
    return y;
  }
}

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function normalise(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): BiquadCoefficients {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function lowPass(freq: number, q = 0.8): BiquadCoefficients {
  const w0 = (2 * Math.PI * Math.min(freq, SAMPLE_RATE / 2.2)) / SAMPLE_RATE;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  return normalise((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

export function highPass(freq: number, q = 0.8): BiquadCoefficients {
  const w0 = (2 * Math.PI * Math.min(freq, SAMPLE_RATE / 2.2)) / SAMPLE_RATE;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  return normalise((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

/**
 * Single knob DJ filter: -1 sweeps a low-pass down to 40 Hz, +1 sweeps a
 * high-pass up to 12 kHz, and a dead band around centre bypasses entirely.
 */
export function filterCoefficients(knob: number): BiquadCoefficients | null {
  const k = Math.max(-1, Math.min(1, knob));
  if (Math.abs(k) < 0.02) return null;
  if (k < 0) {
    const t = (Math.abs(k) - 0.02) / 0.98;
    return lowPass(20000 * Math.pow(40 / 20000, t));
  }
  const t = (k - 0.02) / 0.98;
  return highPass(20 * Math.pow(12000 / 20, t));
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** One-pole smoothing coefficient for a given time constant. */
export function smoothingCoefficient(ms: number): number {
  return 1 - Math.exp(-1 / ((ms / 1000) * SAMPLE_RATE));
}

/**
 * Cubic soft clipper used as the master safety limiter. Continuous in value and
 * slope at the ±1.5 knee, so hard overs fold down instead of buzzing.
 */
export function softClip(x: number): number {
  if (x >= 1.5) return 1;
  if (x <= -1.5) return -1;
  return x - (x * x * x) / 6.75;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/* ------------------------------------------------------------- isolator */

/** Isolator crossover points. */
const BAND_LOW_HZ = 250;
const BAND_HIGH_HZ = 2500;
/** At or below this a band is muted outright, like a hardware kill switch. */
export const KILL_DB = -25.5;

/**
 * Stereo 3-band isolator.
 *
 * The signal is split into low and high with complementary filters and the mid
 * is whatever is left over, so the three bands sum back to the original at
 * unity and a full cut is a real kill rather than a dip. Used by every deck and
 * by the master bus.
 */
export class Isolator {
  private readonly lowSplit = [new Biquad(), new Biquad()];
  private readonly highSplit = [new Biquad(), new Biquad()];
  private gains = { low: 1, mid: 1, high: 1 };

  constructor() {
    const low = lowPass(BAND_LOW_HZ, 0.707);
    const high = highPass(BAND_HIGH_HZ, 0.707);
    for (let ch = 0; ch < 2; ch++) {
      this.lowSplit[ch].setCoefficients(low);
      this.highSplit[ch].setCoefficients(high);
    }
  }

  setGains(eq: DeckEq): void {
    this.gains = {
      low: bandGain(eq.low),
      mid: bandGain(eq.mid),
      high: bandGain(eq.high),
    };
  }

  /** True when every band sits at unity, so the caller can skip the filters. */
  get flat(): boolean {
    return this.gains.low === 1 && this.gains.mid === 1 && this.gains.high === 1;
  }

  process(ch: 0 | 1, x: number): number {
    const low = this.lowSplit[ch].process(x);
    const high = this.highSplit[ch].process(x);
    return low * this.gains.low + (x - low - high) * this.gains.mid + high * this.gains.high;
  }

  reset(): void {
    for (const b of [...this.lowSplit, ...this.highSplit]) b.reset();
  }
}

function bandGain(db: number): number {
  return db <= KILL_DB ? 0 : dbToGain(db);
}

/* ------------------------------------------------------------- limiter */

/** Where the limiter holds the peak. Just under full scale, to leave codec headroom. */
const CEILING = 0.97;

/**
 * Feed-forward peak limiter on the master bus.
 *
 * No lookahead - the broadcast path is already latency-sensitive and a 20 ms
 * frame is not the place to add more - so the attack is fast enough to catch a
 * transient within a couple of samples and the soft clipper stays behind it as
 * the backstop for whatever slips through.
 */
export class Limiter {
  /** Current gain applied, 1 = wide open. */
  gain = 1;
  private readonly attack = smoothingCoefficient(0.5);
  private readonly release = smoothingCoefficient(180);

  /** Returns the gain to apply to this sample pair. */
  step(l: number, r: number): number {
    const peak = Math.max(Math.abs(l), Math.abs(r));
    const target = peak > CEILING ? CEILING / peak : 1;
    const coeff = target < this.gain ? this.attack : this.release;
    this.gain += (target - this.gain) * coeff;
    return this.gain;
  }

  reset(): void {
    this.gain = 1;
  }
}

/* ----------------------------------------------------------- delay line */

/**
 * Fixed-capacity circular delay with fractional reads, the building block for
 * every send effect. Reading before writing keeps a feedback loop honest at
 * delay times shorter than one block.
 */
export class DelayLine {
  private readonly buffer: Float32Array;
  private write = 0;

  constructor(readonly capacity: number) {
    this.buffer = new Float32Array(Math.max(2, Math.ceil(capacity)));
  }

  push(x: number): void {
    this.buffer[this.write] = x;
    this.write = (this.write + 1) % this.buffer.length;
  }

  /** Linearly interpolated read `delay` samples back from the write head. */
  read(delay: number): number {
    const n = this.buffer.length;
    const d = clamp(delay, 1, n - 2);
    const back = this.write - d;
    const index = back >= 0 ? back : back + n;
    const i0 = Math.floor(index);
    const frac = index - i0;
    const a = this.buffer[i0 % n];
    const b = this.buffer[(i0 + 1) % n];
    return a + (b - a) * frac;
  }

  reset(): void {
    this.buffer.fill(0);
    this.write = 0;
  }
}
