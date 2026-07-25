/**
 * Wire contract shared by the server and the web control surface.
 *
 * This file is mirrored verbatim at web/src/protocol.ts — keep the two in sync.
 * (They are separate npm workspaces, so a copy is cheaper than a third package.)
 */

export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
export const FRAME_MS = 20;
/** Sample-frames per 20 ms Opus frame. */
export const FRAME_SAMPLES = (SAMPLE_RATE / 1000) * FRAME_MS; // 960
export const BYTES_PER_FRAME = FRAME_SAMPLES * CHANNELS * 2; // s16le stereo
/** Resolution of the waveform envelope stored per media item. */
export const PEAK_BUCKETS = 1200;

export const PAD_COUNT = 8;
export const DECK_IDS = ['A', 'B'] as const;
export type DeckId = (typeof DECK_IDS)[number];

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export type MediaStatus = 'processing' | 'ready' | 'error';

export interface MediaItem {
  id: string;
  title: string;
  originalName: string;
  durationMs: number;
  sizeBytes: number;
  uploadedBy: { id: string; name: string };
  uploadedAt: number;
  /** Mono peak envelope, PEAK_BUCKETS values in 0..1. Empty while processing. */
  peaks: number[];
  bpm: number | null;
  tags: string[];
  status: MediaStatus;
  error?: string;
}

export interface DeckEq {
  low: number;
  mid: number;
  high: number;
}

export interface DeckLoop {
  active: boolean;
  startMs: number;
  endMs: number;
}

export interface DeckState {
  id: DeckId;
  mediaId: string | null;
  title: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  /** Channel fader, 0..1.25 */
  gain: number;
  /** Input trim, 0..2 */
  trim: number;
  /** Playback rate / turntable pitch, 0.5..2 */
  rate: number;
  /** Per-band gain in dB, -26..+6 */
  eq: DeckEq;
  /** -1 = full low-pass, 0 = bypass, +1 = full high-pass */
  filter: number;
  cueMs: number;
  loop: DeckLoop;
  repeat: boolean;
  bpm: number | null;
}

export type PadMode = 'oneshot' | 'loop' | 'gate';

export interface PadState {
  index: number;
  mediaId: string | null;
  title: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  gain: number;
  mode: PadMode;
}

export interface MixerState {
  /** -1 = deck A only, +1 = deck B only */
  crossfader: number;
  /** Master output gain, 0..1.5 */
  master: number;
  /** Sample pad bus gain, 0..1.5 */
  padBus: number;
  /** Ducks the decks while a pad plays, 0 = off, 1 = full duck */
  padDuck: number;
}

export type VoiceStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

export interface VoiceState {
  status: VoiceStatus;
  channelId: string | null;
  channelName: string | null;
  listeners: number;
  error: string | null;
}

export interface VoiceChannelInfo {
  id: string;
  name: string;
  members: number;
  full: boolean;
}

export interface ControlRequest {
  userId: string;
  name: string;
  requestedAt: number;
}

export interface ControlState {
  holderId: string | null;
  holderName: string | null;
  heldSince: number | null;
  /** Epoch ms at which idle timeout drops control. Null when no timeout. */
  expiresAt: number | null;
  queue: ControlRequest[];
}

export interface PresenceUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  connections: number;
}

export interface EngineState {
  decks: Record<DeckId, DeckState>;
  pads: PadState[];
  mixer: MixerState;
  voice: VoiceState;
  control: ControlState;
  users: PresenceUser[];
  channels: VoiceChannelInfo[];
  rev: number;
  serverTime: number;
}

/** Peak levels in 0..1, [left, right]. Broadcast at ~15 Hz. */
export interface Meters {
  master: [number, number];
  A: [number, number];
  B: [number, number];
  pads: [number, number];
  clip: boolean;
}

export interface Toast {
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

/** Every command a control surface can send. `ack` carries an error string. */
export interface ClientCommands {
  'deck:load': { deck: DeckId; mediaId: string };
  'deck:eject': { deck: DeckId };
  'deck:play': { deck: DeckId };
  'deck:pause': { deck: DeckId };
  'deck:cue': { deck: DeckId };
  'deck:setCue': { deck: DeckId; ms: number };
  'deck:seek': { deck: DeckId; ms: number };
  'deck:nudge': { deck: DeckId; deltaMs: number };
  'deck:set': {
    deck: DeckId;
    gain?: number;
    trim?: number;
    rate?: number;
    filter?: number;
    repeat?: boolean;
    eq?: Partial<DeckEq>;
  };
  'deck:loop': { deck: DeckId; active: boolean; startMs?: number; endMs?: number };
  'pad:assign': { index: number; mediaId: string | null };
  'pad:trigger': { index: number };
  'pad:stop': { index: number };
  'pad:set': { index: number; gain?: number; mode?: PadMode };
  'mixer:set': Partial<MixerState>;
  'voice:join': { channelId: string };
  'voice:leave': Record<string, never>;
  'media:update': { id: string; title?: string; bpm?: number | null; tags?: string[] };
  'media:delete': { id: string };
  'control:request': Record<string, never>;
  'control:release': Record<string, never>;
  'control:cancel': Record<string, never>;
  'control:grant': { userId: string };
  'control:take': Record<string, never>;
  'control:heartbeat': Record<string, never>;
}

export type CommandName = keyof ClientCommands;

export interface ServerToClient {
  hello: (payload: { user: SessionUser; state: EngineState; media: MediaItem[] }) => void;
  state: (state: EngineState) => void;
  media: (media: MediaItem[]) => void;
  meters: (meters: Meters) => void;
  toast: (toast: Toast) => void;
}

export interface Ack {
  ok: boolean;
  error?: string;
}
