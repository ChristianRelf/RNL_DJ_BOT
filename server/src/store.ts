import { db } from './db';
import { createLogger } from './logger';
import type {
  MediaItem,
  MixerState,
  PadMode,
  QueueItem,
  QueueState,
  RequestItem,
  ToolsState,
} from './protocol';

const log = createLogger('store');

export interface PersistedPad {
  mediaId: string | null;
  gain: number;
  mode: PadMode;
}

/**
 * A playback bot an owner added from the portal. The token is sealed (see
 * secrets.ts) so a stolen copy of the database is not a usable Discord account.
 *
 * Platform-wide rather than per-guild: one Discord account can be on air in
 * several servers at once, and re-pasting the same token per rig would mean the
 * same secret stored several times over.
 */
export interface PersistedBot {
  id: string;
  name: string;
  applicationId: string;
  tag: string | null;
  /** Encrypted. Never logged, never sent to a client. */
  token: string;
  fingerprint: string;
  addedBy: { id: string; name: string };
  addedAt: number;
}

/**
 * Somebody asking for access. Written by the public endpoint, read only by a
 * platform admin — this is the one place in the database that holds details of
 * people who are not in any guild, so it stays out of every state broadcast.
 */
export interface WaitlistEntry {
  id: string;
  /** Discord handle, which is how access is actually granted. */
  discord: string;
  email: string;
  /** The community, station or event they are asking on behalf of. */
  community: string;
  /** Rough size, in their own words. Free text because "about 400" is an answer. */
  size: string;
  note: string;
  at: number;
}

/** One rig, as the platform knows it. */
export interface GuildRecord {
  id: string;
  /** What appears in the URL: /g/<slug>/deck */
  slug: string;
  name: string;
  createdAt: number;
  createdBy: string;
  status: 'active' | 'suspended';
  djRoleIds: string[];
  adminRoleIds: string[];
}

export const DEFAULT_MIXER: MixerState = {
  crossfader: 0,
  crossfaderCurve: 0,
  master: 1,
  balance: 0,
  mono: false,
  limiter: true,
  masterEq: { low: 0, mid: 0, high: 0 },
  padBus: 0.9,
  padDuck: 0.25,
  fx: { type: 'echo', mix: 0, timeMs: 375, feedback: 0.35, tone: 0.6 },
};

/**
 * Every tool that opens a port or reaches out to the network starts off. The
 * channel caption is the exception: it writes to the channel the rig is
 * already playing into and nowhere else, so it is on unless someone says not.
 */
export const DEFAULT_TOOLS: ToolsState = {
  timecode: false,
  timecodeKey: '',
  urlImport: false,
  osc: false,
  oscHost: '127.0.0.1',
  oscPort: 9000,
  channelStatus: true,
  channelStatusText: '',
  presence: false,
  announce: false,
  announceWebhook: '',
  requests: false,
};

export function defaultPads(): PersistedPad[] {
  return Array.from({ length: 8 }, () => ({
    mediaId: null,
    gain: 0.9,
    mode: 'oneshot' as PadMode,
  }));
}

/** The mutable state of one rig, in the shape the engine works with. */
interface GuildData {
  media: Record<string, MediaItem>;
  mixer: MixerState;
  tools: ToolsState;
  pads: PersistedPad[];
  lastVoiceChannelId: string | null;
  queue: QueueState;
  /** Newest first, which is the order the booth reads them in. */
  requests: RequestItem[];
  activeBotId: string | null;
}

/**
 * One guild's slice of the database, mirrored in memory.
 *
 * In memory because the audio path reads it: the engine asks for the mixer
 * state and a media item's title while rendering, and a query there would be a
 * disk read inside a 20 ms budget. Writes go the other way — through here, then
 * to SQLite on a debounce, so a knob dragged across its travel is one write and
 * not eighty.
 */
export class GuildStore {
  private data: GuildData = {
    media: {},
    mixer: { ...DEFAULT_MIXER },
    tools: { ...DEFAULT_TOOLS },
    pads: defaultPads(),
    lastVoiceChannelId: null,
    queue: { items: [], auto: false },
    requests: [],
    activeBotId: null,
  };

  /** Media ids touched since the last write. Rewriting 500 rows to change one title would not do. */
  private dirtyMedia = new Set<string>();
  private removedMedia = new Set<string>();
  private queueDirty = false;
  private requestsDirty = false;
  private padsDirty = false;
  private guildDirty = false;

  private writeQueued = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(readonly guildId: string) {}

  get db(): GuildData {
    return this.data;
  }

  /* ----------------------------------------------------------------- load */

  load(): void {
    const database = db();

    const row = database
      .prepare(
        `SELECT mixer, tools, queue_auto, last_voice_channel_id, active_bot_id
         FROM guilds WHERE id = ?`,
      )
      .get(this.guildId) as
      | {
          mixer: string;
          tools: string;
          queue_auto: number;
          last_voice_channel_id: string | null;
          active_bot_id: string | null;
        }
      | undefined;

    if (row) {
      // Merged over the defaults one level deep, so a database written before
      // the master EQ or the effects bus existed gains them at their defaults
      // rather than as undefined knobs the audio thread would read as NaN.
      const mixer = safeParse<Partial<MixerState>>(row.mixer, {});
      this.data.mixer = {
        ...DEFAULT_MIXER,
        ...mixer,
        masterEq: { ...DEFAULT_MIXER.masterEq, ...(mixer.masterEq ?? {}) },
        fx: { ...DEFAULT_MIXER.fx, ...(mixer.fx ?? {}) },
      };
      this.data.tools = { ...DEFAULT_TOOLS, ...safeParse<Partial<ToolsState>>(row.tools, {}) };
      this.data.queue.auto = row.queue_auto === 1;
      this.data.lastVoiceChannelId = row.last_voice_channel_id;
      this.data.activeBotId = row.active_bot_id;
    }

    const mediaRows = database
      .prepare('SELECT data FROM media WHERE guild_id = ?')
      .all(this.guildId) as Array<{ data: string }>;
    this.data.media = {};
    for (const media of mediaRows) {
      const item = safeParse<MediaItem | null>(media.data, null);
      if (!item?.id) continue;
      // Written before these existed, and `JSON.stringify` drops `undefined` —
      // so without this the web side sees a property that is not there rather
      // than one that is null.
      if (item.beatGrid === undefined) item.beatGrid = null;
      if (item.key === undefined) item.key = null;
      this.data.media[item.id] = item;
    }

    const queueRows = database
      .prepare('SELECT data FROM queue WHERE guild_id = ? ORDER BY position')
      .all(this.guildId) as Array<{ data: string }>;
    this.data.queue.items = queueRows
      .map((q) => safeParse<QueueItem | null>(q.data, null))
      .filter((entry): entry is QueueItem => Boolean(entry?.mediaId));

    const requestRows = database
      .prepare('SELECT data FROM requests WHERE guild_id = ? ORDER BY at DESC')
      .all(this.guildId) as Array<{ data: string }>;
    this.data.requests = requestRows
      .map((r) => safeParse<RequestItem | null>(r.data, null))
      .filter((entry): entry is RequestItem => Boolean(entry?.id));

    const padRows = database
      .prepare('SELECT idx, media_id, gain, mode FROM pads WHERE guild_id = ? ORDER BY idx')
      .all(this.guildId) as Array<{
      idx: number;
      media_id: string | null;
      gain: number;
      mode: string;
    }>;
    const pads = defaultPads();
    for (const pad of padRows) {
      if (pad.idx < 0 || pad.idx >= pads.length) continue;
      pads[pad.idx] = {
        mediaId: pad.media_id,
        gain: pad.gain,
        mode: pad.mode as PadMode,
      };
    }
    this.data.pads = pads;

    log.info(`${this.guildId}: ${Object.keys(this.data.media).length} media items`);
  }

  /* ---------------------------------------------------------------- media */

  listMedia(): MediaItem[] {
    return Object.values(this.data.media).sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  getMedia(id: string): MediaItem | undefined {
    return this.data.media[id];
  }

  putMedia(item: MediaItem): void {
    this.data.media[item.id] = item;
    this.dirtyMedia.add(item.id);
    this.removedMedia.delete(item.id);
    this.save();
  }

  removeMedia(id: string): void {
    delete this.data.media[id];
    this.dirtyMedia.delete(id);
    this.removedMedia.add(id);
    this.save();
  }

  /* ----------------------------------------------------------------- save */

  /** Reads as intent at the call site; `save` already covers all of them. */
  markGuild(): void {
    this.save();
  }

  /**
   * Debounced write.
   *
   * Everything that is not media is cheap to write and hard to track precisely
   * — the mixer is one row, the queue is a handful — so a change to any of them
   * marks the lot. Media is the exception, because a library is hundreds of rows
   * carrying a waveform envelope each, and rewriting all of it to rename one
   * track is the kind of thing that is fine until it is not.
   */
  save(): void {
    // Everything cheap is marked together. The queue is a handful of rows and
    // the pads are eight; tracking which of them a caller touched would be a
    // correctness problem waiting to happen — a missed mark is a set that comes
    // back wrong after a restart — in exchange for saving a few hundred bytes.
    this.guildDirty = true;
    this.queueDirty = true;
    this.requestsDirty = true;
    this.padsDirty = true;
    if (this.writeQueued) return;
    this.writeQueued = true;
    setTimeout(() => {
      this.writeQueued = false;
      this.writing = this.writing.then(() => this.flush()).catch(() => undefined);
    }, 250);
  }

  async flush(): Promise<void> {
    const database = db();
    const {
      media,
      mixer,
      tools,
      pads,
      queue,
      requests,
      lastVoiceChannelId,
      activeBotId,
    } = this.data;

    const dirty = [...this.dirtyMedia];
    const removed = [...this.removedMedia];
    const writeQueue = this.queueDirty;
    const writeRequests = this.requestsDirty;
    const writePads = this.padsDirty;
    const writeGuild = this.guildDirty;
    this.dirtyMedia.clear();
    this.removedMedia.clear();
    this.queueDirty = false;
    this.requestsDirty = false;
    this.padsDirty = false;
    this.guildDirty = false;

    try {
      database.exec('BEGIN');

      if (writeGuild) {
        database
          .prepare(
            `UPDATE guilds SET mixer = ?, tools = ?, queue_auto = ?,
                    last_voice_channel_id = ?, active_bot_id = ?
             WHERE id = ?`,
          )
          .run(
            JSON.stringify(mixer),
            JSON.stringify(tools),
            queue.auto ? 1 : 0,
            lastVoiceChannelId,
            activeBotId,
            this.guildId,
          );
      }

      if (dirty.length > 0) {
        const upsert = database.prepare(
          `INSERT INTO media (id, guild_id, uploaded_at, data) VALUES (?, ?, ?, ?)
           ON CONFLICT(guild_id, id) DO UPDATE SET uploaded_at = excluded.uploaded_at,
                                                   data = excluded.data`,
        );
        for (const id of dirty) {
          const item = media[id];
          if (!item) continue;
          upsert.run(id, this.guildId, item.uploadedAt, JSON.stringify(item));
        }
      }

      if (removed.length > 0) {
        const drop = database.prepare('DELETE FROM media WHERE guild_id = ? AND id = ?');
        for (const id of removed) drop.run(this.guildId, id);
      }

      if (writeQueue) {
        database.prepare('DELETE FROM queue WHERE guild_id = ?').run(this.guildId);
        const insert = database.prepare(
          'INSERT INTO queue (id, guild_id, position, data) VALUES (?, ?, ?, ?)',
        );
        queue.items.forEach((entry, index) => {
          insert.run(entry.id, this.guildId, index, JSON.stringify(entry));
        });
      }

      if (writeRequests) {
        database.prepare('DELETE FROM requests WHERE guild_id = ?').run(this.guildId);
        const insert = database.prepare(
          'INSERT INTO requests (id, guild_id, at, data) VALUES (?, ?, ?, ?)',
        );
        for (const entry of requests) {
          insert.run(entry.id, this.guildId, entry.at, JSON.stringify(entry));
        }
      }

      if (writePads) {
        const upsert = database.prepare(
          `INSERT INTO pads (guild_id, idx, media_id, gain, mode) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(guild_id, idx) DO UPDATE SET media_id = excluded.media_id,
                                                    gain = excluded.gain,
                                                    mode = excluded.mode`,
        );
        pads.forEach((pad, index) => {
          upsert.run(this.guildId, index, pad.mediaId, pad.gain, pad.mode);
        });
      }

      database.exec('COMMIT');
    } catch (err) {
      try {
        database.exec('ROLLBACK');
      } catch {
        /* nothing open */
      }
      log.error(`failed to persist ${this.guildId}:`, (err as Error).message);
    }
  }
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
