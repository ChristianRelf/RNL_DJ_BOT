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
  /**
   * May force-take the decks and delete anyone's media — in *this* guild.
   *
   * Resolved per connection rather than carried in the session, because one
   * person is not the same thing in two servers, and a token cannot say "admin"
   * without saying where.
   */
  isAdmin: boolean;
  /**
   * Runs the platform: the portal, the allowlist, the bot pool, every rig. A
   * step above a guild admin, and global rather than per-server.
   */
  isPlatformAdmin: boolean;
}

/**
 * The Discord account the rig is currently playing through. No token material —
 * this rides the state broadcast, which every signed-in DJ receives.
 */
export interface ActiveBot {
  /** Registry id, or `default` for the bot configured in the environment. */
  id: string;
  name: string;
  /** The bot's Discord tag once it has logged in. */
  tag: string | null;
  applicationId: string;
  status: 'ready' | 'connecting' | 'error';
  error: string | null;
}

/**
 * `missing` is a track the pool knows about that the hosting device's last scan
 * could not find — a file moved, a drive unplugged, nobody hosting. It is kept
 * rather than deleted so a queue entry, a pad assignment or a beat grid pointing
 * at it survives until the folder comes back.
 */
export type MediaStatus = 'processing' | 'ready' | 'error' | 'missing';

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
  /**
   * Authoritative tempo. A hand-set value wins over anything detected, which is
   * why this stays separate from the grid below rather than being read off it.
   */
  bpm: number | null;
  /** Where the beats are, or null when nothing trustworthy was found. */
  beatGrid: BeatGrid | null;
  /** Camelot notation, e.g. "8A". Set by hand for now. */
  key: string | null;
  tags: string[];
  status: MediaStatus;
  error?: string;
}

/**
 * Where the beats of a track are.
 *
 * Deliberately a tempo and an offset rather than a list of beat times. A list
 * would be the honest shape for a track that genuinely drifts, but it is ~800
 * numbers per track in a store that rewrites itself whole on every change and
 * ships the full library on connect — and it turns every consumer, from a
 * quantised cue to a tempo-locked delay, into a binary search instead of one
 * multiply. Tracks that really do drift are the ones a single tempo cannot
 * describe at all, and `confidence` is how those are refused rather than
 * mis-described.
 *
 *   the nth beat, in source ms = beatOffsetMs + n * 60000 / bpm
 */
export interface BeatGrid {
  bpm: number;
  /** Where the first beat sits, 0 <= x < one beat. */
  beatOffsetMs: number;
  beatsPerBar: number;
  /** Which beat of the bar lands on `beatOffsetMs`. Zero until somebody says. */
  downbeat: number;
  /** How well the detected beats agreed on one grid, 0..1. */
  confidence: number;
  source: 'auto' | 'manual';
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
  /**
   * The deck is loaded and playing, but its audio is not arriving fast enough
   * and it has faded down waiting. Always false for a deck reading a local
   * file; the console shows it so a dropout reads as a supply problem rather
   * than as the deck having silently stopped.
   */
  starved: boolean;
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

/**
 * One track lined up to play.
 *
 * Only the media id is stored: the title, artwork and duration are read from
 * the pool by whoever is displaying it, so a rename never leaves a stale copy
 * sitting in the queue.
 */
export interface QueueItem {
  /** Queue entry id — not the media id, so the same track can be queued twice. */
  id: string;
  mediaId: string;
  addedBy: { id: string; name: string };
  addedAt: number;
}

export interface QueueState {
  items: QueueItem[];
  /**
   * Load and play the next track automatically when a deck runs out. Off by
   * default: a deck going quiet is sometimes the point.
   */
  auto: boolean;
}

/** The most tracks that can be lined up at once. */
export const QUEUE_LIMIT = 200;

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
  /**
   * Captions the voice channel while the rig is in it. The one tool that is on
   * by default: it writes nothing outside the channel already being played to,
   * and it is how people who never open the console know the decks are live.
   */
  channelStatus: boolean;
  /** What the caption says. Blank falls back to the built-in wording. */
  channelStatusText: string;
  /** Shows the current track as the playback bot's Discord activity. */
  presence: boolean;
  /** Posts each track to a Discord channel as it takes over the mix. */
  announce: boolean;
  /** Discord webhook URL the announcements go to. Blank means nowhere. */
  announceWebhook: string;
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

/**
 * Which device is serving this rig's audio.
 *
 * Deck plays straight off a folder on somebody's machine — nothing is uploaded
 * and the server keeps no audio at all — so exactly one console at a time holds
 * the library and answers requests for it. When nobody does, the decks have
 * nothing to play.
 */
export interface HostState {
  hosted: boolean;
  userId: string | null;
  userName: string | null;
  trackCount: number;
}

/**
 * A track the hosting device can serve, from its folder scan.
 *
 * The id is a content hash rather than a path, so renaming a file or moving it
 * within the folder keeps whatever the server knows about it — the beat grid,
 * the cue point, the tags.
 */
export interface HostTrackInfo {
  trackId: string;
  title: string;
  path: string;
  /** Decoded length in sample frames. Authoritative: the ring sizes requests off it. */
  frames: number;
  sizeBytes: number;
}

/** Server asking the host for audio. Answered with `audio:chunk`. */
export interface AudioNeedMessage {
  sourceKey: string;
  trackId: string;
  fromFrame: number;
  frames: number;
  /** Bumped on every seek; a chunk carrying a stale one is dropped on arrival. */
  seq: number;
}

/** Host answering, with interleaved s16le stereo as a binary attachment. */
export interface AudioChunkMessage {
  sourceKey: string;
  fromFrame: number;
  seq: number;
  pcm: ArrayBuffer | Uint8Array;
}

export interface EngineState {
  decks: Record<DeckId, DeckState>;
  pads: PadState[];
  queue: QueueState;
  mixer: MixerState;
  tools: ToolsState;
  bot: ActiveBot;
  voice: VoiceState;
  control: ControlState;
  host: HostState;
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
  /**
   * What one 20 ms frame costs to render, as [median, 95th percentile] in ms.
   * The budget is 20 — the voice player pulls a frame every 20 ms and a late
   * one is a dropout, so this is the number that says how much room is left.
   */
  frameMs: [number, number];
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
  /** Adds to the end, or to the front when `next` is set. */
  'queue:add': { mediaId: string; next?: boolean };
  /** Your own entries, or anyone's with control or admin. */
  'queue:remove': { id: string };
  'queue:move': { id: string; to: number };
  'queue:clear': Record<string, never>;
  /** Takes the next track off the queue and loads it onto a deck. */
  'queue:load': { deck: DeckId; play?: boolean };
  'queue:set': { auto: boolean };
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
  /**
   * Re-reads the beat grid off an already-decoded track. Exists because aubio
   * tends to get installed *after* a library has been imported, not before.
   */
  'media:analyse': { id: string };
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

/* --------------------------------------------------------- bot registry */

/**
 * A playback bot as the console sees it. Tokens never leave the server: the
 * fingerprint is there so two entries can be told apart, and so you can check
 * that the token you pasted is the one that got stored.
 */
export interface BotSummary {
  id: string;
  name: string;
  applicationId: string;
  tag: string | null;
  /** First eight hex of the token's SHA-256. Not reversible. */
  fingerprint: string;
  /** True for the bot configured in the environment, which cannot be removed. */
  isDefault: boolean;
  active: boolean;
  addedBy: { id: string; name: string } | null;
  addedAt: number | null;
  /** Why this bot last failed to connect, if it did. */
  error: string | null;
}

