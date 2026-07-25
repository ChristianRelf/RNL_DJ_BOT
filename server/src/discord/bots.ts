import crypto from 'node:crypto';
import { bot, type BotCredentials } from './bot';
import { config } from '../config';
import { store, type PersistedBot } from '../store';
import { fingerprint, seal, unseal } from '../secrets';
import { createLogger } from '../logger';
import type { ActiveBot, BotSummary, SessionUser } from '../protocol';

const log = createLogger('bots');

/**
 * The playback bot registry.
 *
 * The rig speaks through one Discord account at a time. "deck" — the bot from
 * the environment — is the default and cannot be removed; an owner can add
 * others by pasting a token, and switch which one is on air without a restart.
 *
 * Tokens are sealed before they are written and are never handed back out: the
 * console sees a name, an application id and a fingerprint, which is enough to
 * tell two entries apart and to confirm that the token that got stored is the
 * one that was pasted.
 */

const API = 'https://discord.com/api/v10';
/** The id reserved for the bot configured in the environment. */
export const DEFAULT_BOT_ID = 'default';

export class BotError extends Error {}

/** What the rest of the server is told about who is currently on air. */
let status: ActiveBot['status'] = 'connecting';
let statusError: string | null = null;
/** Errors from the last connection attempt, by bot id, for the console. */
const lastErrors = new Map<string, string>();

type Listener = () => void;
const listeners = new Set<Listener>();

export function onBotChange(listener: Listener): void {
  listeners.add(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------ the roster */

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

function activeId(): string {
  const wanted = store.db.activeBotId;
  if (!wanted || wanted === DEFAULT_BOT_ID) return DEFAULT_BOT_ID;
  return store.db.bots.some((entry) => entry.id === wanted) ? wanted : DEFAULT_BOT_ID;
}

export function activeBot(): ActiveBot {
  const identity = bot.identity ?? defaultCredentials();
  return {
    id: identity.id,
    name: identity.name,
    tag: bot.tag,
    applicationId: identity.applicationId,
    status,
    error: statusError,
  };
}

export function list(): BotSummary[] {
  const live = activeId();
  const defaultEntry: BotSummary = {
    id: DEFAULT_BOT_ID,
    name: 'deck',
    applicationId: config.discord.playback.applicationId,
    tag: live === DEFAULT_BOT_ID ? bot.tag : null,
    fingerprint: fingerprint(config.discord.playback.token),
    isDefault: true,
    active: live === DEFAULT_BOT_ID,
    addedBy: null,
    addedAt: null,
    error: lastErrors.get(DEFAULT_BOT_ID) ?? null,
  };

  return [
    defaultEntry,
    ...store.db.bots.map((entry) => ({
      id: entry.id,
      name: entry.name,
      applicationId: entry.applicationId,
      tag: entry.id === live ? bot.tag ?? entry.tag : entry.tag,
      fingerprint: entry.fingerprint,
      isDefault: false,
      active: entry.id === live,
      addedBy: entry.addedBy,
      addedAt: entry.addedAt,
      error: lastErrors.get(entry.id) ?? null,
    })),
  ];
}

/* ---------------------------------------------------------- verification */

interface BotIdentity {
  id: string;
  username: string;
  tag: string;
}

/**
 * Checks a token with Discord before it is stored: that it works at all, and
 * that the account it belongs to is actually in this guild. Both are things
 * that would otherwise only surface as a failed swap with the rig off air.
 */
async function verifyToken(token: string): Promise<BotIdentity> {
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

  const guild = await fetch(`${API}/guilds/${config.discord.guildId}`, {
    headers: { authorization: `Bot ${token}` },
  });
  if (guild.status === 403 || guild.status === 404) {
    throw new BotError(
      `${user.username} is not in this server. Invite it with the Connect and Speak ` +
        'permissions, then add it again.',
    );
  }
  if (!guild.ok) throw new BotError(`Could not confirm server membership (HTTP ${guild.status}).`);

  return {
    id: user.id,
    username: user.username,
    tag: user.discriminator && user.discriminator !== '0'
      ? `${user.username}#${user.discriminator}`
      : user.username,
  };
}

/* -------------------------------------------------------------- mutation */

export async function add(
  user: SessionUser,
  input: { name?: string; token: string },
): Promise<BotSummary> {
  const token = input.token.trim();
  if (!token) throw new BotError('Paste the bot token.');

  const print = fingerprint(token);
  if (print === fingerprint(config.discord.playback.token)) {
    throw new BotError('That is already the default bot.');
  }
  const clash = store.db.bots.find((entry) => entry.fingerprint === print);
  if (clash) throw new BotError(`That token is already here as "${clash.name}".`);

  const identity = await verifyToken(token);

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
  store.db.bots.push(entry);
  store.save();
  log.info(`${user.displayName} added playback bot "${entry.name}" (${print})`);
  announce();

  return list().find((summary) => summary.id === entry.id) as BotSummary;
}

export async function remove(user: SessionUser, id: string): Promise<void> {
  if (id === DEFAULT_BOT_ID) throw new BotError('The default bot cannot be removed.');
  const index = store.db.bots.findIndex((entry) => entry.id === id);
  if (index < 0) throw new BotError('That bot is not on the list.');
  const [entry] = store.db.bots.splice(index, 1);

  // Removing the bot that is on air falls back to the default rather than
  // leaving the rig pointed at something that no longer exists.
  const wasActive = activeId() === id;
  store.db.activeBotId = wasActive ? null : store.db.activeBotId;
  store.save();
  lastErrors.delete(id);
  log.info(`${user.displayName} removed playback bot "${entry.name}"`);

  if (wasActive) await activate(user, DEFAULT_BOT_ID);
  else announce();
}

/**
 * Puts a different bot on air.
 *
 * Voice cannot be handed between two Discord accounts, so the connection is
 * dropped and remade: the old bot leaves the channel, the new one logs in and
 * rejoins where the old one was. The mix itself never stops — the decks keep
 * running through the silent path while the swap happens.
 */
export async function activate(user: SessionUser, id: string): Promise<void> {
  // Swaps run one at a time. Two of them interleaving would race over the
  // gateway session and could leave the rig connected as neither bot.
  const run = swapping.then(
    () => doActivate(user, id),
    () => doActivate(user, id),
  );
  swapping = run.catch(() => undefined);
  return run;
}

let swapping: Promise<void> = Promise.resolve();

async function doActivate(user: SessionUser, id: string): Promise<void> {
  const wanted = id === DEFAULT_BOT_ID ? defaultCredentials() : null;
  let credentials = wanted;

  if (!credentials) {
    const entry = store.db.bots.find((item) => item.id === id);
    if (!entry) throw new BotError('That bot is not on the list.');
    credentials = credentialsFor(entry);
    if (!credentials) {
      throw new BotError(
        `The stored token for "${entry.name}" could not be read — it was encrypted with a ` +
          'different SESSION_SECRET. Remove it and add the token again.',
      );
    }
  }

  if (activeId() === credentials.id && bot.isReady) return;

  // The engine and the command registrar are pulled in here rather than at the
  // top of the file: the engine reports which bot is on air, so importing it
  // statically would make a cycle out of what is really a one-way call.
  const { engine } = await import('../engine');
  const { registerCommands } = await import('./commands');

  // Remembered before the teardown so the new bot can pick the set back up.
  const resumeChannelId = engine.voice.snapshot().channelId;

  status = 'connecting';
  statusError = null;
  announce();

  engine.voice.leave();

  try {
    await bot.connect(credentials);
  } catch (err) {
    const message = (err as Error).message;
    lastErrors.set(credentials.id, message);
    // A refused login leaves the previous bot connected — `connect` puts it
    // back rather than leaving the rig with no gateway at all — so the failure
    // belongs against the bot that would not start, not against the rig. Put
    // the old one back in the channel it was pulled out of.
    const recovered = bot.isReady;
    status = recovered ? 'ready' : 'error';
    statusError = recovered ? null : message;
    if (recovered && resumeChannelId) {
      await engine.voice.join(resumeChannelId).catch((rejoinErr: Error) => {
        log.warn(`could not put the previous bot back in voice: ${rejoinErr.message}`);
      });
    }
    announce();
    throw new BotError(`Could not connect as "${credentials.name}": ${message}`);
  }

  lastErrors.delete(credentials.id);
  store.db.activeBotId = credentials.id === DEFAULT_BOT_ID ? null : credentials.id;
  store.save();
  status = 'ready';
  statusError = null;
  log.info(`${user.displayName} switched playback to "${credentials.name}"`);

  // Slash commands belong to an application, so they have to be registered
  // again against the one now on air.
  await registerCommands();

  if (resumeChannelId) {
    try {
      await engine.voice.join(resumeChannelId);
    } catch (err) {
      // Not fatal: the swap worked, the rejoin did not. Usually the new bot is
      // missing Connect or Speak in that particular channel.
      const message = (err as Error).message;
      statusError = `Connected, but could not rejoin voice: ${message}`;
      log.warn(`could not rejoin voice as the new bot: ${message}`);
    }
  }

  announce();
}

/** Boot: connect whichever bot was last on air, falling back to the default. */
export async function startActive(): Promise<void> {
  const id = activeId();
  const entry = id === DEFAULT_BOT_ID ? null : store.db.bots.find((item) => item.id === id);
  const credentials = entry ? credentialsFor(entry) : defaultCredentials();

  if (credentials) {
    try {
      await bot.connect(credentials);
      status = 'ready';
      statusError = null;
      return;
    } catch (err) {
      const message = (err as Error).message;
      lastErrors.set(credentials.id, message);
      log.error(`could not connect as "${credentials.name}": ${message}`);
      if (credentials.id === DEFAULT_BOT_ID) throw err;
      log.warn('falling back to the default bot');
    }
  } else if (entry) {
    log.error(`the stored token for "${entry.name}" could not be read; falling back to the default`);
    lastErrors.set(entry.id, 'The stored token could not be read.');
  }

  store.db.activeBotId = null;
  store.save();
  await bot.connect(defaultCredentials());
  status = 'ready';
  statusError = null;
}
