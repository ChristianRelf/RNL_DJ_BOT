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
  /** Stereo position, -1 = hard left, 0 = centre, +1 = hard right */
  pan: number;
  /** Post-fader send into the effects bus, 0..1 */
  fxSend: number;
  /** Takes the channel off the master without moving the fader. */
  muted: boolean;
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

/** Effects the send bus can be running. One at a time, like a hardware unit. */
export type FxType = 'echo' | 'reverb' | 'flanger';

export const FX_TYPES: FxType[] = ['echo', 'reverb', 'flanger'];

export interface FxState {
  type: FxType;
  /** Wet return into the master, 0..1 */
  mix: number;
  /**
   * Echo and flanger read this as a delay time in ms; reverb reads it as room
   * size. 20..2000.
   */
  timeMs: number;
  /** Regeneration, 0..0.95 — reverb reads it as decay. */
  feedback: number;
  /** Damping of the wet path, 0 = dark, 1 = bright. */
  tone: number;
}

export interface MixerState {
  /** -1 = deck A only, +1 = deck B only */
  crossfader: number;
  /**
   * Crossfader shape: 0 is a smooth constant-power blend, 1 is a sharp cut
   * that reaches full level within a sliver of travel.
   */
  crossfaderCurve: number;
  /** Master output gain, 0..1.5 */
  master: number;
  /** Master left/right balance, -1..1 */
  balance: number;
  /** Sums the master to mono — for a club rig or a phone speaker. */
  mono: boolean;
  /** Brickwall limiter on the master, in place of the soft clipper. */
  limiter: boolean;
  /** Master 3-band EQ in dB, -26..+6 */
  masterEq: DeckEq;
  /** Sample pad bus gain, 0..1.5 */
  padBus: number;
  /** Ducks the decks while a pad plays, 0 = off, 1 = full duck */
  padDuck: number;
  fx: FxState;
}

/**
 * Optional extras, switched on per rig from /deck/tools. They are off by
 * default: each one either opens a network surface or reaches out to the
 * internet, so turning it on should be a decision somebody made.
 */
export interface ToolsState {
  /** Publishes deck positions over HTTP for lighting, overlays and video. */
  timecode: boolean;
  /**
   * Key the timecode endpoint requires. External consumers cannot hold a
   * Discord session, so the URL itself is the credential — it is rotated every
   * time the tool is switched on.
   */
  timecodeKey: string;
  /** Lets operators pull a direct audio URL into the media pool. */
  urlImport: boolean;
  /** Streams deck and mixer state to an OSC listener over UDP. */
  osc: boolean;
  oscHost: string;
  oscPort: number;
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
  tools: ToolsState;
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
  /** Wet return of the effects bus. */
  fx: [number, number];
  clip: boolean;
  /** Gain reduction the master limiter is applying, 0..1 (1 = none). */
  reduction: number;
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
    pan?: number;
    fxSend?: number;
    muted?: boolean;
    repeat?: boolean;
    eq?: Partial<DeckEq>;
  };
  'deck:loop': { deck: DeckId; active: boolean; startMs?: number; endMs?: number };
  'pad:assign': { index: number; mediaId: string | null };
  'pad:trigger': { index: number };
  'pad:stop': { index: number };
  'pad:set': { index: number; gain?: number; mode?: PadMode };
  /** Nested sections patch band by band, so two operators can share a knob row. */
  'mixer:set': Partial<Omit<MixerState, 'masterEq' | 'fx'>> & {
    masterEq?: Partial<DeckEq>;
    fx?: Partial<FxState>;
  };
  /** The key is rotated server-side, never set from a client. */
  'tools:set': Partial<Omit<ToolsState, 'timecodeKey'>>;
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
