import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { createLogger } from './logger';
import type { MediaItem, MixerState, PadMode, ToolsState } from './protocol';

const log = createLogger('store');

export interface PersistedPad {
  mediaId: string | null;
  gain: number;
  mode: PadMode;
}

/**
 * A playback bot an owner added from the console. The token is sealed (see
 * secrets.ts) so a stolen copy of this file is not a usable Discord account.
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

export interface PersistedDb {
  version: 1;
  media: Record<string, MediaItem>;
  mixer: MixerState;
  tools: ToolsState;
  pads: PersistedPad[];
  lastVoiceChannelId: string | null;
  bots: PersistedBot[];
  /** Which bot to play through. Null means the one from the environment. */
  activeBotId: string | null;
}

const DEFAULT_MIXER: MixerState = {
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

/** Every tool starts off: each one opens a port or reaches out to the network. */
const DEFAULT_TOOLS: ToolsState = {
  timecode: false,
  timecodeKey: '',
  urlImport: false,
  osc: false,
  oscHost: '127.0.0.1',
  oscPort: 9000,
};

function defaults(): PersistedDb {
  return {
    version: 1,
    media: {},
    mixer: { ...DEFAULT_MIXER },
    tools: { ...DEFAULT_TOOLS },
    pads: Array.from({ length: 8 }, () => ({ mediaId: null, gain: 0.9, mode: 'oneshot' as PadMode })),
    lastVoiceChannelId: null,
    bots: [],
    activeBotId: null,
  };
}

/**
 * Tiny JSON document store. The whole document is a few hundred KB at most
 * (peak envelopes dominate), so rewriting it on change is cheaper than pulling
 * in a database and a native build step.
 */
class Store {
  private data: PersistedDb = defaults();
  private writeQueued = false;
  private writing: Promise<void> = Promise.resolve();

  load(): void {
    try {
      const raw = fs.readFileSync(config.paths.dbFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedDb;
      this.data = { ...defaults(), ...parsed };
      // Nested sections are merged one level deep too, so a database written
      // before the master EQ or the effects bus existed gains them at default
      // rather than as undefined knobs the audio thread would read as NaN.
      this.data.mixer = {
        ...DEFAULT_MIXER,
        ...(parsed.mixer ?? {}),
        masterEq: { ...DEFAULT_MIXER.masterEq, ...(parsed.mixer?.masterEq ?? {}) },
        fx: { ...DEFAULT_MIXER.fx, ...(parsed.mixer?.fx ?? {}) },
      };
      // Merged over the defaults so a database written before a tool existed
      // gains it switched off rather than undefined.
      this.data.tools = { ...DEFAULT_TOOLS, ...(parsed.tools ?? {}) };
      if (!Array.isArray(this.data.pads) || this.data.pads.length !== 8) {
        this.data.pads = defaults().pads;
      }
      if (!Array.isArray(this.data.bots)) this.data.bots = [];
      log.info(`loaded ${Object.keys(this.data.media).length} media items`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        log.warn('could not read db, starting fresh:', (err as Error).message);
      }
      this.data = defaults();
    }
  }

  get db(): PersistedDb {
    return this.data;
  }

  listMedia(): MediaItem[] {
    return Object.values(this.data.media).sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  getMedia(id: string): MediaItem | undefined {
    return this.data.media[id];
  }

  putMedia(item: MediaItem): void {
    this.data.media[item.id] = item;
    this.save();
  }

  removeMedia(id: string): void {
    delete this.data.media[id];
    this.save();
  }

  /** Debounced atomic write. Multiple mutations in a tick collapse into one. */
  save(): void {
    if (this.writeQueued) return;
    this.writeQueued = true;
    setTimeout(() => {
      this.writeQueued = false;
      this.writing = this.writing.then(() => this.flush()).catch(() => undefined);
    }, 250);
  }

  async flush(): Promise<void> {
    const tmp = path.join(config.paths.tmpDir, `db-${process.pid}.json`);
    try {
      await fsp.writeFile(tmp, JSON.stringify(this.data), 'utf8');
      await fsp.rename(tmp, config.paths.dbFile);
    } catch (err) {
      log.error('failed to persist db:', (err as Error).message);
    }
  }
}

export const store = new Store();
