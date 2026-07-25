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
import { bot } from './bot';
import { engine, CommandError } from '../engine';
import { checkAccess } from '../auth';
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
export async function registerCommands(): Promise<void> {
  const identity = bot.identity;
  if (!identity) return;
  const rest = new REST({ version: '10' }).setToken(identity.token);
  try {
    await rest.put(
      Routes.applicationGuildCommands(identity.applicationId, config.discord.guildId),
      { body: [dj.toJSON()] },
    );
    log.info(`registered /dj slash command for ${identity.name}`);
  } catch (err) {
    log.warn('could not register slash commands:', (err as Error).message);
  }
}

function toSessionUser(member: GuildMember, access: { isAdmin: boolean; isOwner: boolean }): SessionUser {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 64 }),
    isAdmin: access.isAdmin,
    isOwner: access.isOwner,
  };
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Attached through `onClient`, so a bot swap keeps /dj answering. */
export function attachCommandHandlers(): void {
  bot.onClient((client) => {
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'dj') return;
      try {
        await handle(interaction);
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

async function handle(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'panel') {
    await interaction.reply({
      content: `🎛️ DJ control surface: ${config.http.publicUrl}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'now') {
    const state = engine.state();
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
  if (!member || interaction.guildId !== config.discord.guildId) {
    throw new CommandError('Use this in the DJ server.');
  }
  const access = await checkAccess(member.id, member.displayName);
  if (!access.allowed) throw new CommandError(access.reason ?? 'You are not allowed to do that.');
  const user = toSessionUser(member, access);

  if (sub === 'leave') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await engine.execute(user, 'voice:leave', {});
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
    if (!engine.control.holderId) await engine.execute(user, 'control:request', {});
    await engine.execute(user, 'voice:join', { channelId });
    await interaction.editReply(
      `🔊 Connected. Open the panel to start mixing: ${config.http.publicUrl}`,
    );
  }
}
