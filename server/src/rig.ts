import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Mixer } from './audio/mixer';
import { HostSession, type HostTrack } from './audio/hostSession';
import { FileWindowReader, type WindowReader } from './audio/windowReader';
import { VoiceManager } from './discord/voice';
import { ControlLock } from './control';
import { Bot, type BotCredentials } from './discord/bot';
import { BotRegistry } from './discord/bots';
import type { GuildStore } from './store';
import { config } from './config';
import { createLogger } from './logger';
import { decodeQueue, decodeToPcm, probeTitle } from './audio/transcode';
import { commandSchemas, isCommand, NEEDS_CONTROL, type CommandKey } from './schemas';
import type { Deck } from './audio/deck';
import type { Pad } from './audio/pad';
import {
  DECK_IDS,
  PAD_COUNT,
  QUEUE_LIMIT,
  SAMPLE_RATE,
  type DeckId,
  type EngineState,
  type MediaItem,
  type PresenceUser,
  type SessionUser,
  type Toast,
  type ToolsState,
  type VoiceChannelInfo,
} from './protocol';
import { analyseBeats } from './audio/beatgrid';
import { OscSender } from './tools/osc';
import { NowPlaying } from './tools/nowPlaying';

const log = createLogger('engine');

export class CommandError extends Error {}

interface Presence {
  user: SessionUser;
  sockets: number;
  lastSeen: number;
}

/**
 * Application core. Everything the control surface can do funnels through
 * `execute`, which is the single place permissions, validation and state
 * broadcasting are enforced — the Discord slash commands use the same path.
 */
/**
 * How long the rig keeps playing after the hosting device drops before it gives
 * up and pauses.
 *
 * Comfortably inside the eight seconds of audio the ring already holds, so the
 * decision is made while there is still sound coming out. Socket.io reconnects
 * on its own within a second or two, and pausing the moment a tab's connection
 * hiccups would stop the music for something nobody would otherwise have heard.
 */
const HOST_GRACE_MS = 6000;

export class Rig extends EventEmitter {
  readonly mixer = new Mixer();
  readonly control = new ControlLock();
  readonly host = new HostSession();
  readonly bot: Bot;
  readonly voice: VoiceManager;
  readonly bots: BotRegistry;
  private readonly osc = new OscSender();
  private readonly nowPlaying: NowPlaying;

  private presence = new Map<string, Presence>();
  private channels: VoiceChannelInfo[] = [];
  private rev = 0;
  private channelTimer: NodeJS.Timeout | null = null;
  private hostGrace: NodeJS.Timeout | null = null;

  constructor(
    readonly guildId: string,
    readonly store: GuildStore,
  ) {
    super();
    this.bot = new Bot(guildId);
    this.voice = new VoiceManager(this.mixer, this.bot, () => this.store.db.tools);
    this.nowPlaying = new NowPlaying(this.bot);
    this.bots = new BotRegistry(guildId, this.bot, store, {
      resumeChannelId: () => this.voice.snapshot().channelId,
      leaveVoice: () => this.voice.leave(),
      joinVoice: (channelId) => this.voice.join(channelId),
      registerCommands: () => registerCommandsFor(this),
      clearCommands: (identity) => clearCommandsFor({ ...identity, guildId }),
      onChange: () => {
        void this.refreshChannels();
        this.bumpState();
      },
    });
    this.mixer.on('trackEnded', (deck) => {
      // The queue gets first refusal on a deck that has just run out. Only
      // then is it worth telling anyone the track ended, because with
      // auto-advance on the answer is "and here is the next one".
      if (!this.advanceQueue(deck)) {
        this.toast('info', `Deck ${deck} reached the end of the track.`);
      }
      this.bumpState();
    });
    this.control.on('change', () => this.bumpState());
    this.control.on('timeout', (_id: string, name: string) =>
      this.toast('warn', `${name} timed out — control passed on.`),
    );
    this.voice.on('change', () => this.bumpState());

    // Losing the host does not stop the audio — the ring is still full and the
    // decks play on out of it. What it starts is a clock: if nobody is serving
    // by the time that runs out, the set is paused where it actually stopped
    // rather than left to run silently on through the rest of the track.
    this.host.on('lost', () => {
      this.toast('warn', 'The device hosting this library dropped — playing from the buffer.');
      if (this.hostGrace) clearTimeout(this.hostGrace);
      this.hostGrace = setTimeout(() => {
        this.hostGrace = null;
        if (this.host.hosted) return;
        const running = DECK_IDS.filter((id) => this.mixer.decks[id].playing);
        for (const id of running) this.mixer.decks[id].pause();
        if (running.length > 0) {
          this.toast('error', 'Nobody is hosting the library — playback paused.');
        }
        this.bumpState();
      }, HOST_GRACE_MS);
      this.hostGrace.unref?.();
    });
    this.host.on('gained', () => {
      if (this.hostGrace) clearTimeout(this.hostGrace);
      this.hostGrace = null;
    });
    this.host.on('change', () => this.bumpState());
  }

  async start(): Promise<void> {
    this.store.load();
    await this.bots.start();
    this.restorePersisted();
    // Tools are persisted, so one left on survives a restart.
    this.syncOsc();
    this.syncNowPlaying();
    await this.refreshChannels();
    this.channelTimer = setInterval(() => {
      void this.refreshChannels();
    }, 15_000);
    this.channelTimer.unref?.();
    this.bot.onClient((client) => {
      client.on('voiceStateUpdate', () => {
        void this.refreshChannels();
      });
    });
  }

  // ---------------------------------------------------------------- state ---

  state(): EngineState {
    return {
      decks: { A: this.mixer.decks.A.snapshot(), B: this.mixer.decks.B.snapshot() },
      pads: this.mixer.pads.map((p) => p.snapshot()),
      queue: { items: [...this.store.db.queue.items], auto: this.store.db.queue.auto },
      mixer: this.mixer.mixerSnapshot(),
      tools: { ...this.store.db.tools },
      bot: this.bots.active(),
      voice: this.voice.snapshot(),
      control: this.control.snapshot(),
      host: this.host.snapshot(),
      users: this.presenceList(),
      channels: this.channels,
      rev: this.rev,
      serverTime: Date.now(),
    };
  }

  private presenceList(): PresenceUser[] {
    return [...this.presence.values()]
      .map((p) => ({
        id: p.user.id,
        name: p.user.displayName,
        avatarUrl: p.user.avatarUrl,
        isAdmin: p.user.isAdmin,
        connections: p.sockets,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private bumpState(): void {
    this.rev++;
    this.emit('state', this.state());
  }

  private toast(level: Toast['level'], message: string, userId?: string): void {
    this.emit('toast', { level, message } satisfies Toast, userId);
  }

  private async refreshChannels(): Promise<void> {
    try {
      const next = await this.bot.voiceChannels();
      if (JSON.stringify(next) !== JSON.stringify(this.channels)) {
        this.channels = next;
        this.bumpState();
      }
    } catch (err) {
      log.debug('channel refresh failed:', (err as Error).message);
    }
  }

  // ------------------------------------------------------------- presence ---

  attach(user: SessionUser): void {
    const existing = this.presence.get(user.id);
    if (existing) {
      existing.sockets++;
      existing.user = user;
      existing.lastSeen = Date.now();
    } else {
      this.presence.set(user.id, { user, sockets: 1, lastSeen: Date.now() });
    }
    this.control.onUserConnected(user.id);
    this.bumpState();
  }

  detach(userId: string): void {
    const existing = this.presence.get(userId);
    if (!existing) return;
    existing.sockets--;
    if (existing.sockets <= 0) {
      this.presence.delete(userId);
      this.control.onUserDisconnected(userId);
    }
    this.bumpState();
  }

  // -------------------------------------------------------------- command ---

  async execute(user: SessionUser, name: string, rawPayload: unknown): Promise<void> {
    if (!isCommand(name)) throw new CommandError(`Unknown command "${name}".`);
    const parsed = commandSchemas[name].safeParse(rawPayload ?? {});
    if (!parsed.success) {
      throw new CommandError(parsed.error.issues[0]?.message ?? 'Invalid command payload.');
    }

    if (NEEDS_CONTROL.has(name) && !this.control.has(user.id)) {
      const holder = this.control.snapshot().holderName;
      throw new CommandError(
        holder ? `${holder} currently has control.` : 'Take control before touching the decks.',
      );
    }

    await this.run(user, name, parsed.data as never);

    if (NEEDS_CONTROL.has(name)) this.control.touch(user.id);
    this.bumpState();
  }

  // ----------------------------------------------------------------- tools ---

  /**
   * Applies a tools patch and brings the side effects in line with it. The
   * timecode key is rotated whenever the endpoint is switched on, so revoking
   * access is just a matter of turning it off and on again.
   */
  private applyTools(patch: Partial<ToolsState>, user: SessionUser): void {
    const before = { ...this.store.db.tools };
    const next: ToolsState = { ...before, ...patch };

    if (next.timecode && !before.timecode) {
      next.timecodeKey = crypto.randomUUID().replace(/-/g, '');
      this.toast('info', `${user.displayName} switched the timecode feed on.`);
    }
    if (!next.timecode && before.timecode) next.timecodeKey = '';

    this.store.db.tools = next;
    this.store.save();
    this.syncOsc();
    this.syncNowPlaying();
    // The caption is written once at join, so a change to the wording while
    // the rig is already in a channel has to be pushed rather than waited for.
    if (
      next.channelStatus !== before.channelStatus ||
      next.channelStatusText !== before.channelStatusText
    ) {
      this.voice.refreshChannelStatus();
    }
  }

  /** Starts, stops or repoints the OSC sender to match the stored settings. */
  syncOsc(): void {
    const tools = this.store.db.tools;
    if (tools.osc) this.osc.start(() => this.state(), tools.oscHost, tools.oscPort);
    else this.osc.stop();
  }

  /** Points the now-playing watcher at whichever of its two tools are on. */
  syncNowPlaying(): void {
    const tools = this.store.db.tools;
    this.nowPlaying.configure({
      presence: tools.presence,
      webhook: tools.announce && tools.announceWebhook ? tools.announceWebhook : null,
      snapshot: () => this.state(),
    });
  }

  // ----------------------------------------------------------------- queue ---

  /**
   * Takes the next playable track off the queue and puts it on a deck.
   *
   * Entries whose media has gone — deleted, or still failing to decode — are
   * dropped as they are reached rather than jamming the queue behind something
   * that will never play.
   */
  private loadNext(deck: DeckId, play: boolean): MediaItem | null {
    const queue = this.store.db.queue;
    while (queue.items.length > 0) {
      const [entry] = queue.items.splice(0, 1);
      const item = this.store.getMedia(entry.mediaId);
      if (!item || item.status !== 'ready') continue;
      this.mixer.decks[deck].load({
        mediaId: item.id,
        title: item.title,
        reader: this.makeReader(item.id, `deck:${deck}`),
        bpm: item.bpm,
      });
      if (play) this.mixer.decks[deck].play();
      this.store.save();
      return item;
    }
    this.store.save();
    return null;
  }

  /** Auto-advance. Returns true if the queue filled the deck. */
  private advanceQueue(deck: DeckId): boolean {
    if (!this.store.db.queue.auto || this.store.db.queue.items.length === 0) return false;
    const item = this.loadNext(deck, true);
    if (!item) return false;
    this.toast('info', `Deck ${deck}: "${item.title}" from the queue.`);
    return true;
  }

  /**
   * The waveform envelope for a track, computed on the device as it decoded.
   *
   * The frame count that comes with it is the decoder's, which supersedes the
   * estimate the scan read off file metadata — approximate for anything
   * variable-bitrate, and the difference is audible at the end of a track.
   */
  registerPeaks(trackId: string, peaks: number[], frames: number): void {
    const item = this.store.getMedia(trackId);
    if (!item) return;
    item.peaks = peaks;
    if (frames > 0) item.durationMs = Math.round((frames / SAMPLE_RATE) * 1000);
    this.store.putMedia(item);
    this.syncTitles(item);
    this.emitMedia();
  }

  /**
   * Brings the pool in line with what the hosting device can actually serve.
   *
   * The device is authoritative about which files exist; the server is
   * authoritative about everything anybody has decided about them — the tempo
   * somebody tapped, the beat grid, the tags. So a scan updates the first and
   * never touches the second, and a track that has dropped out of the folder is
   * marked missing rather than removed. Unplugging a drive should not throw away
   * a set's worth of cue points.
   */
  syncLibrary(tracks: HostTrack[]): void {
    const seen = new Set<string>();

    for (const track of tracks) {
      seen.add(track.trackId);
      const existing = this.store.getMedia(track.trackId);
      const durationMs = Math.round((track.frames / SAMPLE_RATE) * 1000);

      if (existing) {
        existing.status = 'ready';
        existing.durationMs = durationMs;
        existing.sizeBytes = track.sizeBytes;
        existing.originalName = track.path;
        delete existing.error;
        // The title is left alone: a rename on the console is a decision, and
        // the file name is only ever where the first guess came from.
        this.store.putMedia(existing);
        continue;
      }

      this.store.putMedia({
        id: track.trackId,
        title: track.title,
        originalName: track.path,
        durationMs,
        sizeBytes: track.sizeBytes,
        uploadedBy: { id: this.host.snapshot().userId ?? '', name: this.host.snapshot().userName ?? 'library' },
        uploadedAt: Date.now(),
        peaks: [],
        bpm: null,
        beatGrid: null,
        key: null,
        tags: [],
        status: 'ready',
      });
    }

    // Anything the scan did not mention is out of reach for now. Legacy tracks
    // that still have a decoded file on disk are exempt — they play without a
    // host at all, and calling them missing would be plainly wrong.
    for (const item of this.store.listMedia()) {
      if (seen.has(item.id) || item.status === 'missing') continue;
      if (fs.existsSync(pcmPath(item.id))) continue;
      item.status = 'missing';
      this.store.putMedia(item);
    }

    this.emitMedia();
    this.bumpState();
  }

  /**
   * Where a track's audio comes from.
   *
   * A file decoded to disk by an older version of the rig still plays from
   * there, so an existing library keeps working untouched rather than needing a
   * migration or a re-import. Everything else is served by whichever device is
   * hosting, over the socket.
   */
  private makeReader(mediaId: string, sourceKey: string): WindowReader {
    const legacy = pcmPath(mediaId);
    if (fs.existsSync(legacy)) {
      this.host.drop(sourceKey);
      return new FileWindowReader(legacy);
    }

    const reader = this.host.reader(sourceKey, mediaId);
    if (reader) return reader;

    throw new CommandError(
      this.host.hosted
        ? 'That track is not in the music folder being hosted - rescan it and try again.'
        : 'No device is hosting this library. Open the console and connect your music folder.',
    );
  }

  /** Payloads are already schema-validated, so these lookups cannot miss. */
  private deckOf(payload: { deck: DeckId }): Deck {
    return this.mixer.decks[payload.deck];
  }

  private padOf(payload: { index: number }): Pad {
    return this.mixer.pads[payload.index];
  }

  private async run(user: SessionUser, name: CommandKey, payload: any): Promise<void> {
    switch (name) {
      // ---- decks -------------------------------------------------------
      case 'deck:load': {
        const item = this.readyMedia(payload.mediaId);
        this.deckOf(payload).load({
          mediaId: item.id,
          title: item.title,
          reader: this.makeReader(item.id, `deck:${payload.deck}`),
          bpm: item.bpm,
        });
        this.toast('success', `Loaded "${item.title}" onto deck ${payload.deck}.`);
        return;
      }
      case 'deck:eject':
        this.deckOf(payload).eject();
        this.host.drop(`deck:${payload.deck}`);
        return;
      case 'deck:play':
        if (!this.deckOf(payload).loaded) {
          throw new CommandError(`Deck ${payload.deck} is empty.`);
        }
        this.deckOf(payload).play();
        return;
      case 'deck:pause':
        this.deckOf(payload).pause();
        return;
      case 'deck:cue':
        this.deckOf(payload).cue();
        return;
      case 'deck:setCue':
        this.deckOf(payload).setCue(payload.ms);
        return;
      case 'deck:seek':
        this.deckOf(payload).seekMs(payload.ms);
        return;
      case 'deck:nudge':
        this.deckOf(payload).nudgeMs(payload.deltaMs);
        return;
      case 'deck:set':
        this.deckOf(payload).applySettings(payload);
        return;
      case 'deck:loop':
        this.deckOf(payload).setLoop(payload.active, payload.startMs, payload.endMs);
        return;

      // ---- queue -------------------------------------------------------
      case 'queue:add': {
        const item = this.readyMedia(payload.mediaId);
        const queue = this.store.db.queue;
        if (queue.items.length >= QUEUE_LIMIT) {
          throw new CommandError(`The queue is full (${QUEUE_LIMIT} tracks).`);
        }
        const entry = {
          id: crypto.randomUUID(),
          mediaId: item.id,
          addedBy: { id: user.id, name: user.displayName },
          addedAt: Date.now(),
        };
        // "Play next" jumps the whole queue, so it is worth saying out loud.
        if (payload.next) queue.items.unshift(entry);
        else queue.items.push(entry);
        this.store.save();
        this.toast(
          'success',
          payload.next
            ? `"${item.title}" is up next.`
            : `"${item.title}" queued — ${queue.items.length} in the queue.`,
        );
        return;
      }
      case 'queue:remove': {
        const queue = this.store.db.queue;
        const index = queue.items.findIndex((entry) => entry.id === payload.id);
        if (index < 0) return;
        const entry = queue.items[index];
        // Your own entry is yours to pull. Anyone else's needs the decks or
        // admin — the same shape as editing somebody's upload.
        const mine = entry.addedBy.id === user.id;
        if (!mine && !user.isAdmin && !this.control.has(user.id)) {
          throw new CommandError('Take control to remove somebody else\'s track.');
        }
        queue.items.splice(index, 1);
        this.store.save();
        return;
      }
      case 'queue:move': {
        const queue = this.store.db.queue;
        const from = queue.items.findIndex((entry) => entry.id === payload.id);
        if (from < 0) return;
        const to = Math.max(0, Math.min(queue.items.length - 1, payload.to));
        if (to === from) return;
        const [entry] = queue.items.splice(from, 1);
        queue.items.splice(to, 0, entry);
        this.store.save();
        return;
      }
      case 'queue:clear':
        this.store.db.queue.items = [];
        this.store.save();
        this.toast('info', `${user.displayName} cleared the queue.`);
        return;
      case 'queue:load': {
        if (this.store.db.queue.items.length === 0) throw new CommandError('The queue is empty.');
        const item = this.loadNext(payload.deck, payload.play ?? false);
        if (!item) throw new CommandError('Nothing in the queue could be loaded.');
        this.toast('success', `Loaded "${item.title}" onto deck ${payload.deck}.`);
        return;
      }
      case 'queue:set':
        this.store.db.queue.auto = payload.auto;
        this.store.save();
        return;

      // ---- pads --------------------------------------------------------
      case 'pad:assign': {
        const pad = this.padOf(payload);
        if (payload.mediaId === null) {
          pad.clear();
          this.host.drop(`pad:${payload.index}`);
        } else {
          const item = this.readyMedia(payload.mediaId);
          pad.assign(item.id, item.title, this.makeReader(item.id, `pad:${payload.index}`));
        }
        this.persistPads();
        return;
      }
      case 'pad:trigger':
        this.padOf(payload).trigger();
        return;
      case 'pad:stop':
        this.padOf(payload).stop();
        return;
      case 'pad:set':
        this.padOf(payload).set(payload);
        this.persistPads();
        return;

      // ---- mixer -------------------------------------------------------
      case 'mixer:set':
        this.mixer.applyMixer(payload);
        this.store.db.mixer = this.mixer.mixerSnapshot();
        this.store.save();
        return;

      // ---- tools -------------------------------------------------------
      case 'tools:set':
        this.applyTools(payload, user);
        return;

      // ---- voice -------------------------------------------------------
      case 'voice:join':
        await this.voice.join(payload.channelId);
        this.store.db.lastVoiceChannelId = payload.channelId;
        this.store.save();
        return;
      case 'voice:leave':
        this.voice.leave();
        return;

      // ---- media -------------------------------------------------------
      case 'media:analyse': {
        const item = this.store.getMedia(payload.id);
        if (!item) throw new CommandError('That track is no longer in the pool.');
        if (!user.isAdmin && item.uploadedBy.id !== user.id) {
          throw new CommandError('Only the uploader or an admin can re-analyse that track.');
        }
        if (item.status !== 'ready') throw new CommandError('That track is still being decoded.');
        // Not awaited: analysis takes seconds and the command should not hold
        // the socket open for it. The pool is told again when it lands.
        void decodeQueue.add(async () => {
          await this.analyse(item);
          if (!item.beatGrid) {
            this.toast('warn', `No beat grid found for "${item.title}".`, user.id);
          }
        });
        this.toast('info', `Analysing "${item.title}"...`, user.id);
        return;
      }

      case 'media:update': {
        const item = this.store.getMedia(payload.id);
        if (!item) throw new CommandError('That track is no longer in the pool.');
        if (!user.isAdmin && item.uploadedBy.id !== user.id) {
          throw new CommandError('Only the uploader or an admin can edit that track.');
        }
        if (payload.title !== undefined) item.title = payload.title;
        if (payload.bpm !== undefined) item.bpm = payload.bpm;
        if (payload.tags !== undefined) item.tags = payload.tags;
        this.store.putMedia(item);
        this.syncTitles(item);
        this.emitMedia();
        return;
      }
      case 'media:delete': {
        const item = this.store.getMedia(payload.id);
        if (!item) return;
        if (!user.isAdmin && item.uploadedBy.id !== user.id) {
          throw new CommandError('Only the uploader or an admin can delete that track.');
        }
        await this.deleteMedia(item);
        this.toast('info', `Removed "${item.title}" from the pool.`);
        return;
      }

      // ---- control -----------------------------------------------------
      case 'control:request': {
        const outcome = this.control.request(user);
        if (outcome === 'granted') this.toast('success', `${user.displayName} took control.`);
        else if (outcome === 'queued') {
          this.toast('info', `${user.displayName} is waiting for control.`);
        }
        return;
      }
      case 'control:release':
        if (!this.control.release(user.id)) throw new CommandError('You do not have control.');
        return;
      case 'control:cancel':
        this.control.cancel(user.id);
        return;
      case 'control:take':
        if (!user.isAdmin) throw new CommandError('Only admins can force-take control.');
        this.control.take(user);
        this.toast('warn', `${user.displayName} force-took control.`);
        return;
      case 'control:grant': {
        const isHolder = this.control.has(user.id);
        if (!isHolder && !user.isAdmin) {
          throw new CommandError('Only the current controller or an admin can hand over control.');
        }
        const target = this.presence.get(payload.userId);
        if (!target) throw new CommandError('That DJ is not connected.');
        this.control.grant({ id: target.user.id, name: target.user.displayName });
        this.toast('success', `${target.user.displayName} now has control.`);
        return;
      }
      case 'control:heartbeat':
        this.control.touch(user.id);
        return;

      default: {
        const never: never = name;
        throw new CommandError(`Unhandled command ${String(never)}.`);
      }
    }
  }

  private readyMedia(id: string): MediaItem {
    const item = this.store.getMedia(id);
    if (!item) throw new CommandError('That track is not in the pool.');
    if (item.status === 'missing') {
      throw new CommandError(`"${item.title}" is not in the hosted folder right now.`);
    }
    if (item.status !== 'ready') throw new CommandError(`"${item.title}" is still processing.`);
    return item;
  }

  // ---------------------------------------------------------------- media ---

  emitMedia(): void {
    this.emit('media', this.store.listMedia());
  }

  /**
   * Ingest an uploaded file: decode to raw PCM once, build the waveform
   * envelope, then publish it to the pool.
   */
  async ingest(params: {
    tempPath: string;
    originalName: string;
    sizeBytes: number;
    user: SessionUser;
  }): Promise<MediaItem> {
    const id = crypto.randomUUID();
    const ext = path.extname(params.originalName).slice(0, 12) || '.bin';
    const storedPath = path.join(config.paths.mediaDir, `${id}${ext}`);
    await fsp.rename(params.tempPath, storedPath).catch(async () => {
      await fsp.copyFile(params.tempPath, storedPath);
      await fsp.unlink(params.tempPath).catch(() => undefined);
    });

    const fallbackName = path.basename(params.originalName, path.extname(params.originalName));
    const item: MediaItem = {
      id,
      title: fallbackName.slice(0, 120) || 'Untitled',
      originalName: params.originalName,
      durationMs: 0,
      sizeBytes: params.sizeBytes,
      uploadedBy: { id: params.user.id, name: params.user.displayName },
      uploadedAt: Date.now(),
      peaks: [],
      bpm: null,
      beatGrid: null,
      key: null,
      tags: [],
      status: 'processing',
    };
    this.store.putMedia(item);
    this.emitMedia();

    void decodeQueue.add(async () => {
      const started = Date.now();
      try {
        item.title = await probeTitle(storedPath, item.title);
        const result = await decodeToPcm(storedPath, pcmPath(id));
        item.durationMs = result.durationMs;
        item.peaks = result.peaks;
        item.status = 'ready';
        delete item.error;
        log.info(`ingested "${item.title}" (${(result.durationMs / 1000).toFixed(1)}s) in ${Date.now() - started}ms`);
      } catch (err) {
        item.status = 'error';
        item.error = (err as Error).message.slice(0, 200);
        log.warn(`failed to ingest ${params.originalName}: ${item.error}`);
      }
      this.store.putMedia(item);
      this.emitMedia();

      // The track is playable from here. Beat analysis adds seconds on top of
      // the decode for something optional, so it runs after the pool has
      // already been told, and a crashed or missing aubio cannot take the
      // upload down with it. Still inside the decode job, so a burst of
      // uploads cannot pin every core between them.
      if (item.status === 'ready') await this.analyse(item);
    });

    return item;
  }

  /**
   * Reads the beat grid off a decoded track and stores it. Safe to call again
   * later — which is the point of the command that does, because operators
   * install aubio *after* importing a library, not before.
   */
  private async analyse(item: MediaItem): Promise<void> {
    const grid = await analyseBeats(pcmPath(item.id), item.durationMs);
    if (!grid) return;
    item.beatGrid = grid;
    // Detected tempo fills a blank, but never overrules a number somebody
    // typed or tapped: they were listening to it and the detector was not.
    if (item.bpm === null) item.bpm = grid.bpm;
    this.store.putMedia(item);
    this.syncTitles(item);
    this.emitMedia();
    log.info(
      `beat grid for "${item.title}": ${grid.bpm} bpm, offset ${grid.beatOffsetMs}ms, ` +
        `confidence ${(grid.confidence * 100).toFixed(0)}%`,
    );
  }

  private async deleteMedia(item: MediaItem): Promise<void> {
    for (const id of DECK_IDS) {
      if (this.mixer.decks[id].mediaId === item.id) this.mixer.decks[id].eject();
    }
    for (const pad of this.mixer.pads) {
      if (pad.mediaId === item.id) pad.clear();
    }
    this.persistPads();
    // A deleted track must not sit in the queue waiting to fail to load.
    this.store.db.queue.items = this.store.db.queue.items.filter((entry) => entry.mediaId !== item.id);
    this.store.removeMedia(item.id);

    await fsp.unlink(pcmPath(item.id)).catch(() => undefined);
    const ext = path.extname(item.originalName).slice(0, 12) || '.bin';
    await fsp.unlink(path.join(config.paths.mediaDir, `${item.id}${ext}`)).catch(() => undefined);
    this.emitMedia();
  }

  /** Keep loaded decks/pads showing the current title after a rename. */
  private syncTitles(item: MediaItem): void {
    for (const id of DECK_IDS) {
      const deck = this.mixer.decks[id];
      if (deck.mediaId === item.id) {
        deck.title = item.title;
        deck.bpm = item.bpm;
      }
    }
    for (const pad of this.mixer.pads) {
      if (pad.mediaId === item.id) pad.title = item.title;
    }
  }

  private persistPads(): void {
    this.store.db.pads = this.mixer.pads.map((p) => ({
      mediaId: p.mediaId,
      gain: p.gain,
      mode: p.mode,
    }));
    this.store.save();
  }

  private restorePersisted(): void {
    this.mixer.applyMixer(this.store.db.mixer);
    for (let i = 0; i < PAD_COUNT; i++) {
      const saved = this.store.db.pads[i];
      if (!saved) continue;
      const pad = this.mixer.pads[i];
      pad.set({ gain: saved.gain, mode: saved.mode });
      if (!saved.mediaId) continue;
      const item = this.store.getMedia(saved.mediaId);
      if (item?.status !== 'ready') continue;
      try {
        pad.assign(item.id, item.title, this.makeReader(item.id, `pad:${i}`));
      } catch (err) {
        // A pad whose audio is not reachable yet is left empty rather than
        // taking the restore down. The host may simply not have connected.
        log.warn(`could not restore pad ${i}: ${(err as Error).message}`);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.channelTimer) clearInterval(this.channelTimer);
    if (this.hostGrace) clearTimeout(this.hostGrace);
    this.host.dispose();
    this.osc.stop();
    this.nowPlaying.configure({ presence: false, webhook: null, snapshot: () => this.state() });
    this.voice.leave();
    this.mixer.destroy();
    this.control.dispose();
    await this.store.flush();
    await this.bot.destroy();
  }
}

export function pcmPath(id: string): string {
  return path.join(config.paths.pcmDir, `${id}.pcm`);
}

/** Slash-command wiring, imported late: commands.ts needs a Rig to talk to. */
async function registerCommandsFor(rig: Rig): Promise<void> {
  const { registerCommands } = await import('./discord/commands');
  await registerCommands(rig);
}

async function clearCommandsFor(
  identity: BotCredentials & { guildId?: string },
): Promise<void> {
  const { clearCommands } = await import('./discord/commands');
  await clearCommands(identity);
}
