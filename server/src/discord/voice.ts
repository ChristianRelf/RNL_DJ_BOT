import { EventEmitter } from 'node:events';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import { ChannelType, Events, PermissionsBitField, Routes } from 'discord.js';
import type { GuildMember, VoiceBasedChannel, VoiceState as DiscordVoiceState } from 'discord.js';
import { bot } from './bot';
import { createLogger } from '../logger';
import { store } from '../store';
import type { Mixer } from '../audio/mixer';
import type { VoiceState } from '../protocol';

const log = createLogger('voice');

/**
 * What the voice channel says about itself while the rig is in it.
 *
 * Discord shows a channel's status under its name to everyone in the server, so
 * this is the one place the booth announces itself to people who never open the
 * console — the channel list says the decks are live without anyone asking.
 *
 * The wording is editable from the tools page; this is what it falls back to.
 */
const CHANNEL_STATUS = 'deck is in command';

/** The caption as configured, or null when the tool is switched off. */
function captionText(): string | null {
  const tools = store.db.tools;
  if (!tools.channelStatus) return null;
  return tools.channelStatusText.trim() || CHANNEL_STATUS;
}

/**
 * Owns the single voice connection and keeps the mixer wired into it.
 *
 * The mix is fed in as raw 48 kHz stereo PCM, so the voice player's Opus
 * encoder pulls one 20 ms frame at a time straight from the mix graph — no
 * intermediate ffmpeg process on the realtime path.
 */
export class VoiceManager extends EventEmitter {
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;
  private channel: VoiceBasedChannel | null = null;
  private channelId: string | null = null;
  private channelName: string | null = null;
  private status: VoiceState['status'] = 'disconnected';
  private lastError: string | null = null;
  private joining: Promise<void> | null = null;
  /** The stage situation already acted on: `channelId:requestToSpeakTimestamp`. */
  private stageAttempt: string | null = null;

  constructor(private readonly mixer: Mixer) {
    super();

    // Decisive diagnostic for a connection stuck at "signalling": this fires
    // only if Discord accepted the join and echoed our own voice state back.
    // Seen + still stuck  => the gateway replied but the voice adapter never
    //                        got the server details.
    // Never seen          => Discord refused the join outright (permissions,
    //                        rate limit, or a second session on this token).
    //
    // Registered through `onClient` so it follows the rig onto whichever bot is
    // playing rather than staying bound to the one running at startup.
    bot.onClient((client) => {
      client.on(Events.VoiceStateUpdate, (previous, next) => {
        if (next.id !== client.user?.id) return;
        const line =
          `own voice state: ${previous.channelId ?? 'none'} -> ${next.channelId ?? 'none'}` +
          ` (session ${next.sessionId ? 'present' : 'missing'})`;
        if (this.status === 'connecting') log.info(line);
        else log.debug(line);
        void this.takeTheStage(next);
      });
    });
  }

  /**
   * Gets the rig onto the stage, whenever it finds itself on one.
   *
   * A stage channel puts everyone who arrives in the audience, muted at the
   * server, and a booth in the audience is a booth nobody can hear — it keeps
   * mixing and encoding perfectly while the room sits in silence. Joining one
   * directly and being dragged into one both land here, because both produce
   * the same thing: our own voice state, suppressed, in a stage.
   *
   * Three outcomes, in the order they are worth trying:
   *  - We can unsuppress ourselves (the rig is a stage moderator, or holds Mute
   *    Members) — up we go, no one has to do anything.
   *  - A moderator has offered us the floor, which Discord records by putting a
   *    request-to-speak timestamp on us. The same call accepts it.
   *  - Neither: raise a hand, and take the offer through the branch above when
   *    it arrives.
   *
   * Every attempt changes our voice state, which fires this again, so each
   * distinct situation is tried exactly once — keyed on the channel and the
   * timestamp, so a fresh offer is always a fresh attempt even if the last one
   * failed a moment ago.
   */
  private async takeTheStage(state: DiscordVoiceState): Promise<void> {
    const channel = state.channel;
    if (!channel || channel.type !== ChannelType.GuildStageVoice) {
      this.stageAttempt = null;
      return;
    }
    if (!state.suppress) {
      // Speaking. Clear the record so a later demotion back to the audience is
      // treated as new rather than as something already tried.
      if (this.stageAttempt) log.info(`speaking on stage in #${channel.name}`);
      this.stageAttempt = null;
      return;
    }

    const attempt = `${channel.id}:${state.requestToSpeakTimestamp ?? 'none'}`;
    if (this.stageAttempt === attempt) return;
    this.stageAttempt = attempt;

    try {
      await state.setSuppressed(false);
      log.info(
        state.requestToSpeakTimestamp
          ? `accepted the invitation to speak in #${channel.name}`
          : `went up on stage in #${channel.name}`,
      );
      // Cleared here rather than on the state update this causes, so the event
      // that confirms it does not report the same thing a second time.
      this.stageAttempt = null;
      return;
    } catch (err) {
      log.debug(`could not go up on stage yet: ${(err as Error).message}`);
    }

    // Already asked and still waiting — asking twice would not make it arrive
    // any sooner, and it would clear the hand a moderator is looking at.
    if (state.requestToSpeakTimestamp) {
      log.info(`waiting for a moderator to bring the rig up in #${channel.name}`);
      return;
    }

    try {
      await state.setRequestToSpeak(true);
      log.info(`asked to speak in #${channel.name}`);
    } catch (err) {
      log.warn(
        `cannot get on stage in #${channel.name} — the bot needs the Request to Speak ` +
          `permission, or to be made a stage moderator: ${(err as Error).message}`,
      );
    }
  }

  snapshot(): VoiceState {
    return {
      status: this.status,
      channelId: this.channelId,
      channelName: this.channelName,
      listeners: this.listenerCount_(),
      error: this.lastError,
    };
  }

  private listenerCount_(): number {
    if (!this.channel) return 0;
    return this.channel.members.filter((m: GuildMember) => !m.user.bot).size;
  }

  private setStatus(status: VoiceState['status'], error: string | null = null): void {
    this.status = status;
    this.lastError = error;
    this.emit('change');
  }

  async join(channelId: string): Promise<void> {
    if (this.joining) await this.joining.catch(() => undefined);
    this.joining = this.doJoin(channelId);
    try {
      await this.joining;
    } finally {
      this.joining = null;
    }
  }

  private async doJoin(channelId: string): Promise<void> {
    const channel = await bot.voiceChannel(channelId);
    if (!channel) throw new Error('That voice channel no longer exists.');

    // Discord refuses these joins silently — the connection just sits in
    // "signalling" until it times out — so every one of them is checked here
    // and reported properly instead.
    const me =
      channel.guild.members.me ?? (await channel.guild.members.fetchMe().catch(() => null));
    if (!me) {
      throw new Error('Could not resolve the bot as a member of this server. Re-invite it.');
    }

    const permissions = channel.permissionsFor(me);
    const required = [
      { flag: PermissionsBitField.Flags.ViewChannel, name: 'View Channel' },
      { flag: PermissionsBitField.Flags.Connect, name: 'Connect' },
      { flag: PermissionsBitField.Flags.Speak, name: 'Speak' },
    ];
    const missing = required.filter((p) => !permissions?.has(p.flag)).map((p) => p.name);
    if (missing.length > 0) {
      throw new Error(`Missing ${missing.join(' + ')} permission in #${channel.name}.`);
    }

    // Not one of the three above: the booth plays perfectly well without being
    // able to caption the channel, so this is a note rather than a refusal.
    if (captionText() && !permissions?.has(PermissionsBitField.Flags.SetVoiceChannelStatus)) {
      log.info(
        `no Set Voice Channel Status permission in #${channel.name}; ` +
          'the channel status will stay blank',
      );
    }

    // A full channel rejects the bot unless it can move members past the limit.
    if (
      channel.userLimit > 0 &&
      channel.members.size >= channel.userLimit &&
      !permissions?.has(PermissionsBitField.Flags.MoveMembers)
    ) {
      throw new Error(
        `#${channel.name} is full (${channel.members.size}/${channel.userLimit}).`,
      );
    }

    if (channel.type === ChannelType.GuildStageVoice) {
      // Arriving in the audience is normal and handled — `takeTheStage` picks
      // it up off our own voice state a moment after the join lands.
      log.info(`#${channel.name} is a stage channel; the rig will try to go up`);
    }

    this.teardown(false);
    this.channel = channel;
    this.channelId = channel.id;
    this.channelName = channel.name;
    this.setStatus('connecting');

    log.info(`requesting voice join for #${channel.name} (${channel.id})`);
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    this.connection = connection;

    connection.on('error', (err) => log.error('connection error:', err.message));
    connection.on('stateChange', (previous, next) => {
      if (previous.status !== next.status) log.debug(`${previous.status} -> ${next.status}`);
    });
    connection.on(VoiceConnectionStatus.Disconnected, async (_old, next) => {
      // Websocket 4014 means we were moved or kicked; anything else is worth
      // one reconnect attempt before giving up.
      if (
        next.reason === VoiceConnectionDisconnectReason.WebSocketClose &&
        next.closeCode === 4014
      ) {
        log.warn('disconnected by Discord (moved or removed)');
        this.teardown(true);
        return;
      }
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        log.warn('could not resume voice connection, leaving');
        this.teardown(true);
      }
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      // Where it stalled says why: "signalling" means Discord never sent the
      // voice server details, "connecting" means the UDP handshake to that
      // server failed — usually blocked outbound UDP or a missing encryption
      // package.
      const stuckAt = connection.state.status;
      this.teardown(false);
      const hint =
        stuckAt === 'connecting'
          ? ' The UDP handshake failed: check outbound UDP is allowed and that an encryption package is installed.'
          : stuckAt === 'signalling'
            ? ' Discord never returned voice server details. Usually a channel permission ' +
              'overwrite denying Connect, a full channel, or a second copy of the bot ' +
              'running on the same token.'
            : '';
      log.error(`voice connection timed out while "${stuckAt}".${hint}`);
      this.setStatus('error', `Timed out connecting to voice (stuck at "${stuckAt}").`);
      throw new Error(`Timed out connecting to that voice channel (stuck at "${stuckAt}").${hint}`);
    }

    // Keep encoding even with nobody subscribed; the mix must not stall when
    // the last human leaves the channel mid-set.
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    player.on('error', (err) => {
      log.error('player error:', err.message);
      this.setStatus('error', err.message);
    });
    player.on(AudioPlayerStatus.Idle, () => {
      // The mix stream never ends on purpose; if it does, the connection would
      // sit silent, so re-arm it. `this.player === player` keeps a teardown
      // (which stops the player) from resurrecting the stream it just released.
      if (this.player === player && this.connection) this.arm(player);
    });
    this.player = player;

    connection.subscribe(player);
    this.arm(player);
    this.setStatus('ready');
    log.info(`joined #${channel.name}`);

    // Deliberately not awaited: the booth is already live and a caption is not
    // worth holding the join open for a REST round trip.
    void this.writeChannelStatus(channel.id, captionText() ?? '');
  }

  /**
   * Re-writes the caption for the channel already joined. Called when the tool
   * is switched or reworded mid-set, which is the only time the status can go
   * stale — every other path through here joins or leaves.
   */
  refreshChannelStatus(): void {
    if (!this.channelId || this.status !== 'ready') return;
    void this.writeChannelStatus(this.channelId, captionText() ?? '');
  }

  /**
   * Writes the channel's status line, or clears it with an empty string.
   *
   * Best effort in both directions. It needs the Set Voice Channel Status
   * permission, which the join deliberately does not require — a rig that
   * refused to play because it could not write a caption would be a bad trade.
   */
  private async writeChannelStatus(channelId: string, status: string): Promise<void> {
    try {
      await bot.client.rest.put(Routes.channelVoiceStatus(channelId), { body: { status } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Failing to clear on the way out is usually just the bot having already
      // left, which is not worth a warning every time someone stops playing.
      if (status) log.warn(`could not set the channel status: ${message}`);
      else log.debug(`could not clear the channel status: ${message}`);
    }
  }

  private arm(player: AudioPlayer): void {
    const resource = createAudioResource(this.mixer.createStream(), {
      inputType: StreamType.Raw,
      inlineVolume: false,
    });
    player.play(resource);
  }

  leave(): void {
    this.teardown(true);
    log.info('left voice');
  }

  private teardown(notify: boolean): void {
    // Sent before the connection goes away, while the bot is still a member of
    // the channel — Discord will not take a status from a bot that has left.
    if (this.channelId) void this.writeChannelStatus(this.channelId, '');

    this.stageAttempt = null;
    const player = this.player;
    this.player = null;
    player?.stop(true);
    if (this.connection) {
      try {
        this.connection.destroy();
      } catch {
        /* already destroyed */
      }
      this.connection = null;
    }
    this.mixer.releaseStream();
    this.channel = null;
    this.channelId = null;
    this.channelName = null;
    if (notify) this.setStatus('disconnected');
    else {
      this.status = 'disconnected';
      this.lastError = null;
    }
  }

  get connected(): boolean {
    return this.status === 'ready';
  }
}
