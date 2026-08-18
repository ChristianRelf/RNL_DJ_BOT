import { PcmSource } from './source';
import { Biquad, Isolator, clamp, dbToGain, filterCoefficients, smoothingCoefficient } from './dsp';
import { SAMPLE_RATE } from '../protocol';
import type { DeckEq, DeckId, DeckState } from '../protocol';

const GAIN_SMOOTHING = smoothingCoefficient(12);
/** Short fade applied on start/stop so transport moves never click. */
const TRANSPORT_FADE = smoothingCoefficient(6);
/** Pan follows slowly enough that a swept knob never zippers. */
const PAN_SMOOTHING = smoothingCoefficient(20);
/**
 * The head follows the pitch fader over about 25 ms rather than jumping to it.
 * A rate set instantly is a step in read-head velocity, and a fader drag is a
 * stream of them — which is what a stepped, zippered pitch actually is.
 */
const RATE_SMOOTHING = smoothingCoefficient(25);
/**
 * How fast an outstanding phase debt is worked off, as a fraction of rate.
 * 0.2% is far below anything anyone can hear, which is the point: a correction
 * should move the head without being audible as a pitch move.
 */
const PHASE_BIAS = 0.002;
/** A nudge is meant to be felt, so it is worked off at something like platter speed. */
const BEND_BIAS = 0.25;

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
  /** What the head is moving at. `rate` is where it is heading. */
  private currentRate = 1;
  /**
   * Frames the head owes, positive when it is behind where it ought to be.
   *
   * Two things feed this. Smoothing the rate means a fader move advances the
   * head slightly less than an instant jump would have, and that shortfall is
   * booked here and paid back — so smoothing costs nothing in position, which
   * is what stops it fighting anything that cares where the head actually is.
   * And a deliberate shove — a nudge now, a phase correction later — is the
   * same thing at a larger size: ask for frames, get them worked off smoothly
   * instead of jumped.
   */
  private phaseDebt = 0;
  /**
   * How hard the debt may be repaid. Raised by a nudge, back down when settled.
   *
   * The default is deliberately slow, so note what that means for a big move:
   * hauling the fader from double speed back to unity books about 1200 frames
   * and takes some seconds to work off. That is the right trade — the head ends
   * up exactly where it should be and nobody can hear 0.2% — but it is why a
   * caller that wants its frames sooner has to say so.
   */
  private bendLimit = PHASE_BIAS;
  private smoothedGain = 0;
  private envelope = 0;
  private smoothedPanL = 1;
  private smoothedPanR = 1;

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
    const next = PcmSource.fromFile(req.pcmPath, this.id === 'A' ? 0 : 3);
    this.source?.close();
    this.source = next;
    this.mediaId = req.mediaId;
    this.title = req.title;
    this.bpm = req.bpm;
    this.position = 0;
    this.cueMs = 0;
    this.playing = false;
    this.envelope = 0;
    this.currentRate = this.rate;
    this.clearDebt();
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
    this.clearDebt();
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
    // Whole frames: a fractional head serves no purpose and it is what lets a
    // deck at zero pitch take the source's straight-copy path.
    this.position = Math.round((target / 1000) * SAMPLE_RATE);
    this.clearDebt();
    if (this.source && this.position > this.source.frames - 1) {
      this.position = Math.max(0, this.source.frames - 1);
    }
  }

  /**
   * A nudge on a moving deck is a bend, not a jump: the head runs fast or slow
   * for a moment and settles back where the nudge asked for, which is what a
   * hand on a platter does. Jumping the head mid-flight clicks. Stopped, there
   * is nothing to bend, so it stays a seek.
   */
  nudgeMs(deltaMs: number): void {
    if (this.playing) this.bend((deltaMs / 1000) * SAMPLE_RATE, BEND_BIAS);
    else this.seekMs(this.positionMs + deltaMs);
  }

  /**
   * Asks for the head to be `frames` further on than it is heading, worked off
   * at no more than `limit` extra rate. This is the one way anything moves the
   * head without cutting the audio.
   */
  bend(frames: number, limit = PHASE_BIAS): void {
    this.phaseDebt += frames;
    this.bendLimit = Math.max(this.bendLimit, limit);
  }

  private clearDebt(): void {
    this.phaseDebt = 0;
    this.bendLimit = PHASE_BIAS;
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
   * True while the read head is moving. Position keeps advancing through the
   * transport fade after a pause, so the last few milliseconds are not replayed
   * when the deck starts again.
   */
  private get advancing(): boolean {
    return this.playing || this.envelope > 0.0005;
  }

  /**
   * How many frames can be rendered before the position hits something that
   * needs handling — the end of a loop, or the end of the track.
   *
   * The read head only ever moves forward, so the distance to a boundary
   * divided by the rate is the number of frames until it fires. `fastest` is
   * the quickest the head could possibly go over this run — the ramp is heading
   * there and any repayment is on top — because an estimate that undershoots
   * the real rate would sail past a loop point before anything noticed. If the
   * envelope closes mid-run the head advances less than predicted, which only
   * ever makes the estimate conservative, which is the safe direction.
   */
  private runLength(
    remaining: number,
    src: PcmSource,
    looping: boolean,
    loopEnd: number,
    fastest: number,
  ): number {
    if (!this.advancing) return remaining;
    let run = remaining;
    // Paused, but the transport fade is still running and the head still
    // moving. It stops the frame the envelope closes, and the source is read a
    // run at a time, so that has to be a boundary rather than a per-frame test.
    if (!this.playing) {
      const closes = Math.ceil(Math.log(0.0005 / this.envelope) / Math.log(1 - TRANSPORT_FADE));
      run = Math.min(run, Math.max(1, closes - 1));
    }
    // At least one frame, always: a head already sitting past a boundary — a
    // seek beyond the loop end, say — has to render a frame and then wrap,
    // exactly as the per-sample form did, or this would not terminate.
    if (looping) {
      run = Math.min(run, Math.max(1, Math.ceil((loopEnd - this.position) / fastest)));
    }
    return Math.min(run, Math.max(1, Math.ceil((src.frames - 1 - this.position) / fastest)));
  }

  /**
   * Render `n` sample frames into the supplied buffers (overwrite, not sum).
   * Returns true when the deck reached the end of the track this block.
   *
   * The block is rendered as a series of *runs*, each ending where the read
   * head meets a boundary. In the ordinary case — no loop wrap, no end of
   * track — that is one run covering the whole block, and the inner loop is
   * what it always was. Splitting it this way is what lets the source be read
   * a run at a time rather than a sample at a time, and it is where quantised
   * actions land later: a scheduled cue point is simply another boundary.
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

    const target = this.rate;
    let i = 0;
    while (i < n) {
      const remaining = n - i;
      const advancing = this.advancing;

      // Work off whatever the head owes, at whatever rate this debt is allowed
      // to be repaid at. Spread over the frames left in the block so a debt
      // small enough to clear inside one block does exactly that.
      const bias = this.phaseDebt === 0
        ? 0
        : clamp(this.phaseDebt / remaining, -this.bendLimit, this.bendLimit);
      const fastest = Math.max(this.currentRate, target) + Math.max(bias, 0);
      const run = src ? this.runLength(remaining, src, looping, loopEnd, fastest) : remaining;
      const end = i + run;

      // The source fills the output buffers for the whole run in one call and
      // the rest of the chain works over them in place. A head that is not
      // advancing reads at rate zero, which holds the frame it stopped on for
      // as long as the fade takes — the same sample the per-frame form repeated.
      if (!src) {
        outL.fill(0, i, end);
        outR.fill(0, i, end);
      } else if (!advancing) {
        src.readBlock(this.position, 0, 0, outL, outR, i, run);
      } else {
        const from = this.position;
        const rateStart = this.currentRate + bias;
        // Closed form for the run, so a block split into several runs smooths
        // by exactly as much as one run of the same total length would.
        this.currentRate = target + (this.currentRate - target) * (1 - RATE_SMOOTHING) ** run;
        this.position = src.readBlock(this.position, rateStart, this.currentRate + bias, outL, outR, i, run);

        // Book the difference between where the head went and where an instant,
        // unsmoothed rate would have taken it. Repaid above on later runs, so
        // none of this smoothing ever costs the deck its position.
        this.phaseDebt += run * target - (this.position - from);
        if (Math.abs(this.phaseDebt) < 1e-4) this.clearDebt();
      }

      for (; i < end; i++) {
        this.envelope += ((this.playing ? 1 : 0) - this.envelope) * TRANSPORT_FADE;
        this.smoothedGain += (targetGain - this.smoothedGain) * GAIN_SMOOTHING;

        let l = this.isolator.process(0, outL[i]);
        let r = this.isolator.process(1, outR[i]);

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

      // Whichever boundary ended the run, handled once instead of tested on
      // every frame. When the run simply filled the block none of these hold.
      if (src && this.advancing) {
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

    // Pull the window forward for the next block rather than waiting for a read
    // to miss, so the refill never lands in the same frame as the audio that
    // wanted it. Costs nothing while there is still read-ahead in hand.
    if (src) src.prefetch(this.position, true);

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
      // Only while running: a paused deck whose source is dry is waiting, not
      // dropping out, and flagging it would light the console up every time
      // somebody loaded a track and left it sitting.
      starved: this.playing && (this.source?.starving ?? false),
    };
  }

  /** dB-scaled gain helper used by the slash commands. */
  static gainFromDb(db: number): number {
    return dbToGain(db);
  }
}
