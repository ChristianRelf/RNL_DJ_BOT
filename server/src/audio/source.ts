import { Biquad, lowPass } from './dsp';
import { CHANNELS, SAMPLE_RATE } from '../protocol';
import { FileWindowReader, type WindowReader } from './windowReader';

/**
 * Window length, in frames. Four seconds is long enough that a deck at any
 * playable rate refills roughly once a second, and small enough that ten
 * sources — two decks and eight pads — cost about 15 MB between them.
 */
const WINDOW_FRAMES = SAMPLE_RATE * 4;
/**
 * Frames held either side of the window so the four-point interpolation kernel
 * always has its neighbours. Real audio where the file has it, and a duplicate
 * of the edge sample only at the true start and end of the file — so the only
 * place the guard is a fiction is the place the audio ends anyway.
 */
const GUARD = 2;
const PLANE_FRAMES = WINDOW_FRAMES + GUARD * 2;
/** Refill once the window ahead of the read head falls below this much of it. */
const REFILL_AT = 0.25;
/** Where the head is placed in a fresh window, playing forwards and backwards. */
const LEAD_FORWARD = 0.25;
const LEAD_REVERSE = 0.75;

/**
 * Above this rate the source is lowpassed before it is decimated. Below it the
 * filter would do nothing audible and the deck skips the whole path — which is
 * every ordinary pitch move, so the common case pays nothing for this.
 */
const AA_FROM_RATE = 1.02;
/** Filtered frames kept for the interpolator. Power of two, indexed by mask. */
const AA_FRAMES = 4096;
const AA_MASK = AA_FRAMES - 1;

/**
 * How long a source takes to fade out when its reader runs dry, and to come
 * back when the bytes arrive. 30 ms is long enough that neither edge clicks and
 * short enough that nobody mistakes it for a mix move.
 *
 * Unreachable with a local file — the page cache does not run out — but it is
 * the ordinary case for a reader fed over a socket, which is the point of it.
 */
const STARVE_FADE_FRAMES = Math.round(SAMPLE_RATE * 0.03);
const STARVE_STEP = 1 / STARVE_FADE_FRAMES;

/**
 * Catmull-Rom through four points. Small enough that V8 inlines it, which is
 * what lets both read loops share it instead of keeping two copies in step.
 */
function cubic(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c = -0.5 * y0 + 0.5 * y2;
  return ((a * t + b) * t + c) * t + y1;
}

/**
 * Random-access reader over decoded s16le/48k/stereo audio.
 *
 * The bytes stay wherever the `WindowReader` keeps them and a four-second
 * window lives here as planar float. Float rather than raw bytes because the
 * mix graph is float throughout and converting per sample — four bounds-checked
 * reads for every output frame — was the single most expensive thing on the
 * audio path. Planar rather than interleaved because every consumer wants one
 * channel at a time, and because it is what lets a whole block be copied
 * outright when nothing needs resampling.
 *
 * A refill is ~1.5 MB about once a second per deck, and three quarters of the
 * window it lands in is usually already resident and simply moved down, so the
 * steady-state cost is a fraction of that.
 */
export class PcmSource {
  private readonly planeL = new Float32Array(PLANE_FRAMES);
  private readonly planeR = new Float32Array(PLANE_FRAMES);

  /**
   * This source's read buffer.
   *
   * Per instance rather than shared: it was once a single module-level buffer,
   * which held only because every refill was synchronous and none could
   * overlap. A reader that fetches its bytes from anywhere but the page cache
   * breaks that assumption, and a shared scratch buffer under two interleaved
   * refills is a data race that would surface as one deck playing a slice of
   * the other's audio. Backed by an `Int16Array` so the de-interleave reads
   * aligned 16-bit words rather than assembling them a byte at a time — about
   * three times quicker, and it is the hottest loop here.
   */
  private readonly readInts = new Int16Array(PLANE_FRAMES * CHANNELS);

  /** File frame sitting at plane index 0. Negative at the start of a file. */
  private base = 0;
  /** Window start of the last refill, so one that would not move it is free. */
  private placed = -1;
  /** Positions this window can interpolate, [lo, hi). */
  private lo = 0;
  private hi = 0;
  /**
   * File frame the planes hold real data up to, or Infinity when the last read
   * was fully satisfied. Finite means the reader came up short — an underrun,
   * not the end of the file — and it is what stops the window claiming to cover
   * frames that never arrived.
   */
  private dataEnd = Infinity;
  /** Fade applied while the reader is dry. 1 is running, 0 is faded out. */
  private starveGain = 1;
  private starved = false;
  /** Last sample rendered, held and decayed rather than stepped to silence. */
  private lastL = 0;
  private lastR = 0;
  /**
   * Fraction of the window used before this source refills. Spread per source
   * so two decks that started together do not refill on the same frame for the
   * rest of the set.
   */
  private readonly threshold: number;
  private closed = false;
  /** Allocated the first time a deck runs fast enough to need it, never before. */
  private aa: {
    L: Float32Array;
    R: Float32Array;
    bL: Biquad;
    bR: Biquad;
    /** File frame the filter has run up to. */
    through: number;
    rate: number;
  } | null = null;

  constructor(private readonly reader: WindowReader, ordinal = 0) {
    this.threshold = REFILL_AT * (1 + (ordinal % 5) * 0.06);
    this.refill(0, true);
  }

  /** Convenience for the ordinary case: a decoded file on local disk. */
  static fromFile(filePath: string, ordinal = 0): PcmSource {
    return new PcmSource(new FileWindowReader(filePath), ordinal);
  }

  get frames(): number {
    return this.reader.totalFrames;
  }

  get durationMs(): number {
    return (this.frames / SAMPLE_RATE) * 1000;
  }

  /** True while the reader cannot keep up and the source is faded down. */
  get starving(): boolean {
    return this.starved;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reader.dispose();
  }

  /* -------------------------------------------------------------- window */

  /** True while every tap the kernel needs for this span is already resident. */
  private covers(from: number, to: number): boolean {
    return from >= this.lo && to < this.hi;
  }

  /**
   * Pulls a fresh window around `target`. The head is placed a quarter of the
   * way in when playing forwards so most of the window is read-ahead, and three
   * quarters in when the head is moving back, so a scrub does not refill on
   * every block.
   */
  private refill(target: number, forward: boolean): void {
    if (this.closed) {
      this.lo = 0;
      this.hi = 0;
      return;
    }

    const lead = forward ? LEAD_FORWARD : LEAD_REVERSE;
    const last = Math.max(0, this.frames - WINDOW_FRAMES);
    const start = Math.min(last, Math.max(0, Math.round(target - WINDOW_FRAMES * lead)));
    // The window is already where it would land. This is the ordinary state at
    // the end of a track — the head sits on the last frame and cannot be
    // covered by anything — and without this it would re-read the whole window
    // on every block for as long as the deck stayed there.
    //
    // A window that came up short last time is the exception: it has to be
    // asked again, or a source that underran once would stay silent for as long
    // as the head sat still, however quickly the bytes turned up.
    if (start === this.placed && this.dataEnd === Infinity) return;
    const base = start - GUARD;

    // Three quarters of a forward step is usually already in the planes. Moving
    // it down beats reading it again by an order of magnitude, and a forward
    // step is what almost every refill is.
    //
    // Only ever from planes that were filled completely, though. A short read
    // pads the rest of the window with held edge samples, and carrying those
    // forward would hand the next window a region it believes is audio — a
    // recovered source would play the padding and report no underrun at all,
    // because as far as the coverage check is concerned the frames are there.
    // The re-read this costs happens once, on the refill after a dropout.
    const shift = base - this.base;
    let kept = 0;
    if (this.hi > this.lo && shift > 0 && shift < PLANE_FRAMES && this.dataEnd === Infinity) {
      this.planeL.copyWithin(0, shift);
      this.planeR.copyWithin(0, shift);
      kept = PLANE_FRAMES - shift;
    }
    this.read(base + kept, kept, PLANE_FRAMES - kept);

    this.base = base;
    this.placed = start;
    // A position is usable when all four of its taps sit inside the planes, and
    // when it is inside the file at all. The last frame of the file counts: the
    // guard frames past it hold a duplicate of it, which is exactly the clamp
    // the kernel wants there.
    this.lo = Math.max(0, base + 1);
    this.hi = Math.min(this.frames, base + PLANE_FRAMES - 2);
    // Never claim to cover frames the reader did not deliver. A held edge
    // sample is honest at the end of a file and a lie in the middle of one.
    if (this.dataEnd < this.hi) this.hi = Math.max(this.lo, this.dataEnd - 1);
  }

  /**
   * Reads `count` frames starting at file frame `from` into the planes at
   * `at`. Anything outside the file is filled with the nearest real sample,
   * which is what makes the guard frames safe to interpolate through.
   */
  private read(from: number, at: number, count: number): void {
    const readFrom = Math.max(0, from);
    const readTo = Math.min(this.frames, from + count);
    const wanted = Math.max(0, readTo - readFrom);

    const got = wanted > 0 ? this.reader.read(readFrom, wanted, this.readInts) : 0;
    // Short of what the source says exists means the bytes have not arrived,
    // which is a different thing from running off the end of the file.
    this.dataEnd = got < wanted ? readFrom + got : Infinity;

    const head = at + (readFrom - from);
    const ints = this.readInts;
    const inv = 1 / 32768;
    for (let k = 0; k < got; k++) {
      const j = k * 2;
      this.planeL[head + k] = ints[j] * inv;
      this.planeR[head + k] = ints[j + 1] * inv;
    }

    // Before the first sample and after the last, hold the edge rather than
    // dropping to silence: a duplicated sample interpolates cleanly, a step to
    // zero is a click at the top and tail of every track.
    const firstL = got > 0 ? this.planeL[head] : 0;
    const firstR = got > 0 ? this.planeR[head] : 0;
    for (let k = at; k < head; k++) {
      this.planeL[k] = firstL;
      this.planeR[k] = firstR;
    }
    const tail = head + got;
    const lastL = got > 0 ? this.planeL[tail - 1] : 0;
    const lastR = got > 0 ? this.planeR[tail - 1] : 0;
    for (let k = tail; k < at + count; k++) {
      this.planeL[k] = lastL;
      this.planeR[k] = lastR;
    }
  }

  /**
   * Runs the source through a lowpass matched to the decimation ratio, into a
   * ring the interpolator reads instead of the raw planes.
   *
   * It has to happen here, before the resampling, because that is the only
   * place it can: content above the new Nyquist folds down during decimation,
   * and nothing downstream can tell a folded partial from a real one. No amount
   * of interpolation quality fixes it either — a better kernel reconstructs the
   * signal more accurately, aliases and all.
   *
   * The filter runs *continuously* over the source, picking up where the last
   * block left it, so there is no per-block state discontinuity to buzz at.
   */
  private antialias(from: number, to: number, rate: number): boolean {
    let aa = this.aa;
    if (!aa) {
      aa = this.aa = {
        L: new Float32Array(AA_FRAMES),
        R: new Float32Array(AA_FRAMES),
        bL: new Biquad(),
        bR: new Biquad(),
        through: 0,
        rate: 0,
      };
      aa.through = Math.floor(from) - 1;
    }

    const first = Math.floor(from) - 1;
    const last = Math.min(Math.ceil(to) + 2, this.base + PLANE_FRAMES);
    if (last - first > AA_FRAMES) return false;

    if (Math.abs(rate - aa.rate) > 0.005) {
      aa.rate = rate;
      const c = lowPass((0.45 * SAMPLE_RATE) / rate, 0.7);
      aa.bL.setCoefficients(c);
      aa.bR.setCoefficients(c);
    }

    // The head jumped, so the filter's history belongs to a different part of
    // the track. A cue or a loop wrap lands here; the couple of milliseconds it
    // takes to settle sit under the transport fade.
    if (aa.through < first || aa.through > last) {
      aa.through = first;
      // Primed rather than zeroed: a filter climbing out of silence into the
      // middle of a waveform is a click, and the head lands mid-waveform every
      // time somebody cues.
      const p = first - this.base;
      aa.bL.prime(this.planeL[p]);
      aa.bR.prime(this.planeR[p]);
    }

    for (let f = aa.through; f < last; f++) {
      const p = f - this.base;
      const i = f & AA_MASK;
      aa.L[i] = aa.bL.process(this.planeL[p]);
      aa.R[i] = aa.bR.process(this.planeR[p]);
    }
    aa.through = last;
    return true;
  }

  /* ---------------------------------------------------------------- read */

  /**
   * Renders `n` frames starting at `startPos`, with the rate ramping linearly
   * from `rateStart` to `rateEnd` across the block, and returns the position
   * the head finished on.
   *
   * One containment check for the whole block rather than one per sample is
   * most of the reason this is a block call at all. The rate ramp is the other
   * half: a pitch fader that steps once per block is a stepped, zippered pitch,
   * and interpolating the rate across the block makes the read-head velocity
   * continuous across the join.
   *
   * Writes are overwriting, not summing — callers that need to sum read into
   * their own scratch first.
   */
  readBlock(
    startPos: number,
    rateStart: number,
    rateEnd: number,
    outL: Float32Array,
    outR: Float32Array,
    at: number,
    n: number,
  ): number {
    if (n <= 0) return startPos;

    // The closed form for a linear ramp. The span to cover ends at the head's
    // final resting place rather than past it: a frame is read before the head
    // advances over it, so nothing beyond `endPos` is ever touched. Getting
    // that wrong by even one frame makes the end of every track uncoverable.
    const span = n * ((rateStart + rateEnd) / 2);
    const endPos = startPos + span;
    const from = Math.min(startPos, endPos);
    const to = Math.max(startPos, endPos);

    if (!this.covers(from, to)) {
      this.refill(startPos, span >= 0);
      if (!this.covers(from, to)) {
        // Either the head has run off the end of the file, or the reader has
        // not delivered these frames yet. The first is silence by rights; the
        // second is an underrun, and a step to zero would click on every
        // dropout — so the last sample rendered is held and decayed instead.
        this.starved = true;
        let g = this.starveGain;
        const hl = this.lastL;
        const hr = this.lastR;
        for (let i = 0; i < n; i++) {
          if (g > 0) g = Math.max(0, g - STARVE_STEP);
          outL[at + i] = hl * g;
          outR[at + i] = hr * g;
        }
        this.starveGain = g;
        return startPos + span;
      }
    }

    const L = this.planeL;
    const R = this.planeR;
    const base = this.base;

    // Nothing to resample, and the head is on a frame boundary: the block is a
    // straight copy. This is a deck at zero pitch, which is where a deck spends
    // most of its life, so it is worth more than the interpolator underneath.
    if (rateStart === 1 && rateEnd === 1 && Number.isInteger(startPos)) {
      const p = startPos - base;
      outL.set(L.subarray(p, p + n), at);
      outR.set(R.subarray(p, p + n), at);
      this.settle(outL, outR, at, n);
      return startPos + n;
    }

    let pos = startPos;
    const step = n > 1 ? (rateEnd - rateStart) / n : 0;
    let rate = rateStart;

    // Running fast enough to fold content back below the new Nyquist. Two
    // loops rather than one with a branch in it: this is the hot loop of the
    // whole engine, and the ordinary path should not carry the cost of a case
    // it is not in.
    const meanRate = (rateStart + rateEnd) / 2;
    if (meanRate > AA_FROM_RATE && this.antialias(from, to, meanRate) && this.aa) {
      const fL = this.aa.L;
      const fR = this.aa.R;
      for (let i = 0; i < n; i++) {
        const f0 = Math.floor(pos);
        const t = pos - f0;
        const a0 = (f0 - 1) & AA_MASK;
        const a1 = f0 & AA_MASK;
        const a2 = (f0 + 1) & AA_MASK;
        const a3 = (f0 + 2) & AA_MASK;
        outL[at + i] = cubic(fL[a0], fL[a1], fL[a2], fL[a3], t);
        outR[at + i] = cubic(fR[a0], fR[a1], fR[a2], fR[a3], t);
        pos += rate;
        rate += step;
      }
      this.settle(outL, outR, at, n);
      return pos;
    }

    for (let i = 0; i < n; i++) {
      const p = pos - base;
      const i0 = Math.floor(p);
      const t = p - i0;
      outL[at + i] = cubic(L[i0 - 1], L[i0], L[i0 + 1], L[i0 + 2], t);
      outR[at + i] = cubic(R[i0 - 1], R[i0], R[i0 + 1], R[i0 + 2], t);
      pos += rate;
      rate += step;
    }

    this.settle(outL, outR, at, n);
    return pos;
  }

  /**
   * Book-keeping after a block that actually rendered: remember the last sample
   * so a dropout has something to decay from, and fade back in if the source is
   * coming out of one.
   *
   * The ramp is a second pass over the block rather than a multiply inside the
   * read loops, because it applies on the order of once a session and those
   * loops run 48000 times a second.
   */
  private settle(outL: Float32Array, outR: Float32Array, at: number, n: number): void {
    if (this.starveGain < 1) {
      let g = this.starveGain;
      for (let i = 0; i < n; i++) {
        if (g < 1) g = Math.min(1, g + STARVE_STEP);
        outL[at + i] *= g;
        outR[at + i] *= g;
      }
      this.starveGain = g;
      if (g >= 1) this.starved = false;
    } else {
      this.starved = false;
    }
    this.lastL = outL[at + n - 1];
    this.lastR = outR[at + n - 1];
  }

  /**
   * How far ahead of `pos` the window still reaches, as a fraction of its
   * length. The deck refills early on this rather than waiting for a read to
   * miss, so the cost never lands in the same block as the audio that needed it.
   */
  headroom(pos: number): number {
    return (this.hi - pos) / WINDOW_FRAMES;
  }

  /** Pulls the window forward when the head is running out of read-ahead. */
  prefetch(pos: number, forward: boolean): void {
    if (this.closed) return;
    // The reader is told before the refill, not after: one that fetches its
    // bytes from somewhere slower than the page cache needs the warning while
    // there is still window left to play through, which is exactly what this
    // threshold measures.
    const lead = forward ? LEAD_FORWARD : LEAD_REVERSE;
    this.reader.prefetch(Math.max(0, Math.round(pos - WINDOW_FRAMES * lead)), PLANE_FRAMES);
    if (pos < this.lo || this.headroom(pos) < this.threshold) this.refill(pos, forward);
  }
}
