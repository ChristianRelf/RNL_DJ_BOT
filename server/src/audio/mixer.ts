import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { Deck } from './deck';
import { Pad } from './pad';
import { clamp, smoothingCoefficient, softClip } from './dsp';
import {
  BYTES_PER_FRAME,
  DECK_IDS,
  FRAME_MS,
  FRAME_SAMPLES,
  PAD_COUNT,
} from '../protocol';
import type { DeckId, Meters, MixerState } from '../protocol';

const FADER_SMOOTHING = smoothingCoefficient(15);
const DUCK_ATTACK = smoothingCoefficient(8);
const DUCK_RELEASE = smoothingCoefficient(220);
/** Peak meter fall-off per rendered frame (≈ -20 dB/s). */
const METER_DECAY = 0.86;

export interface MixerEvents {
  /** A deck ran off the end of its track — state needs rebroadcasting. */
  trackEnded: (deck: DeckId) => void;
}

/**
 * The realtime mix graph.
 *
 * Everything is float internally and converted to s16le once at the output, in
 * 20 ms blocks — exactly one Opus frame. Rendering is pull-driven by the voice
 * player when connected (which keeps the packet cadence honest) and by a local
 * timer when not, so transport positions stay truthful while previewing.
 */
export class Mixer extends EventEmitter {
  readonly decks: Record<DeckId, Deck>;
  readonly pads: Pad[];

  crossfader = 0;
  master = 1;
  padBus = 0.9;
  padDuck = 0.25;

  private readonly aL = new Float32Array(FRAME_SAMPLES);
  private readonly aR = new Float32Array(FRAME_SAMPLES);
  private readonly bL = new Float32Array(FRAME_SAMPLES);
  private readonly bR = new Float32Array(FRAME_SAMPLES);
  private readonly padL = new Float32Array(FRAME_SAMPLES);
  private readonly padR = new Float32Array(FRAME_SAMPLES);
  private readonly out = Buffer.alloc(BYTES_PER_FRAME);
  private readonly silence = Buffer.alloc(BYTES_PER_FRAME);

  private smoothedXfA = 1;
  private smoothedXfB = 0;
  private smoothedMaster = 1;
  private duckEnvelope = 0;

  private meterValues: Meters = {
    master: [0, 0],
    A: [0, 0],
    B: [0, 0],
    pads: [0, 0],
    clip: false,
  };
  private clipHold = 0;

  private freewheel: NodeJS.Timeout | null = null;
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
    for (const id of DECK_IDS) if (this.decks[id].playing) return true;
    for (const pad of this.pads) if (pad.playing) return true;
    return false;
  }

  applyMixer(patch: Partial<MixerState>): void {
    if (patch.crossfader !== undefined) this.crossfader = clamp(patch.crossfader, -1, 1);
    if (patch.master !== undefined) this.master = clamp(patch.master, 0, 1.5);
    if (patch.padBus !== undefined) this.padBus = clamp(patch.padBus, 0, 1.5);
    if (patch.padDuck !== undefined) this.padDuck = clamp(patch.padDuck, 0, 1);
  }

  mixerSnapshot(): MixerState {
    return {
      crossfader: this.crossfader,
      master: this.master,
      padBus: this.padBus,
      padDuck: this.padDuck,
    };
  }

  meters(): Meters {
    return this.meterValues;
  }

  /** Render exactly one 20 ms Opus frame of interleaved s16le stereo. */
  renderFrame(): Buffer {
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

    // Constant-power crossfade: equal perceived loudness through the middle.
    const theta = ((this.crossfader + 1) / 2) * (Math.PI / 2);
    const targetA = Math.cos(theta);
    const targetB = Math.sin(theta);

    let peakML = 0;
    let peakMR = 0;
    let peakPL = 0;
    let peakPR = 0;
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

      let l = (this.aL[i] * this.smoothedXfA + this.bL[i] * this.smoothedXfB) * duck + pl;
      let r = (this.aR[i] * this.smoothedXfA + this.bR[i] * this.smoothedXfB) * duck + pr;

      l *= this.smoothedMaster;
      r *= this.smoothedMaster;

      if (l > 1 || l < -1 || r > 1 || r < -1) clipped = true;
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

      const offset = i * 4;
      this.out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), offset);
      this.out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), offset + 2);
    }

    this.updateMeters(peakML, peakMR, peakPL, peakPR, clipped);

    if (endedA) this.emit('trackEnded', 'A');
    if (endedB) this.emit('trackEnded', 'B');

    return this.out;
  }

  private updateMeters(ml: number, mr: number, pl: number, pr: number, clipped: boolean): void {
    const m = this.meterValues;
    const hold = (prev: number, next: number) => (next > prev ? next : prev * METER_DECAY);
    m.master = [hold(m.master[0], ml), hold(m.master[1], mr)];
    m.pads = [hold(m.pads[0], pl), hold(m.pads[1], pr)];
    m.A = [hold(m.A[0], this.decks.A.meter[0]), hold(m.A[1], this.decks.A.meter[1])];
    m.B = [hold(m.B[0], this.decks.B.meter[0]), hold(m.B[1], this.decks.B.meter[1])];
    if (clipped) this.clipHold = 40;
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
