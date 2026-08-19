import dgram from 'node:dgram';
import net from 'node:net';
import { createLogger } from '../logger';
import type { EngineState } from '../protocol';

const log = createLogger('osc');

/** How often mix state goes out while the tool is on. */
const SEND_INTERVAL_MS = 100;
/** Back off this long after a send fails, so a dead listener is not hammered. */
const BACKOFF_MS = 5_000;

/**
 * Minimal OSC 1.0 encoding.
 *
 * The protocol is small enough that writing it beats taking a dependency: an
 * address string, a comma-prefixed type tag, then the arguments — every part
 * padded with NULs to a four-byte boundary.
 */
/**
 * An OSC string is its characters, then at least one NUL, then however many
 * more NULs it takes to reach a four-byte boundary. A string whose length is
 * already a multiple of four therefore gains a whole extra block — getting that
 * case wrong produces messages that receivers quietly drop.
 */
function oscString(value: string): Buffer {
  const raw = Buffer.from(value, 'ascii');
  const total = (raw.length + 4) & ~3;
  return Buffer.concat([raw, Buffer.alloc(total - raw.length)]);
}

type OscArg = number | string | boolean;

export function encode(address: string, args: OscArg[] = []): Buffer {
  const tags: string[] = [];
  const parts: Buffer[] = [];

  for (const arg of args) {
    if (typeof arg === 'number') {
      // Everything numeric goes out as a float32: receivers expect a consistent
      // type per address, and positions and gains are all fractional anyway.
      const buffer = Buffer.alloc(4);
      buffer.writeFloatBE(arg, 0);
      tags.push('f');
      parts.push(buffer);
    } else if (typeof arg === 'boolean') {
      // OSC booleans carry no payload — the tag is the value.
      tags.push(arg ? 'T' : 'F');
    } else {
      tags.push('s');
      parts.push(oscString(arg));
    }
  }

  return Buffer.concat([oscString(address), oscString(`,${tags.join('')}`), ...parts]);
}

/** Every address the tool publishes, in the order they are sent. */
export function frame(state: EngineState): Buffer[] {
  const messages: Buffer[] = [];
  for (const id of ['A', 'B'] as const) {
    const deck = state.decks[id];
    const key = id.toLowerCase();
    messages.push(encode(`/deck/${key}/position`, [deck.positionMs / 1000]));
    messages.push(encode(`/deck/${key}/duration`, [deck.durationMs / 1000]));
    messages.push(encode(`/deck/${key}/playing`, [deck.playing]));
    messages.push(encode(`/deck/${key}/bpm`, [(deck.bpm ?? 0) * deck.rate]));
    messages.push(encode(`/deck/${key}/gain`, [deck.gain]));
    messages.push(encode(`/deck/${key}/title`, [deck.title ?? '']));
  }
  messages.push(encode('/mixer/crossfader', [state.mixer.crossfader]));
  messages.push(encode('/mixer/master', [state.mixer.master]));
  return messages;
}

/**
 * Streams mix state to an OSC listener over UDP.
 *
 * Deliberately unicast only. UDP is unauthenticated and this sends on a timer,
 * so pointing it at a broadcast or multicast address would spray the mix state
 * across a whole network segment.
 */
export class OscSender {
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private host = '127.0.0.1';
  private port = 9000;
  private mutedUntil = 0;
  private snapshot: (() => EngineState) | null = null;

  start(snapshot: () => EngineState, host: string, port: number): void {
    this.stop();
    if (!isUnicast(host)) {
      log.warn(`refusing to send to "${host}" — unicast addresses only`);
      return;
    }
    this.snapshot = snapshot;
    this.host = host;
    this.port = port;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => log.warn('socket error:', err.message));
    this.socket.unref();
    this.timer = setInterval(() => this.tick(), SEND_INTERVAL_MS);
    this.timer.unref?.();
    log.info(`sending to ${host}:${port}`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.snapshot = null;
  }

  private tick(): void {
    const socket = this.socket;
    const snapshot = this.snapshot;
    if (!socket || !snapshot || Date.now() < this.mutedUntil) return;
    for (const message of frame(snapshot())) {
      socket.send(message, this.port, this.host, (err) => {
        if (!err) return;
        this.mutedUntil = Date.now() + BACKOFF_MS;
        log.warn(`send failed, pausing briefly: ${err.message}`);
      });
    }
  }
}

/**
 * Literal addresses are checked directly; hostnames are allowed through and
 * resolved by the socket. Broadcast, multicast and the unspecified address are
 * refused outright.
 */
export function isUnicast(host: string): boolean {
  if (!host) return false;
  const version = net.isIP(host);
  if (version === 0) return true; // a hostname — nothing to inspect here
  if (version === 6) return host !== '::' && !host.toLowerCase().startsWith('ff');
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  if (octets[0] === 0) return false; // unspecified
  if (octets[0] >= 224) return false; // multicast and reserved
  if (octets.every((n) => n === 255)) return false; // broadcast
  return true;
}

/** Instantiated per rig — one UDP socket and one timer each. */
