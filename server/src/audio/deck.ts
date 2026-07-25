import { PcmSource } from './source';
import { Biquad, Isolator, clamp, dbToGain, filterCoefficients, smoothingCoefficient } from './dsp';
import { SAMPLE_RATE } from '../protocol';
import type { DeckEq, DeckId, DeckState } from '../protocol';

const GAIN_SMOOTHING = smoothingCoefficient(12);
/** Short fade applied on start/stop so transport moves never click. */
const TRANSPORT_FADE = smoothingCoefficient(6);
/** Pan follows slowly enough that a swept knob never zippers. */
const PAN_SMOOTHING = smoothingCoefficient(20);

export interface DeckLoadRequest {
  mediaId: string;
  title: string;
  pcmPath: string;
  bpm: number | null;
}

/**
 * One playback channel: source, transport, pitch, 3-band EQ, filter, looping
 * and channel fader. The mixer owns crossfading and the master bus.
 */
export class Deck {
  readonly id: DeckId;

  mediaId: string | null = null;
  title: string | null = null;
  playing = false;
  gain = 0.85;
  trim = 1;
  rate = 1;
  eq: DeckEq = { low: 0, mid: 0, high: 0 };
  filter = 0;
  pan = 0;
  fxSend = 0;
  muted = false;
  cueMs = 0;
  repeat = false;
  bpm: number | null = null;
  loop = { active: false, startMs: 0, endMs: 0 };

  /** Post-fader peak, decayed by the mixer for metering. */
  meter: [number, number] = [0, 0];

  private source: PcmSource | null = null;
  private position = 0;
  private smoothedGain = 0;
  private envelope = 0;
  private smoothedPanL = 1;
  private smoothedPanR = 1;
  private readonly scratch = new Float32Array(2);

  private readonly isolator = new Isolator();
  private readonly filters = [new Biquad(), new Biquad()];
  private coefficientsDirty = true;

  constructor(id: DeckId) {
    this.id = id;
  }

  get durationMs(): number {
    return this.source ? this.source.durationMs : 0;
  }

  get positionMs(): number {
    return (this.position / SAMPLE_RATE) * 1000;
  }

  get loaded(): boolean {
    return this.source !== null;
  }

  load(req: DeckLoadRequest): void {
    const next = new PcmSource(req.pcmPath);
    this.source?.close();
    this.source = next;
    this.mediaId = req.mediaId;
    this.title = req.title;
    this.bpm = req.bpm;
    this.position = 0;
    this.cueMs = 0;
    this.playing = false;
    this.envelope = 0;
    this.loop = { active: false, startMs: 0, endMs: Math.min(8000, next.durationMs) };
    this.resetFilters();
  }

  eject(): void {
    this.playing = false;
    this.envelope = 0;
    this.source?.close();
    this.source = null;
    this.mediaId = null;
    this.title = null;
    this.bpm = null;
    this.position = 0;
    this.cueMs = 0;
    this.loop = { active: false, startMs: 0, endMs: 0 };
    this.resetFilters();
  }

  play(): void {
    if (!this.source) return;
    if (this.position >= this.source.frames - 1) this.position = 0;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /** DJ cue: jump back to the cue point and stop. */
  cue(): void {
    this.seekMs(this.cueMs);
    this.playing = false;
  }

  setCue(ms: number): void {
    this.cueMs = clamp(ms, 0, this.durationMs);
  }

  seekMs(ms: number): void {
    const target = clamp(ms, 0, this.durationMs);
    this.position = (target / 1000) * SAMPLE_RATE;
    if (this.source && this.position > this.source.frames - 1) {
      this.position = Math.max(0, this.source.frames - 1);
    }
  }

  nudgeMs(deltaMs: number): void {
    this.seekMs(this.positionMs + deltaMs);
  }

  setLoop(active: boolean, startMs?: number, endMs?: number): void {
    if (startMs !== undefined) this.loop.startMs = clamp(startMs, 0, this.durationMs);
    if (endMs !== undefined) this.loop.endMs = clamp(endMs, 0, this.durationMs);
    if (this.loop.endMs <= this.loop.startMs) {
      this.loop.endMs = Math.min(this.durationMs, this.loop.startMs + 500);
    }
    this.loop.active = active && this.loop.endMs > this.loop.startMs;
  }

  setEq(patch: Partial<DeckEq>): void {
    if (patch.low !== undefined) this.eq.low = clamp(patch.low, -26, 6);
    if (patch.mid !== undefined) this.eq.mid = clamp(patch.mid, -26, 6);
    if (patch.high !== undefined) this.eq.high = clamp(patch.high, -26, 6);
    this.coefficientsDirty = true;
  }

  setFilter(value: number): void {
    this.filter = clamp(value, -1, 1);
    this.coefficientsDirty = true;
  }

  private resetFilters(): void {
    this.isolator.reset();
    for (const b of this.filters) b.reset();
    this.coefficientsDirty = true;
  }

  private updateCoefficients(): void {
    if (!this.coefficientsDirty) return;
    this.coefficientsDirty = false;
    this.isolator.setGains(this.eq);
    const filterC = filterCoefficients(this.filter);
    for (let ch = 0; ch < 2; ch++) this.filters[ch].setCoefficients(filterC);
  }

  /**
   * Render `n` sample frames into the supplied buffers (overwrite, not sum).
   * Returns true when the deck reached the end of the track this block.
   */
  render(outL: Float32Array, outR: Float32Array, n: number): boolean {
    this.updateCoefficients();
    const src = this.source;
    let reachedEnd = false;

    const targetGain = this.muted ? 0 : this.trim * this.gain;
    const loopStart = (this.loop.startMs / 1000) * SAMPLE_RATE;
    const loopEnd = (this.loop.endMs / 1000) * SAMPLE_RATE;
    const looping = this.loop.active && loopEnd > loopStart;
    // Constant power, so a swept pan holds its level across the image.
    const theta = ((clamp(this.pan, -1, 1) + 1) / 2) * (Math.PI / 2);
    const targetPanL = Math.cos(theta) * Math.SQRT2;
    const targetPanR = Math.sin(theta) * Math.SQRT2;
    let peakL = 0;
    let peakR = 0;

    for (let i = 0; i < n; i++) {
      this.envelope += ((this.playing ? 1 : 0) - this.envelope) * TRANSPORT_FADE;
      this.smoothedGain += (targetGain - this.smoothedGain) * GAIN_SMOOTHING;

      let l = 0;
      let r = 0;
      if (src) {
        src.sample(this.position, this.scratch);
        l = this.scratch[0];
        r = this.scratch[1];

        if (this.playing || this.envelope > 0.0005) {
          this.position += this.rate;
          if (looping && this.position >= loopEnd) {
            this.position = loopStart + (this.position - loopEnd);
          } else if (this.position >= src.frames - 1) {
            if (this.repeat) {
              this.position = looping ? loopStart : 0;
            } else {
              this.position = Math.max(0, src.frames - 1);
              if (this.playing) {
                this.playing = false;
                reachedEnd = true;
              }
            }
          }
        }
      }

      l = this.isolator.process(0, l);
      r = this.isolator.process(1, r);

      l = this.filters[0].process(l);
      r = this.filters[1].process(r);

      this.smoothedPanL += (targetPanL - this.smoothedPanL) * PAN_SMOOTHING;
      this.smoothedPanR += (targetPanR - this.smoothedPanR) * PAN_SMOOTHING;

      const g = this.smoothedGain * this.envelope;
      l *= g * this.smoothedPanL;
      r *= g * this.smoothedPanR;

      outL[i] = l;
      outR[i] = r;
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > peakL) peakL = al;
      if (ar > peakR) peakR = ar;
    }

    this.meter[0] = peakL;
    this.meter[1] = peakR;
    return reachedEnd;
  }

  applySettings(patch: {
    gain?: number;
    trim?: number;
    rate?: number;
    filter?: number;
    pan?: number;
    fxSend?: number;
    muted?: boolean;
    repeat?: boolean;
    eq?: Partial<DeckEq>;
  }): void {
    if (patch.gain !== undefined) this.gain = clamp(patch.gain, 0, 1.25);
    if (patch.trim !== undefined) this.trim = clamp(patch.trim, 0, 2);
    if (patch.rate !== undefined) this.rate = clamp(patch.rate, 0.5, 2);
    if (patch.pan !== undefined) this.pan = clamp(patch.pan, -1, 1);
    if (patch.fxSend !== undefined) this.fxSend = clamp(patch.fxSend, 0, 1);
    if (patch.muted !== undefined) this.muted = patch.muted;
    if (patch.repeat !== undefined) this.repeat = patch.repeat;
    if (patch.filter !== undefined) this.setFilter(patch.filter);
    if (patch.eq) this.setEq(patch.eq);
  }

  snapshot(): DeckState {
    return {
      id: this.id,
      mediaId: this.mediaId,
      title: this.title,
      playing: this.playing,
      positionMs: Math.round(this.positionMs),
      durationMs: Math.round(this.durationMs),
      gain: this.gain,
      trim: this.trim,
      rate: this.rate,
      eq: { ...this.eq },
      filter: this.filter,
      pan: this.pan,
      fxSend: this.fxSend,
      muted: this.muted,
      cueMs: Math.round(this.cueMs),
      loop: { ...this.loop },
      repeat: this.repeat,
      bpm: this.bpm,
    };
  }

  /** dB-scaled gain helper used by the slash commands. */
  static gainFromDb(db: number): number {
    return dbToGain(db);
  }
}
