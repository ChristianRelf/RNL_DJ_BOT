import {
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { CommandError, type Rig } from '../rig';
import { checkAccess, isPlatformAdmin } from '../auth';
import { config } from '../config';
import { createLogger } from '../logger';
import type { SessionUser } from '../protocol';

const log = createLogger('commands');

const dj = new SlashCommandBuilder()
  .setName('dj')
  .setDescription('Control the RNL DJ rig')
  .addSubcommand((s) => s.setName('panel').setDescription('Get a link to the DJ control surface'))
  .addSubcommand((s) => s.setName('now').setDescription('Show what is playing right now'))
  .addSubcommand((s) =>
    s
      .setName('summon')
      .setDescription('Bring the DJ bot into a voice channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Voice channel to join (defaults to yours)')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      ),
  )
  .addSubcommand((s) => s.setName('leave').setDescription('Disconnect the DJ bot from voice'));

/**
 * Registers /dj against whichever application is currently on air. Slash
 * commands belong to an application, not to a server, so this runs again after
 * every bot swap — otherwise the command would keep pointing at the bot that
 * has just been taken off.
 */
export async function registerCommands(rig: Rig): Promise<void> {
  const identity = rig.bot.identity;
  if (!identity) return;
  const rest = new REST({ version: '10' }).setToken(identity.token);
  try {
    await rest.put(
      Routes.applicationGuildCommands(identity.applicationId, rig.guildId),
      { body: [dj.toJSON()] },
    );
    log.info(`registered /dj for ${identity.name} in ${rig.guildId}`);
  } catch (err) {
    log.warn('could not register slash commands:', (err as Error).message);
  }
}

/**
 * Takes /dj off an application that is no longer on air.
 *
 * Commands are registered per application, so without this a swap leaves the
 * previous bot's copy in place and the server ends up offering two identical
 * /dj commands — one of which drives nothing.
 */
export async function clearCommands(identity: {
  name: string;
  token: string;
  applicationId: string;
  guildId?: string;
}): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(identity.token);
  try {
    // Without a guild the command list cannot be addressed at all, so this is
    // a no-op rather than a global wipe of the application's commands.
    if (!identity.guildId) return;
    await rest.put(
      Routes.applicationGuildCommands(identity.applicationId, identity.guildId),
      { body: [] },
    );
    log.info(`removed /dj from ${identity.name}`);
  } catch (err) {
    log.warn(`could not remove /dj from ${identity.name}:`, (err as Error).message);
  }
}

function toSessionUser(member: GuildMember, access: { isAdmin: boolean }): SessionUser {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 64 }),
    isAdmin: access.isAdmin,
    isPlatformAdmin: isPlatformAdmin(member.id),
  };
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Attached through `onClient`, so a bot swap keeps /dj answering.
 *
 * Bound to one rig. An interaction is routed by the client it arrived on rather
 * than by its guild id: several rigs may share a Discord account, and the one
 * that should answer is the one whose gateway session heard it.
 */
export function attachCommandHandlers(rig: Rig): void {
  rig.bot.onClient((client) => {
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'dj') return;
      if (interaction.guildId !== rig.guildId) return;
      try {
        await handle(rig, interaction);
      } catch (err) {
        const message = err instanceof CommandError ? err.message : 'Something went wrong.';
        if (!(err instanceof CommandError)) log.error('interaction failed:', err);
        const payload = { content: `⚠️ ${message}`, flags: MessageFlags.Ephemeral as const };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      }
    });
  });
}

async function handle(rig: Rig, interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'panel') {
    await interaction.reply({
      content: `🎛️ DJ control surface: ${config.http.publicUrl}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'now') {
    const state = rig.state();
    const embed = new EmbedBuilder()
      .setTitle('RNL DJ — now playing')
      .setColor(state.voice.status === 'ready' ? 0x22d3ee : 0x64748b)
      .setDescription(
        state.voice.status === 'ready'
          ? `Live in **${state.voice.channelName}** · ${state.voice.listeners} listening`
          : 'Not connected to a voice channel.',
      );
    for (const id of ['A', 'B'] as const) {
      const deck = state.decks[id];
      embed.addFields({
        name: `Deck ${id}${deck.playing ? ' ▶' : ''}`,
        value: deck.title
          ? `${deck.title}\n\`${formatTime(deck.positionMs)} / ${formatTime(deck.durationMs)}\``
          : '_empty_',
        inline: true,
      });
    }
    embed.addFields({
      name: 'Control',
      value: state.control.holderName
        ? `**${state.control.holderName}**${state.control.queue.length ? ` · ${state.control.queue.length} waiting` : ''}`
        : '_nobody has control_',
    });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  // summon / leave both mutate the rig, so they run the same permission path
  // as the web UI.
  const member = interaction.member as GuildMember | null;
  if (!member) throw new CommandError('Use this in a server.');
  const access = await checkAccess(rig.guildId, member.id, member.displayName);
  if (!access.allowed) throw new CommandError(access.reason ?? 'You are not allowed to do that.');
  const user = toSessionUser(member, access);

  if (sub === 'leave') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await rig.execute(user, 'voice:leave', {});
    await interaction.editReply('👋 Left the voice channel.');
    return;
  }

  if (sub === 'summon') {
    const picked = interaction.options.getChannel('channel');
    const channelId = picked?.id ?? member.voice.channelId;
    if (!channelId) {
      throw new CommandError('Join a voice channel first, or name one in the command.');
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Grab the lock if it is free so summoning works without opening the panel.
    if (!rig.control.holderId) await rig.execute(user, 'control:request', {});
    await rig.execute(user, 'voice:join', { channelId });
    await interaction.editReply(
      `🔊 Connected. Open the panel to start mixing: ${config.http.publicUrl}`,
    );
  }
}
