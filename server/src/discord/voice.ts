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
import type { GuildMember, VoiceBasedChannel } from 'discord.js';
import { bot } from './bot';
import { createLogger } from '../logger';
import type { Mixer } from '../audio/mixer';
import type { VoiceState } from '../protocol';

const log = createLogger('voice');

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

  constructor(private readonly mixer: Mixer) {
    super();
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

    const me = channel.guild.members.me;
    if (me && !channel.permissionsFor(me)?.has(['ViewChannel', 'Connect', 'Speak'])) {
      throw new Error(`Missing Connect/Speak permission in #${channel.name}.`);
    }

    this.teardown(false);
    this.channel = channel;
    this.channelId = channel.id;
    this.channelName = channel.name;
    this.setStatus('connecting');

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    this.connection = connection;

    connection.on('error', (err) => log.error('connection error:', err.message));
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
    } catch (err) {
      this.teardown(false);
      this.setStatus('error', 'Timed out connecting to voice.');
      throw new Error('Timed out connecting to that voice channel.');
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
