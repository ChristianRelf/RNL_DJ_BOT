import { CHANNELS, SAMPLE_RATE } from '../protocol';
import type { WindowReader } from './windowReader';

/**
 * How much audio the server holds for one source, in seconds.
 *
 * This is the whole safety margin against a slow connection, a busy device or a
 * browser that decided to throttle the tab. Eight seconds of stereo Int16 is
 * 1.5 MB — two decks and eight pads still come to under 15 MB per rig, and it
 * buys enough slack that a request has to go unanswered for several seconds
 * running before anybody hears it.
 */
const RING_SECONDS = 8;
export const RING_FRAMES = SAMPLE_RATE * RING_SECONDS;

/**
 * Ask for more once the ring holds less than this much ahead of the playhead.
 * Half the ring: late enough not to ask constantly, early enough that a request
 * has four seconds to come back before it is missed.
 */
const LOW_WATER_FRAMES = SAMPLE_RATE * 4;

/**
 * How much is asked for at a time — 48 KB, a quarter of a second.
 *
 * Small deliberately. Every seek has to refill from nothing before the deck can
 * play again, and that pre-roll is the whole of the seek latency: at one-second
 * chunks a cue would sit silent for a second on a slow link. Quarter-second
 * chunks put the first audio on the wire almost immediately and cost four
 * messages a second per deck, which is nothing.
 */
export const CHUNK_FRAMES = Math.round(SAMPLE_RATE / 4);

/**
 * Requests allowed in flight at once. Eight quarter-seconds is two seconds of
 * pipeline, enough to ride out a round trip and to refill quickly after a seek,
 * without letting a stalled host queue up work the next seek will discard.
 */
const MAX_OUTSTANDING = 8;

/** A request for audio, addressed to whichever device is hosting the library. */
export interface AudioNeed {
  sourceKey: string;
  trackId: string;
  fromFrame: number;
  frames: number;
  /**
   * Bumped on every seek. A chunk that comes back carrying an old sequence was
   * in flight when the head moved and describes audio nobody is going to play,
   * so it is dropped rather than written into the ring behind the new position.
   */
  seq: number;
}

/**
 * A `WindowReader` fed over the wire by the device that holds the library.
 *
 * The contract that matters is that `read` is synchronous and never waits: it
 * answers with whatever is in the ring right now, and returns short when the
 * audio has not arrived. `PcmSource` turns a short read into a fade rather than
 * a stall, so a slow device costs a dropout and never a late frame — which is
 * the trade this whole design rests on, because a late frame is the one thing
 * the voice player cannot absorb.
 */
export class RemoteWindowReader implements WindowReader {
  /** Interleaved stereo Int16, circular. */
  private readonly ring = new Int16Array(RING_FRAMES * CHANNELS);
  /** File frame of the oldest frame held. */
  private head = 0;
  /** Ring index of `head`. */
  private headIndex = 0;
  /** Frames held, from `head` forwards. */
  private count = 0;

  private seq = 0;
  /** Frame the next contiguous chunk should start at. */
  private nextRequest = 0;
  private outstanding = 0;
  private closed = false;
  /** Refills from scratch. A number that climbs during ordinary playback means
   *  demand is being sized off the wrong reference, not that the link is slow. */
  private restarts = 0;
  private requested = 0;

  /** Set once the host has said it cannot serve this track at all. */
  private gone = false;

  constructor(
    readonly totalFrames: number,
    private readonly sourceKey: string,
    private readonly trackId: string,
    private readonly onNeed: (need: AudioNeed) => void,
  ) {
    this.restart(0);
  }

  /** True while the ring cannot answer the position the deck is asking for. */
  get dry(): boolean {
    return this.count === 0;
  }

  get bufferedFrames(): number {
    return this.count;
  }

  /** Enough to tell a slow link from a demand bug, on the console and in tests. */
  get stats(): { buffered: number; outstanding: number; restarts: number; requested: number } {
    return {
      buffered: this.count,
      outstanding: this.outstanding,
      restarts: this.restarts,
      requested: this.requested,
    };
  }

  /**
   * The host has dropped this track — the file moved, the folder was
   * disconnected, or permission was revoked. Further requests would go
   * unanswered forever, so they stop.
   */
  markGone(): void {
    this.gone = true;
    this.count = 0;
  }

  read(fromFrame: number, frames: number, into: Int16Array): number {
    if (this.closed || frames <= 0) return 0;

    const offset = fromFrame - this.head;
    if (offset < 0 || offset >= this.count) {
      // Not held. Answering short is what makes the source fade rather than
      // stall — and asking for it is deliberately *not* done here. A read
      // arrives with whatever offset the window happens to be filling from,
      // which during ordinary playback is the far end of the window, seconds
      // ahead of the playhead. Sizing demand off that makes the ring believe it
      // is permanently behind: it over-requests, rolls forward over audio the
      // deck has not played yet, and then has to fetch it a second time. The
      // playhead is the only honest reference, and `prefetch` is the only
      // caller that has it.
      return 0;
    }

    const available = Math.min(frames, this.count - offset);
    const start = (this.headIndex + offset) % RING_FRAMES;
    const firstRun = Math.min(available, RING_FRAMES - start);

    into.set(this.ring.subarray(start * CHANNELS, (start + firstRun) * CHANNELS), 0);
    if (firstRun < available) {
      // The span wrapped the end of the ring, so it takes two copies.
      into.set(
        this.ring.subarray(0, (available - firstRun) * CHANNELS),
        firstRun * CHANNELS,
      );
    }

    return available;
  }

  /**
   * The playhead, told to the reader once per block by the deck. This is the
   * sole driver of demand — see `read` for why nothing else may be.
   */
  prefetch(fromFrame: number): void {
    if (this.closed) return;
    this.want(fromFrame);
  }

  dispose(): void {
    this.closed = true;
    this.count = 0;
  }

  /* ------------------------------------------------------------- demand */

  /**
   * Keeps the ring stocked around `pos`.
   *
   * Called from the audio path on every block, so the common case — plenty
   * buffered, nothing to do — has to be a couple of comparisons and out.
   */
  private want(pos: number): void {
    if (this.closed || this.gone) return;

    const offset = pos - this.head;
    // Outside the ring entirely: the head has been moved by a cue, a loop or a
    // scrub, and everything buffered describes somewhere else. Start again from
    // where the deck actually is.
    if (offset < 0 || offset > this.count) {
      this.restart(pos);
      return;
    }

    const ahead = this.count - offset;
    if (ahead >= LOW_WATER_FRAMES) return;

    while (this.outstanding < MAX_OUTSTANDING && this.nextRequest < this.totalFrames) {
      this.request();
    }
  }

  /**
   * Throws the ring away and refills it from `pos`.
   *
   * Exactly from `pos`, with nothing fetched behind it. The source always asks
   * for a window that starts before its playhead, so anything bought back here
   * is pre-roll the deck has to wait through before it makes a sound — and
   * history for scrubbing arrives free anyway, as the playhead walks forward
   * through a ring that is kept filled ahead of it.
   */
  private restart(pos: number): void {
    const from = Math.max(0, Math.floor(pos));

    this.seq++;
    this.restarts++;
    this.head = from;
    this.headIndex = 0;
    this.count = 0;
    this.nextRequest = from;
    // Anything in flight belongs to the old position and will be dropped on
    // arrival by the sequence check, so it must not hold the new fill back.
    this.outstanding = 0;

    if (this.gone || from >= this.totalFrames) return;
    // Filled in one burst rather than one chunk at a time: after a seek the
    // deck is silent until the pre-roll lands, so there is no reason to make
    // that queue form at the pace of the round trip.
    while (this.outstanding < MAX_OUTSTANDING && this.nextRequest < this.totalFrames) {
      this.request();
    }
  }

  private request(): void {
    const remaining = this.totalFrames - this.nextRequest;
    if (remaining <= 0) return;

    const frames = Math.min(CHUNK_FRAMES, remaining);
    const need: AudioNeed = {
      sourceKey: this.sourceKey,
      trackId: this.trackId,
      fromFrame: this.nextRequest,
      frames,
      seq: this.seq,
    };
    this.nextRequest += frames;
    this.outstanding++;
    this.requested += frames;
    this.onNeed(need);
  }

  /**
   * Takes a chunk back from the host.
   *
   * Chunks are only ever written contiguously onto the end of what is already
   * held. One that does not line up is either stale or the result of a dropped
   * request, and guessing where it belongs would put a slice of the wrong part
   * of the track into the middle of the ring — audible, and hard to explain.
   */
  push(seq: number, fromFrame: number, pcm: Int16Array): boolean {
    if (this.closed || seq !== this.seq) return false;

    this.outstanding = Math.max(0, this.outstanding - 1);

    const frames = Math.floor(pcm.length / CHANNELS);
    if (frames <= 0) return false;

    const expected = this.head + this.count;
    // An empty ring accepts whatever the outstanding request was for; a
    // populated one only accepts the frames that come next.
    if (this.count === 0) {
      this.head = fromFrame;
      this.headIndex = 0;
    } else if (fromFrame !== expected) {
      return false;
    }

    // Bulk copies rather than a loop with a modulo in it. This lands on the
    // main thread between render frames, and 48000 iterations of pointer
    // arithmetic is exactly the kind of jitter the ring exists to prevent.
    const take = Math.min(frames, RING_FRAMES);
    const skip = frames - take;
    const writeAt = (this.headIndex + this.count) % RING_FRAMES;
    const firstRun = Math.min(take, RING_FRAMES - writeAt);

    this.ring.set(
      pcm.subarray(skip * CHANNELS, (skip + firstRun) * CHANNELS),
      writeAt * CHANNELS,
    );
    if (firstRun < take) {
      this.ring.set(pcm.subarray((skip + firstRun) * CHANNELS, (skip + take) * CHANNELS), 0);
    }

    this.head += skip;
    this.count += take;
    if (this.count > RING_FRAMES) {
      // Overflowed: the oldest frames have been written over, so the window
      // slides forward by however many were lost.
      const dropped = this.count - RING_FRAMES;
      this.head += dropped;
      this.headIndex = (this.headIndex + dropped) % RING_FRAMES;
      this.count = RING_FRAMES;
    }

    return true;
  }
}
