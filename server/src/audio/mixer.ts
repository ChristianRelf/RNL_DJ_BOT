import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { Deck } from './deck';
import { Pad } from './pad';
import { FxBus } from './fx';
import { Isolator, Limiter, clamp, smoothingCoefficient, softClip } from './dsp';
import {
  BYTES_PER_FRAME,
  DECK_IDS,
  FRAME_MS,
  FRAME_SAMPLES,
  PAD_COUNT,
} from '../protocol';
import type { DeckEq, DeckId, FxState, Meters, MixerState } from '../protocol';

const FADER_SMOOTHING = smoothingCoefficient(15);
const DUCK_ATTACK = smoothingCoefficient(8);
const DUCK_RELEASE = smoothingCoefficient(220);
/** Peak meter fall-off per rendered frame (≈ -20 dB/s). */
const METER_DECAY = 0.86;
/** Frames the freewheel keeps turning after the last note, so a tail rings out. */
const FX_TAIL_FRAMES = 250;
/** Frames of render-cost history, ~10 seconds at 20 ms each. */
const FRAME_HISTORY = 500;
/** One least-significant bit of the 16-bit output, in the float domain. */
const LSB = 1 / 32767;

/**
 * How long frames are taking to render.
 *
 * The voice player pulls a frame every 20 ms and a late one is a dropout, so
 * the headroom in that budget is the number that decides what the mix graph can
 * afford. It is measured rather than reasoned about: everything expensive added
 * from here on is justified against this, and the p95 is what a degrade path
 * would watch.
 */
export class FrameTimer {
  private readonly samples = new Float64Array(FRAME_HISTORY);
  private readonly scratch = new Float64Array(FRAME_HISTORY);
  private count = 0;
  private next = 0;
  private highest = 0;

  add(ms: number): void {
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % FRAME_HISTORY;
    if (this.count < FRAME_HISTORY) this.count++;
    if (ms > this.highest) this.highest = ms;
  }

  /** [median, 95th percentile] in ms. Sorted on demand, not on every frame. */
  percentiles(): [number, number] {
    const n = this.count;
    if (n === 0) return [0, 0];
    const view = this.scratch.subarray(0, n);
    view.set(this.samples.subarray(0, n));
    view.sort();
    return [view[n >> 1], view[Math.min(n - 1, Math.floor(n * 0.95))]];
  }

  /** The worst frame since the last reset - the one that would have dropped. */
  get max(): number {
    return this.highest;
  }

  reset(): void {
    this.count = 0;
    this.next = 0;
    this.highest = 0;
  }
}

/**
 * A mixer patch. The nested sections arrive band by band rather than wholesale,
 * so two operators touching different knobs cannot overwrite each other.
 */
export type MixerPatch = Partial<Omit<MixerState, 'masterEq' | 'fx'>> & {
  masterEq?: Partial<DeckEq>;
  fx?: Partial<FxState>;
};

export interface MixerEvents {
  /** A deck ran off the end of its track - state needs rebroadcasting. */
  trackEnded: (deck: DeckId) => void;
}

/**
 * The realtime mix graph.
 *
 * Everything is float internally and converted to s16le once at the output, in
 * 20 ms blocks - exactly one Opus frame. Rendering is pull-driven by the voice
 * player when connected (which keeps the packet cadence honest) and by a local
 * timer when not, so transport positions stay truthful while previewing.
 */
export class Mixer extends EventEmitter {
  readonly decks: Record<DeckId, Deck>;
  readonly pads: Pad[];
  readonly fx = new FxBus();

  crossfader = 0;
  crossfaderCurve = 0;
  master = 1;
  balance = 0;
  mono = false;
  limiter = true;
  masterEq: DeckEq = { low: 0, mid: 0, high: 0 };
  padBus = 0.9;
  padDuck = 0.25;

  private readonly aL = new Float32Array(FRAME_SAMPLES);
  private readonly aR = new Float32Array(FRAME_SAMPLES);
  private readonly bL = new Float32Array(FRAME_SAMPLES);
  private readonly bR = new Float32Array(FRAME_SAMPLES);
  private readonly padL = new Float32Array(FRAME_SAMPLES);
  private readonly padR = new Float32Array(FRAME_SAMPLES);
  private readonly fxL = new Float32Array(FRAME_SAMPLES);
  private readonly fxR = new Float32Array(FRAME_SAMPLES);
  private readonly out = Buffer.alloc(BYTES_PER_FRAME);
  private readonly silence = Buffer.alloc(BYTES_PER_FRAME);

  private smoothedXfA = 1;
  private smoothedXfB = 0;
  private smoothedMaster = 1;
  private duckEnvelope = 0;

  private readonly masterIso = new Isolator();
  private readonly masterLimiter = new Limiter();
  private eqDirty = true;

  private meterValues: Meters = {
    master: [0, 0],
    A: [0, 0],
    B: [0, 0],
    pads: [0, 0],
    fx: [0, 0],
    clip: false,
    reduction: 1,
    frameMs: [0, 0],
  };
  private clipHold = 0;

  /**
   * Dither state.
   *
   * Rounding to 16 bits leaves an error that correlates with the signal, and
   * correlated error is not noise - on a long fade it is a granular, grainy
   * tail rather than a smooth one. A triangular dither decorrelates it, trading
   * that for a couple of dB of flat, unchanging hiss at -90 dBFS.
   *
   * Kept honest: this feeds an Opus encoder whose own noise floor is far above
   * that, so through Discord nobody will ever hear the difference. It costs
   * three operations a sample and it is right for anything that taps the mix
   * before the encoder, which is why it is here at all.
   *
   * Each channel's dither is the difference between successive uniforms, which
   * is triangular *and* high-passed - the noise it does add sits up where the
   * ear is least sensitive rather than spread flat.
   */
  private rng = 0x9e3779b9;
  private ditherL = 0;
  private ditherR = 0;

  private tail = 0;
  private fxTail = 0;
  private freewheel: NodeJS.Timeout | null = null;
  readonly frameTimer = new FrameTimer();
  private stream: MixerStream | null = null;
  private pullDriven = false;

  constructor() {
    super();
    this.decks = { A: new Deck('A'), B: new Deck('B') };
    this.pads = Array.from({ length: PAD_COUNT }, (_, i) => new Pad(i));
    this.startFreewheel();
  }

  /** A fresh raw-PCM stream for a new voice connection. */
  createStream(): Readable {
    this.stream?.destroy();
    this.stream = new MixerStream(this);
    this.pullDriven = true;
    this.stopFreewheel();
    return this.stream;
  }

  releaseStream(): void {
    this.stream?.destroy();
    this.stream = null;
    this.pullDriven = false;
    this.startFreewheel();
  }

  /**
   * Keeps decks advancing (and meters live) when nothing is pulling frames, so
   * the control surface still reflects reality before the bot joins a channel.
   */
  private startFreewheel(): void {
    if (this.freewheel) return;
    this.freewheel = setInterval(() => {
      if (this.pullDriven) return;
      if (!this.anythingActive()) {
        this.decayMeters();
        return;
      }
      this.renderFrame();
    }, FRAME_MS);
    this.freewheel.unref?.();
  }

  private stopFreewheel(): void {
    if (!this.freewheel) return;
    clearInterval(this.freewheel);
    this.freewheel = null;
  }

  private anythingActive(): boolean {
    for (const id of DECK_IDS) {
      if (this.decks[id].playing) {
        this.tail = FX_TAIL_FRAMES;
        return true;
      }
    }
    for (const pad of this.pads) {
      if (pad.playing) {
        this.tail = FX_TAIL_FRAMES;
        return true;
      }
    }
    // Nothing is playing, but an echo thrown into the last bar should still be
    // allowed to ring out rather than being cut off with the source.
    if (this.fx.active && this.tail > 0) {
      this.tail--;
      return true;
    }
    return false;
  }

  applyMixer(patch: MixerPatch): void {
    if (patch.crossfader !== undefined) this.crossfader = clamp(patch.crossfader, -1, 1);
    if (patch.crossfaderCurve !== undefined) {
      this.crossfaderCurve = clamp(patch.crossfaderCurve, 0, 1);
    }
    if (patch.master !== undefined) this.master = clamp(patch.master, 0, 1.5);
    if (patch.balance !== undefined) this.balance = clamp(patch.balance, -1, 1);
    if (patch.mono !== undefined) this.mono = patch.mono;
    if (patch.limiter !== undefined) this.limiter = patch.limiter;
    if (patch.padBus !== undefined) this.padBus = clamp(patch.padBus, 0, 1.5);
    if (patch.padDuck !== undefined) this.padDuck = clamp(patch.padDuck, 0, 1);
    if (patch.masterEq) {
      for (const band of ['low', 'mid', 'high'] as const) {
        const value = patch.masterEq[band];
        if (value !== undefined) this.masterEq[band] = clamp(value, -26, 6);
      }
      this.eqDirty = true;
    }
    if (patch.fx) this.fx.apply(patch.fx);
  }

  mixerSnapshot(): MixerState {
    return {
      crossfader: this.crossfader,
      crossfaderCurve: this.crossfaderCurve,
      master: this.master,
      balance: this.balance,
      mono: this.mono,
      limiter: this.limiter,
      masterEq: { ...this.masterEq },
      padBus: this.padBus,
      padDuck: this.padDuck,
      fx: this.fx.snapshot(),
    };
  }

  meters(): Meters {
    // Sampled here rather than per frame: this runs at the meter rate, ~15 Hz.
    this.meterValues.frameMs = this.frameTimer.percentiles();
    return this.meterValues;
  }

  /** Render exactly one 20 ms Opus frame of interleaved s16le stereo. */
  renderFrame(): Buffer {
    const started = process.hrtime.bigint();
    const n = FRAME_SAMPLES;

    const endedA = this.decks.A.render(this.aL, this.aR, n);
    const endedB = this.decks.B.render(this.bL, this.bR, n);

    this.padL.fill(0);
    this.padR.fill(0);
    let padsActive = false;
    for (const pad of this.pads) {
      if (pad.active) {
        pad.render(this.padL, this.padR, n);
        padsActive = true;
      }
    }

    const [targetA, targetB] = this.crossfadeGains();

    // The send is taken post-fader, so pulling a channel down takes its tail
    // with it - the way a send works on the hardware this is imitating.
    const sendA = this.decks.A.fxSend;
    const sendB = this.decks.B.fxSend;
    const feeding = sendA > 0.0005 || sendB > 0.0005;
    // Closing the sends must let the effect ring out, not freeze it mid-tail:
    // stop running the bus and the delay line simply stops advancing, so the
    // repeats hang there and reappear the moment a send is opened again.
    if (feeding) this.fxTail = FX_TAIL_FRAMES;
    else if (this.fxTail > 0) this.fxTail--;
    const fxActive = this.fx.active && (feeding || this.fxTail > 0);
    if (fxActive) {
      for (let i = 0; i < n; i++) {
        this.fxL[i] = this.aL[i] * sendA + this.bL[i] * sendB;
        this.fxR[i] = this.aR[i] * sendA + this.bR[i] * sendB;
      }
      this.fx.render(this.fxL, this.fxR, n);
    }

    if (this.eqDirty) {
      this.masterIso.setGains(this.masterEq);
      this.eqDirty = false;
    }
    const eqFlat = this.masterIso.flat;

    // Constant-power balance, so a nudge off centre does not change level.
    const balanceTheta = ((this.balance + 1) / 2) * (Math.PI / 2);
    const balL = Math.cos(balanceTheta) * Math.SQRT2;
    const balR = Math.sin(balanceTheta) * Math.SQRT2;
    const wet = this.fx.mix;

    // Dither belongs on signal, not on silence: an idle rig should put out true
    // zeros rather than a hiss, and the meter's own decay is what keeps the
    // dither running through a fade-out and its tail before standing down.
    const ditherScale =
      this.fx.active ||
      this.decks.A.playing ||
      this.decks.B.playing ||
      padsActive ||
      this.meterValues.master[0] > 0 ||
      this.meterValues.master[1] > 0
        ? LSB
        : 0;

    let peakML = 0;
    let peakMR = 0;
    let peakPL = 0;
    let peakPR = 0;
    let peakFL = 0;
    let peakFR = 0;
    let reduction = 1;
    let clipped = false;

    for (let i = 0; i < n; i++) {
      this.smoothedXfA += (targetA - this.smoothedXfA) * FADER_SMOOTHING;
      this.smoothedXfB += (targetB - this.smoothedXfB) * FADER_SMOOTHING;
      this.smoothedMaster += (this.master - this.smoothedMaster) * FADER_SMOOTHING;

      const pl = padsActive ? this.padL[i] * this.padBus : 0;
      const pr = padsActive ? this.padR[i] * this.padBus : 0;

      // Duck the decks under pad hits so voice drops sit on top of the music.
      const padLevel = Math.max(Math.abs(pl), Math.abs(pr));
      const coeff = padLevel > this.duckEnvelope ? DUCK_ATTACK : DUCK_RELEASE;
      this.duckEnvelope += (Math.min(1, padLevel * 2) - this.duckEnvelope) * coeff;
      const duck = 1 - this.padDuck * this.duckEnvelope;

      // The wet return is not crossfaded: an echo thrown from the outgoing deck
      // has to survive the fade, which is the whole point of throwing it.
      const wl = fxActive ? this.fxL[i] * wet : 0;
      const wr = fxActive ? this.fxR[i] * wet : 0;

      let l = (this.aL[i] * this.smoothedXfA + this.bL[i] * this.smoothedXfB) * duck + pl + wl;
      let r = (this.aR[i] * this.smoothedXfA + this.bR[i] * this.smoothedXfB) * duck + pr + wr;

      if (!eqFlat) {
        l = this.masterIso.process(0, l);
        r = this.masterIso.process(1, r);
      }

      if (this.mono) {
        const sum = (l + r) * 0.5;
        l = sum;
        r = sum;
      }

      l *= this.smoothedMaster * balL;
      r *= this.smoothedMaster * balR;

      if (l > 1 || l < -1 || r > 1 || r < -1) clipped = true;
      if (this.limiter) {
        const g = this.masterLimiter.step(l, r);
        if (g < reduction) reduction = g;
        l *= g;
        r *= g;
      }
      l = softClip(l);
      r = softClip(r);

      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > peakML) peakML = al;
      if (ar > peakMR) peakMR = ar;
      const apl = pl < 0 ? -pl : pl;
      const apr = pr < 0 ? -pr : pr;
      if (apl > peakPL) peakPL = apl;
      if (apr > peakPR) peakPR = apr;
      const afl = wl < 0 ? -wl : wl;
      const afr = wr < 0 ? -wr : wr;
      if (afl > peakFL) peakFL = afl;
      if (afr > peakFR) peakFR = afr;

      // xorshift32, inline. `Math.random()` here would be a call into C++
      // 1920 times a frame for something this cheap to do in three shifts.
      let x = this.rng;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.rng = x;
      const uL = (x >>> 8) / 0x1000000;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.rng = x;
      const uR = (x >>> 8) / 0x1000000;

      const dl = (uL - this.ditherL) * ditherScale;
      const dr = (uR - this.ditherR) * ditherScale;
      this.ditherL = uL;
      this.ditherR = uR;

      const offset = i * 4;
      this.out.writeInt16LE(
        Math.max(-32768, Math.min(32767, Math.round((l + dl) * 32767))),
        offset,
      );
      this.out.writeInt16LE(
        Math.max(-32768, Math.min(32767, Math.round((r + dr) * 32767))),
        offset + 2,
      );
    }

    this.updateMeters({
      master: [peakML, peakMR],
      pads: [peakPL, peakPR],
      fx: [peakFL, peakFR],
      clipped,
      reduction: this.limiter ? reduction : 1,
    });

    if (endedA) this.emit('trackEnded', 'A');
    if (endedB) this.emit('trackEnded', 'B');

    this.frameTimer.add(Number(process.hrtime.bigint() - started) / 1e6);
    return this.out;
  }

  /**
   * Crossfader law. At curve 0 this is the constant-power blend a long mix
   * wants; winding it up bends the travel towards a cut, so by 1 the channel is
   * at full level within a few millimetres - what a scratch fader does.
   */
  private crossfadeGains(): [number, number] {
    const x = clamp(this.crossfader, -1, 1);
    const sharpness = 1 + this.crossfaderCurve * 14;
    const shaped = clamp(x * sharpness, -1, 1);
    const theta = ((shaped + 1) / 2) * (Math.PI / 2);
    return [Math.cos(theta), Math.sin(theta)];
  }

  private updateMeters(frame: {
    master: [number, number];
    pads: [number, number];
    fx: [number, number];
    clipped: boolean;
    reduction: number;
  }): void {
    const m = this.meterValues;
    const hold = (prev: number, next: number) => (next > prev ? next : prev * METER_DECAY);
    m.master = [hold(m.master[0], frame.master[0]), hold(m.master[1], frame.master[1])];
    m.pads = [hold(m.pads[0], frame.pads[0]), hold(m.pads[1], frame.pads[1])];
    m.fx = [hold(m.fx[0], frame.fx[0]), hold(m.fx[1], frame.fx[1])];
    m.A = [hold(m.A[0], this.decks.A.meter[0]), hold(m.A[1], this.decks.A.meter[1])];
    m.B = [hold(m.B[0], this.decks.B.meter[0]), hold(m.B[1], this.decks.B.meter[1])];
    // Reduction recovers slowly so a brief grab still registers on the console.
    m.reduction = frame.reduction < m.reduction ? frame.reduction : m.reduction + (1 - m.reduction) * 0.14;
    if (frame.clipped) this.clipHold = 40;
    else if (this.clipHold > 0) this.clipHold--;
    m.clip = this.clipHold > 0;
  }

  private decayMeters(): void {
    const m = this.meterValues;
    const d = (v: [number, number]): [number, number] => [v[0] * METER_DECAY, v[1] * METER_DECAY];
    m.master = d(m.master);
    m.A = d(m.A);
    m.B = d(m.B);
    m.pads = d(m.pads);
    m.fx = d(m.fx);
    m.reduction = m.reduction + (1 - m.reduction) * 0.14;
    if (this.clipHold > 0) this.clipHold--;
    m.clip = this.clipHold > 0;
  }

  silentFrame(): Buffer {
    return this.silence;
  }

  destroy(): void {
    this.stopFreewheel();
    this.releaseStream();
  }
}

/**
 * Raw PCM source for @discordjs/voice. `_read` renders on demand, so the voice
 * player's own 20 ms cadence clocks the mix and the buffer never runs away
 * (the high water mark caps look-ahead at two frames).
 */
class MixerStream extends Readable {
  constructor(private readonly mixer: Mixer) {
    super({ highWaterMark: BYTES_PER_FRAME * 2 });
  }

  override _read(): void {
    // Copy: renderFrame reuses one buffer, but the stream keeps references.
    this.push(Buffer.from(this.mixer.renderFrame()));
  }
}
