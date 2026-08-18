import { EventEmitter } from 'node:events';
import { CHANNELS } from '../protocol';
import { createLogger } from '../logger';
import { RemoteWindowReader, type AudioNeed, type ReaderStats } from './remoteWindow';

const log = createLogger('host');

/**
 * A track the host device can serve, as reported by its folder scan.
 *
 * `frames` is the decoded length in sample frames and is authoritative — it is
 * what the ring sizes its requests against, so it comes from the device that
 * actually decoded the file rather than being derived from a duration that has
 * been rounded to milliseconds somewhere along the way.
 */
export interface HostTrack {
  trackId: string;
  title: string;
  /** Path inside the host's music folder, for telling two copies apart. */
  path: string;
  frames: number;
  sizeBytes: number;
}

export interface HostSnapshot {
  /** Whether any device is currently able to serve audio for this rig. */
  hosted: boolean;
  /** Who is hosting, for the console to badge. */
  userId: string | null;
  userName: string | null;
  trackCount: number;
}

/**
 * The link between a rig and the device holding its music.
 *
 * One device at a time. Audio for a guild has to come from somewhere the whole
 * rig agrees on: two consoles serving different folders would mean the same
 * track id resolving to different audio depending on which happened to answer,
 * which is not a thing that can be debugged after the fact.
 */
export class HostSession extends EventEmitter {
  private socketId: string | null = null;
  private userId: string | null = null;
  private userName: string | null = null;
  private send: ((need: AudioNeed) => void) | null = null;

  private tracks = new Map<string, HostTrack>();
  /** Live readers by source key — `deck:A`, `pad:3`. */
  private readers = new Map<string, RemoteWindowReader>();

  get hosted(): boolean {
    return this.socketId !== null;
  }

  get hostSocketId(): string | null {
    return this.socketId;
  }

  snapshot(): HostSnapshot {
    return {
      hosted: this.hosted,
      userId: this.userId,
      userName: this.userName,
      trackCount: this.tracks.size,
    };
  }

  track(trackId: string): HostTrack | undefined {
    return this.tracks.get(trackId);
  }

  list(): HostTrack[] {
    return [...this.tracks.values()];
  }

  /* --------------------------------------------------------------- claim */

  /**
   * A console offers to serve this rig's audio.
   *
   * An existing host is not displaced — whoever got there first keeps it, and
   * the newcomer is told so. Taking the mix away from a device that is actively
   * feeding it, because somebody else opened a browser tab, is not a thing that
   * should be able to happen by accident.
   */
  claim(params: {
    socketId: string;
    userId: string;
    userName: string;
    tracks: HostTrack[];
    send: (need: AudioNeed) => void;
  }): { ok: boolean; reason?: string } {
    if (this.socketId && this.socketId !== params.socketId) {
      return { ok: false, reason: `${this.userName ?? 'Another DJ'} is already hosting this rig.` };
    }

    const first = this.socketId === null;
    this.socketId = params.socketId;
    this.userId = params.userId;
    this.userName = params.userName;
    this.send = params.send;

    this.tracks.clear();
    for (const track of params.tracks) this.tracks.set(track.trackId, track);

    log.info(
      `${params.userName} is hosting ${params.tracks.length} track${params.tracks.length === 1 ? '' : 's'}`,
    );
    if (first) this.emit('gained');
    this.emit('change');
    return { ok: true };
  }

  /** A rescan, or a track list that changed under the same host. */
  update(socketId: string, tracks: HostTrack[]): boolean {
    if (this.socketId !== socketId) return false;
    this.tracks.clear();
    for (const track of tracks) this.tracks.set(track.trackId, track);
    this.emit('change');
    return true;
  }

  /**
   * The host is gone — disconnected, navigated away, or released deliberately.
   *
   * The readers are left in place rather than torn down. They will simply stop
   * being answered, which the sources turn into a fade; tearing them down would
   * eject the decks, and a host that comes back within a few seconds should be
   * able to pick the set back up rather than find it cleared.
   */
  release(socketId: string): boolean {
    if (this.socketId !== socketId) return false;
    const who = this.userName;
    this.socketId = null;
    this.userId = null;
    this.userName = null;
    this.send = null;
    log.warn(`${who ?? 'the host'} stopped hosting — decks will run dry`);
    this.emit('lost');
    this.emit('change');
    return true;
  }

  /* -------------------------------------------------------------- audio */

  /**
   * A reader for one source, or null when the host cannot serve that track.
   *
   * Replaces whatever was on that source key, so loading a deck twice does not
   * leave the first reader asking for audio nobody is going to play.
   */
  reader(sourceKey: string, trackId: string): RemoteWindowReader | null {
    const track = this.tracks.get(trackId);
    if (!track) return null;

    this.drop(sourceKey);
    const reader = new RemoteWindowReader(track.frames, sourceKey, trackId, (need) => {
      // Dropped on the floor when there is no host. The request is not queued:
      // by the time somebody starts hosting again the deck will have moved, and
      // the ring asks for what it needs afresh every block anyway.
      this.send?.(need);
    });
    this.readers.set(sourceKey, reader);
    return reader;
  }

  drop(sourceKey: string): void {
    const existing = this.readers.get(sourceKey);
    if (!existing) return;
    existing.dispose();
    this.readers.delete(sourceKey);
  }

  /**
   * Audio back from the host.
   *
   * The payload arrives as a raw buffer off the socket. It is copied into an
   * `Int16Array` view rather than reinterpreted in place because socket.io does
   * not promise the underlying buffer is aligned to two bytes, and an
   * unaligned view throws.
   */
  chunk(socketId: string, sourceKey: string, seq: number, fromFrame: number, payload: Buffer): void {
    if (this.socketId !== socketId) return;
    const reader = this.readers.get(sourceKey);
    if (!reader) return;

    const frames = Math.floor(payload.byteLength / (CHANNELS * 2));
    if (frames <= 0) return;

    const pcm = new Int16Array(frames * CHANNELS);
    // `Buffer` is little-endian on every platform this runs on and the host
    // sends little-endian; the copy is a straight reinterpretation.
    Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).set(
      payload.subarray(0, frames * CHANNELS * 2),
    );

    reader.push(seq, fromFrame, pcm);
  }

  /** The host can no longer serve a track: file moved, permission revoked. */
  gone(socketId: string, trackId: string): void {
    if (this.socketId !== socketId) return;
    this.tracks.delete(trackId);
    for (const reader of this.readers.values()) {
      if (reader.trackId === trackId) reader.markGone();
    }
    this.emit('change');
  }

  /** Per-source buffer health, for the console and the portal. */
  stats(): Record<string, ReaderStats> {
    const out: Record<string, ReaderStats> = {};
    for (const [key, reader] of this.readers) out[key] = reader.stats;
    return out;
  }

  dispose(): void {
    for (const reader of this.readers.values()) reader.dispose();
    this.readers.clear();
    this.tracks.clear();
    this.socketId = null;
    this.send = null;
  }
}
