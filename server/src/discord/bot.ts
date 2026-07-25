import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  type GuildMember,
  type VoiceBasedChannel,
} from 'discord.js';
import { config } from '../config';
import { createLogger } from '../logger';
import type { VoiceChannelInfo } from '../protocol';

const log = createLogger('discord');

/**
 * Thin wrapper over the gateway client. Only two privileged-free intents are
 * needed: Guilds for the channel cache and GuildVoiceStates so we can report
 * who is actually listening.
 */
export class Bot {
  readonly client: Client;
  private ready = false;

  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
    this.client.on('error', (err) => log.error('gateway error:', err.message));
    this.client.on('warn', (msg) => log.warn(msg));
  }

  async start(): Promise<void> {
    await this.client.login(config.discord.token);
    await new Promise<void>((resolve) => {
      if (this.client.isReady()) return resolve();
      this.client.once(Events.ClientReady, () => resolve());
    });
    this.ready = true;
    const guild = await this.guild();
    log.info(`logged in as ${this.client.user?.tag}, serving guild "${guild.name}"`);
  }

  get isReady(): boolean {
    return this.ready;
  }

  async guild(): Promise<Guild> {
    const cached = this.client.guilds.cache.get(config.discord.guildId);
    if (cached) return cached;
    try {
      return await this.client.guilds.fetch(config.discord.guildId);
    } catch {
      throw new Error(
        `The bot is not in guild ${config.discord.guildId}. Invite it first, then restart.`,
      );
    }
  }

  /** Guild member lookup by REST — no privileged GuildMembers intent required. */
  async member(userId: string): Promise<GuildMember | null> {
    try {
      const guild = await this.guild();
      return await guild.members.fetch({ user: userId, force: false });
    } catch {
      return null;
    }
  }

  async voiceChannels(): Promise<VoiceChannelInfo[]> {
    if (!this.ready) return [];
    const guild = await this.guild();
    const me = guild.members.me;
    const channels: VoiceChannelInfo[] = [];
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
        continue;
      }
      const voice = channel as VoiceBasedChannel;
      // Hide channels the bot could never join — they would only ever error.
      if (me && !voice.permissionsFor(me)?.has(['ViewChannel', 'Connect'])) continue;
      const humans = voice.members.filter((m) => !m.user.bot).size;
      channels.push({
        id: voice.id,
        name: voice.name,
        members: humans,
        full: voice.userLimit > 0 && voice.members.size >= voice.userLimit,
      });
    }
    return channels.sort((a, b) => a.name.localeCompare(b.name));
  }

  async voiceChannel(channelId: string): Promise<VoiceBasedChannel | null> {
    const guild = await this.guild();
    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId));
    if (!channel) return null;
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      return null;
    }
    return channel as VoiceBasedChannel;
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
  }
}

export const bot = new Bot();
