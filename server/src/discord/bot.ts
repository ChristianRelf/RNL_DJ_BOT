import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  type VoiceBasedChannel,
} from 'discord.js';
import { config } from '../config';
import { createLogger } from '../logger';
import type { VoiceChannelInfo } from '../protocol';

const log = createLogger('discord');

/**
 * The gateway client the rig plays through.
 *
 * Which Discord account that is can change while the server is running - an
 * owner can point the rig at a bot of their own from the console - so the
 * client is replaceable rather than fixed. Everything that needs to listen to
 * it registers through `onClient`, which re-runs against each new client, so a
 * swap does not leave handlers attached to a destroyed connection.
 *
 * Sign-in does *not* go through here (see gate.ts): who may log in must not
 * depend on which bot is on air.
 *
 * Only two privilege-free intents are needed: Guilds for the channel cache and
 * GuildVoiceStates so we can report who is actually listening.
 */

export interface BotCredentials {
  /** Registry id of the bot these belong to, for reporting. */
  id: string;
  name: string;
  token: string;
  applicationId: string;
}

type ClientHandler = (client: Client) => void;

export class Bot {
  private current: Client | null = null;
  private credentials: BotCredentials | null = null;
  private handlers: ClientHandler[] = [];
  private ready = false;

  constructor(readonly guildId: string) {}

  /**
   * The live client. Callers hold onto the wrapper, never this - a swap
   * replaces it, and a reference kept across one would point at a dead
   * connection.
   */
  get client(): Client {
    if (!this.current) throw new Error('The playback bot is not connected yet.');
    return this.current;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get identity(): BotCredentials | null {
    return this.credentials;
  }

  get tag(): string | null {
    return this.current?.user?.tag ?? null;
  }

  /**
   * Registers something that needs the live client, now and after every swap.
   * Handlers are attached to a fresh client each time, so they must not
   * accumulate state of their own.
   */
  onClient(handler: ClientHandler): void {
    this.handlers.push(handler);
    if (this.current) handler(this.current);
  }

  /**
   * Logs in as `credentials`, replacing whatever was connected before.
   *
   * The old client is destroyed first: two gateway sessions on one token fight
   * over voice, and even on different tokens leaving the old one running would
   * keep the previous bot sitting in the channel.
   */
  async connect(credentials: BotCredentials): Promise<void> {
    const previous = this.current;
    this.ready = false;
    this.current = null;

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
    client.on('error', (err) => log.error('gateway error:', err.message));
    client.on('warn', (msg) => log.warn(msg));

    try {
      await client.login(credentials.token);
      await new Promise<void>((resolve, reject) => {
        if (client.isReady()) return resolve();
        const timer = setTimeout(() => reject(new Error('Timed out waiting for the gateway.')), 20_000);
        client.once(Events.ClientReady, () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch (err) {
      await client.destroy().catch(() => undefined);
      // The previous client is still alive and still the one on air, so put it
      // back rather than leaving the rig with no bot at all.
      if (previous) {
        this.current = previous;
        this.ready = true;
      }
      throw err;
    }

    if (previous) await previous.destroy().catch(() => undefined);

    this.current = client;
    this.credentials = credentials;
    this.ready = true;
    for (const handler of this.handlers) handler(client);

    const guild = await this.guild();
    log.info(`playing through ${client.user?.tag} (${credentials.name}) in "${guild.name}"`);
  }

  async guild(): Promise<Guild> {
    const cached = this.client.guilds.cache.get(this.guildId);
    if (cached) return cached;
    try {
      return await this.client.guilds.fetch(this.guildId);
    } catch {
      throw new Error(
        `${this.credentials?.name ?? 'The bot'} is not in guild ${this.guildId}. ` +
          'Invite it to the server first.',
      );
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
      // Hide channels the bot could never join - they would only ever error.
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
    this.ready = false;
    await this.current?.destroy().catch(() => undefined);
    this.current = null;
  }
}

/**
 * One `Bot` per rig, owned by that rig.
 *
 * There is no module-level instance any more: several guilds run in this
 * process, each with its own gateway session, and a shared one would mean a
 * swap in one server dropping another server's bot out of voice.
 */
