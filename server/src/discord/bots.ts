import crypto from 'node:crypto';
import { Bot, type BotCredentials } from './bot';
import { config } from '../config';
import * as platform from '../db/platform';
import { fingerprint, seal, unseal } from '../secrets';
import type { GuildStore, PersistedBot } from '../store';
import { createLogger } from '../logger';
import type { ActiveBot, BotSummary, SessionUser } from '../protocol';

const log = createLogger('bots');

/**
 * Which Discord account one rig plays through.
 *
 * "deck" — the bot from the environment — is the default for every rig and
 * cannot be removed; a platform admin can add others by pasting a token, and
 * point any rig at any of them without a restart.
 *
 * The roster is platform-wide but this class is per rig: two guilds can be on
 * air through two different accounts at once, and each needs its own view of
 * what is connected, what failed, and what is mid-swap. That used to be module
 * state, which was true of a process serving one guild and would have had two
 * rigs reporting each other's connection errors.
 *
 * Tokens are sealed before they are written and never handed back out: the
 * console sees a name, an application id and a fingerprint, which is enough to
 * tell two entries apart and to confirm the token stored is the one pasted.
 */

const API = 'https://discord.com/api/v10';
/** The id reserved for the bot configured in the environment. */
export const DEFAULT_BOT_ID = 'default';

export class BotError extends Error {}

function defaultCredentials(): BotCredentials {
  return {
    id: DEFAULT_BOT_ID,
    name: 'deck',
    token: config.discord.playback.token,
    applicationId: config.discord.playback.applicationId,
  };
}

/** Credentials for a stored bot, or null if its token cannot be unsealed. */
function credentialsFor(entry: PersistedBot): BotCredentials | null {
  const token = unseal(entry.token);
  if (!token) return null;
  return { id: entry.id, name: entry.name, token, applicationId: entry.applicationId };
}

/**
 * Checks a token with Discord before it is stored: that it works at all, and
 * that the account it belongs to is in the guild that wants it. Both are things
 * that would otherwise only surface as a failed swap with the rig off air.
 */
async function verifyToken(
  token: string,
  guildId: string,
): Promise<{ id: string; username: string; tag: string }> {
  let me: Response;
  try {
    me = await fetch(`${API}/users/@me`, { headers: { authorization: `Bot ${token}` } });
  } catch (err) {
    throw new BotError(`Could not reach Discord: ${(err as Error).message}`);
  }
  if (me.status === 401) throw new BotError('Discord rejected that token.');
  if (!me.ok) throw new BotError(`Discord refused the token check (HTTP ${me.status}).`);

  const user = (await me.json()) as {
    id: string;
    username: string;
    discriminator: string;
    bot?: boolean;
  };
  if (!user.bot) {
    throw new BotError('That is a user token, not a bot token. Use the token from the Bot tab.');
  }

  const guild = await fetch(`${API}/guilds/${guildId}`, {
    headers: { authorization: `Bot ${token}` },
  });
  if (guild.status === 403 || guild.status === 404) {
    throw new BotError(
      `${user.username} is not in that server. Invite it with the Connect and Speak ` +
        'permissions, then add it again.',
    );
  }
  if (!guild.ok) throw new BotError(`Could not confirm server membership (HTTP ${guild.status}).`);

  return {
    id: user.id,
    username: user.username,
    tag:
      user.discriminator && user.discriminator !== '0'
        ? `${user.username}#${user.discriminator}`
        : user.username,
  };
}

export interface BotRegistryHooks {
  /** Where the rig is in voice, so a swap can put the new bot back there. */
  resumeChannelId: () => string | null;
  leaveVoice: () => void;
  joinVoice: (channelId: string) => Promise<void>;
  registerCommands: () => Promise<void>;
  clearCommands: (identity: BotCredentials) => Promise<void>;
  onChange: () => void;
}

export class BotRegistry {
  private status: ActiveBot['status'] = 'connecting';
  private statusError: string | null = null;
  /** Errors from the last connection attempt, by bot id, for the console. */
  private lastErrors = new Map<string, string>();
  /** Swaps run one at a time *per rig*. Two guilds swapping do not queue behind each other. */
  private swapping: Promise<void> = Promise.resolve();

  constructor(
    private readonly guildId: string,
    private readonly bot: Bot,
    private readonly store: GuildStore,
    private readonly hooks: BotRegistryHooks,
  ) {}

  private activeId(): string {
    const wanted = this.store.db.activeBotId;
    if (!wanted || wanted === DEFAULT_BOT_ID) return DEFAULT_BOT_ID;
    return platform.getBot(wanted) ? wanted : DEFAULT_BOT_ID;
  }

  active(): ActiveBot {
    const identity = this.bot.identity ?? defaultCredentials();
    return {
      id: identity.id,
      name: identity.name,
      tag: this.bot.tag,
      applicationId: identity.applicationId,
      status: this.status,
      error: this.statusError,
    };
  }

  list(): BotSummary[] {
    const live = this.activeId();
    const defaultEntry: BotSummary = {
      id: DEFAULT_BOT_ID,
      name: 'deck',
      applicationId: config.discord.playback.applicationId,
      tag: live === DEFAULT_BOT_ID ? this.bot.tag : null,
      fingerprint: fingerprint(config.discord.playback.token),
      isDefault: true,
      active: live === DEFAULT_BOT_ID,
      addedBy: null,
      addedAt: null,
      error: this.lastErrors.get(DEFAULT_BOT_ID) ?? null,
    };

    return [
      defaultEntry,
      ...platform.listBots().map((entry) => ({
        id: entry.id,
        name: entry.name,
        applicationId: entry.applicationId,
        tag: entry.id === live ? this.bot.tag ?? entry.tag : entry.tag,
        fingerprint: entry.fingerprint,
        isDefault: false,
        active: entry.id === live,
        addedBy: entry.addedBy,
        addedAt: entry.addedAt,
        error: this.lastErrors.get(entry.id) ?? null,
      })),
    ];
  }

  /* -------------------------------------------------------------- mutation */

  async add(user: SessionUser, input: { name?: string; token: string }): Promise<BotSummary> {
    const token = input.token.trim();
    if (!token) throw new BotError('Paste the bot token.');

    const print = fingerprint(token);
    if (print === fingerprint(config.discord.playback.token)) {
      throw new BotError('That is already the default bot.');
    }
    const clash = platform.findBotByFingerprint(print);
    if (clash) throw new BotError(`That token is already here as "${clash.name}".`);

    const identity = await verifyToken(token, this.guildId);

    const entry: PersistedBot = {
      id: crypto.randomUUID(),
      name: (input.name?.trim() || identity.username).slice(0, 60),
      applicationId: identity.id,
      tag: identity.tag,
      token: seal(token),
      fingerprint: print,
      addedBy: { id: user.id, name: user.displayName },
      addedAt: Date.now(),
    };
    platform.addBot(entry);
    log.info(`${user.displayName} added playback bot "${entry.name}" (${print})`);
    this.hooks.onChange();

    return this.list().find((summary) => summary.id === entry.id) as BotSummary;
  }

  async remove(user: SessionUser, id: string): Promise<void> {
    if (id === DEFAULT_BOT_ID) throw new BotError('The default bot cannot be removed.');
    const entry = platform.getBot(id);
    if (!entry) throw new BotError('That bot is not on the list.');

    // Asked before the row is deleted. `activeId` falls back to the default for
    // any id it cannot find, so asking afterwards always answers "it was not
    // active" — and the bot being removed would carry on playing on the very
    // token that was just revoked.
    const wasActive = this.activeId() === id;

    platform.removeBot(id);
    if (wasActive) this.store.db.activeBotId = null;
    this.store.markGuild();
    this.lastErrors.delete(id);
    log.info(`${user.displayName} removed playback bot "${entry.name}"`);

    if (wasActive) await this.activate(user, DEFAULT_BOT_ID);
    else this.hooks.onChange();
  }

  /**
   * Puts a different bot on air.
   *
   * Voice cannot be handed between two Discord accounts, so the connection is
   * dropped and remade: the old bot leaves the channel, the new one logs in and
   * rejoins where the old one was. The mix itself never stops — the decks keep
   * running through the silent path while the swap happens.
   */
  async activate(user: SessionUser, id: string): Promise<void> {
    const run = this.swapping.then(
      () => this.doActivate(user, id),
      () => this.doActivate(user, id),
    );
    this.swapping = run.catch(() => undefined);
    return run;
  }

  private async doActivate(user: SessionUser, id: string): Promise<void> {
    let credentials: BotCredentials | null =
      id === DEFAULT_BOT_ID ? defaultCredentials() : null;

    if (!credentials) {
      const entry = platform.getBot(id);
      if (!entry) throw new BotError('That bot is not on the list.');
      credentials = credentialsFor(entry);
      if (!credentials) {
        throw new BotError(
          `The stored token for "${entry.name}" could not be read — it was encrypted with a ` +
            'different SESSION_SECRET. Remove it and add the token again.',
        );
      }
    }

    // Compared against the bot actually connected, not the stored preference.
    // Removing the bot that is on air writes the preference back to the default
    // *before* asking for the swap, and a check against the store would then see
    // nothing to do and leave the rig playing through the token just revoked.
    if (this.bot.identity?.id === credentials.id && this.bot.isReady) {
      this.store.db.activeBotId = credentials.id === DEFAULT_BOT_ID ? null : credentials.id;
      this.store.markGuild();
      return;
    }

    const resumeChannelId = this.hooks.resumeChannelId();
    const outgoing = this.bot.identity;

    this.status = 'connecting';
    this.statusError = null;
    this.hooks.onChange();

    this.hooks.leaveVoice();

    try {
      await this.bot.connect(credentials);
    } catch (err) {
      const message = (err as Error).message;
      this.lastErrors.set(credentials.id, message);
      // A refused login leaves the previous bot connected — `connect` puts it
      // back rather than leaving the rig with no gateway at all — so the failure
      // belongs against the bot that would not start, not against the rig. Put
      // the old one back in the channel it was pulled out of.
      const recovered = this.bot.isReady;
      this.status = recovered ? 'ready' : 'error';
      this.statusError = recovered ? null : message;
      if (recovered && resumeChannelId) {
        await this.hooks.joinVoice(resumeChannelId).catch((rejoinErr: Error) => {
          log.warn(`could not put the previous bot back in voice: ${rejoinErr.message}`);
        });
      }
      this.hooks.onChange();
      throw new BotError(`Could not connect as "${credentials.name}": ${message}`);
    }

    this.lastErrors.delete(credentials.id);
    this.store.db.activeBotId = credentials.id === DEFAULT_BOT_ID ? null : credentials.id;
    this.store.markGuild();
    this.status = 'ready';
    this.statusError = null;
    log.info(`${user.displayName} switched ${this.guildId} to "${credentials.name}"`);

    // Slash commands belong to an application, so they move with the swap: off
    // the one leaving, on to the one arriving. Skipped when both bots share an
    // application, which would take the command straight back off again.
    if (outgoing && outgoing.applicationId !== credentials.applicationId) {
      await this.hooks.clearCommands(outgoing);
    }
    await this.hooks.registerCommands();

    if (resumeChannelId) {
      try {
        await this.hooks.joinVoice(resumeChannelId);
      } catch (err) {
        // Not fatal: the swap worked, the rejoin did not. Usually the new bot is
        // missing Connect or Speak in that particular channel.
        const message = (err as Error).message;
        this.statusError = `Connected, but could not rejoin voice: ${message}`;
        log.warn(`could not rejoin voice as the new bot: ${message}`);
      }
    }

    this.hooks.onChange();
  }

  /** Boot: connect whichever bot was last on air, falling back to the default. */
  async start(): Promise<void> {
    const id = this.activeId();
    const entry = id === DEFAULT_BOT_ID ? null : platform.getBot(id);
    const credentials = entry ? credentialsFor(entry) : defaultCredentials();

    if (credentials) {
      try {
        await this.bot.connect(credentials);
        this.status = 'ready';
        this.statusError = null;
        return;
      } catch (err) {
        const message = (err as Error).message;
        this.lastErrors.set(credentials.id, message);
        log.error(`${this.guildId}: could not connect as "${credentials.name}": ${message}`);
        if (credentials.id === DEFAULT_BOT_ID) throw err;
        log.warn('falling back to the default bot');
      }
    } else if (entry) {
      log.error(`the stored token for "${entry.name}" could not be read; falling back`);
      this.lastErrors.set(entry.id, 'The stored token could not be read.');
    }

    this.store.db.activeBotId = null;
    this.store.markGuild();
    await this.bot.connect(defaultCredentials());
    this.status = 'ready';
    this.statusError = null;
  }
}
