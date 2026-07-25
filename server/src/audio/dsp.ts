import { SAMPLE_RATE } from '../protocol';

/**
 * Direct-form-I biquad. One instance per channel — the coefficients are shared
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
