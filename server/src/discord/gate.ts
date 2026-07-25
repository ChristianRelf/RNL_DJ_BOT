import { config } from '../config';
import { createLogger } from '../logger';

const log = createLogger('gate');

/**
 * Membership and role lookups for the sign-in gate.
 *
 * These deliberately do not go through the gateway client: that client is the
 * *playback* bot, and an owner can point it at a different Discord account
 * mid-set. Who is allowed to sign in must not depend on which bot happens to be
 * on air, so the gate talks REST with the auth application's own token and
 * nothing else.
 *
 * No privileged intents are involved — a single-member fetch is a plain REST
 * call any bot in the guild can make.
 */

const API = 'https://discord.com/api/v10';

export interface GuildMemberInfo {
  id: string;
  displayName: string;
  roleIds: string[];
  isGuildOwner: boolean;
}

/**
 * "They are not in the guild" and "we could not find out" are different
 * answers, and telling somebody they are not a member when the truth is that
 * the gate's own token cannot read the server sends them looking in entirely
 * the wrong place. Both still fail closed — they just say so differently.
 */
export type MemberLookup =
  | { kind: 'member'; member: GuildMemberInfo }
  | { kind: 'absent' }
  | { kind: 'unavailable'; reason: string };

interface RawMember {
  nick: string | null;
  roles: string[];
  user?: { id: string; username: string; global_name: string | null };
}

/** The guild's owner, cached — it changes about once a lifetime. */
let ownerId: string | null = null;
let ownerFetchedAt = 0;
const OWNER_TTL_MS = 60 * 60 * 1000;

async function api(path: string, token = config.discord.auth.token): Promise<Response> {
  return fetch(`${API}${path}`, { headers: { authorization: `Bot ${token}` } });
}

async function guildOwnerId(): Promise<string | null> {
  if (ownerId && Date.now() - ownerFetchedAt < OWNER_TTL_MS) return ownerId;
  try {
    const res = await api(`/guilds/${config.discord.guildId}`);
    if (!res.ok) return ownerId;
    const guild = (await res.json()) as { owner_id?: string };
    ownerId = guild.owner_id ?? null;
    ownerFetchedAt = Date.now();
  } catch (err) {
    log.debug('could not read the guild owner:', (err as Error).message);
  }
  return ownerId;
}

/** Looks up a guild member. See MemberLookup for why "no" has two shapes. */
export async function member(userId: string): Promise<MemberLookup> {
  try {
    const res = await api(`/guilds/${config.discord.guildId}/members/${userId}`);

    // 404 is the only status that means what it says. Discord returns it both
    // for an unknown member and an unknown guild, but a wrong guild id would
    // have already failed the boot check with something louder.
    if (res.status === 404) return { kind: 'absent' };

    if (res.status === 401 || res.status === 403) {
      log.error(
        `membership lookup refused (HTTP ${res.status}). The sign-in token cannot read guild ` +
          `${config.discord.guildId} — invite that application's bot to the server, or unset ` +
          'AUTH_BOT_TOKEN so the playback bot answers membership checks.',
      );
      return {
        kind: 'unavailable',
        reason: 'The sign-in bot cannot read this Discord server, so your membership could not be checked. This is a rig configuration problem, not your account.',
      };
    }

    if (!res.ok) {
      log.warn(`membership lookup failed (HTTP ${res.status})`);
      return {
        kind: 'unavailable',
        reason: `Discord did not answer the membership check (HTTP ${res.status}). Try again in a moment.`,
      };
    }

    const raw = (await res.json()) as RawMember;
    return {
      kind: 'member',
      member: {
        id: userId,
        displayName: raw.nick || raw.user?.global_name || raw.user?.username || '',
        roleIds: raw.roles ?? [],
        isGuildOwner: (await guildOwnerId()) === userId,
      },
    };
  } catch (err) {
    const message = (err as Error).message;
    log.warn('membership lookup errored:', message);
    return { kind: 'unavailable', reason: `Could not reach Discord to check your membership (${message}).` };
  }
}

/**
 * Boot check: says plainly whether the token that guards sign-in can actually
 * see the guild, rather than leaving it to be discovered by the first person
 * who cannot log in.
 */
export async function verifyAuthAccess(): Promise<void> {
  try {
    const res = await api(`/guilds/${config.discord.guildId}`);
    if (res.ok) {
      const guild = (await res.json()) as { name?: string };
      log.info(`sign-in gate reading guild "${guild.name ?? config.discord.guildId}"`);
      return;
    }
    log.error(
      `the sign-in gate cannot read guild ${config.discord.guildId} (HTTP ${res.status}). ` +
        'Invite the auth application\'s bot to the server, or leave AUTH_BOT_TOKEN unset to ' +
        'use the playback bot for membership checks.',
    );
  } catch (err) {
    log.error('sign-in gate check failed:', (err as Error).message);
  }
}
