import { config } from '../config';
import { createLogger } from '../logger';

const log = createLogger('gate');

/**
 * Membership and role lookups for the sign-in gate.
 *
 * These deliberately do not go through the gateway client. That client is
 * whichever playback bot is currently on air, and a rig can be pointed at a
 * different Discord account mid-set - who is allowed to sign in must not depend
 * on which account happens to be speaking. So the gate talks REST with the
 * token from the environment, which is the one bot that is in every server this
 * runs for, and it does not change.
 *
 * No privileged intents are involved - a single-member fetch is a plain REST
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
 * the wrong place. Both still fail closed - they just say so differently.
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

/** Each guild's owner, cached - it changes about once a lifetime. */
const owners = new Map<string, { id: string | null; at: number }>();
const OWNER_TTL_MS = 60 * 60 * 1000;

async function api(path: string, token = config.discord.playback.token): Promise<Response> {
  return fetch(`${API}${path}`, { headers: { authorization: `Bot ${token}` } });
}

async function guildOwnerId(guildId: string): Promise<string | null> {
  const cached = owners.get(guildId);
  if (cached && Date.now() - cached.at < OWNER_TTL_MS) return cached.id;
  try {
    const res = await api(`/guilds/${guildId}`);
    if (!res.ok) return cached?.id ?? null;
    const guild = (await res.json()) as { owner_id?: string };
    owners.set(guildId, { id: guild.owner_id ?? null, at: Date.now() });
  } catch (err) {
    log.debug('could not read the guild owner:', (err as Error).message);
  }
  return owners.get(guildId)?.id ?? null;
}

/** Looks up a guild member. See MemberLookup for why "no" has two shapes. */
export async function member(guildId: string, userId: string): Promise<MemberLookup> {
  try {
    const res = await api(`/guilds/${guildId}/members/${userId}`);

    // 404 is the only status that means what it says. Discord returns it both
    // for an unknown member and an unknown guild, but a wrong guild id would
    // have already failed the boot check with something louder.
    if (res.status === 404) return { kind: 'absent' };

    if (res.status === 401 || res.status === 403) {
      log.error(
        `membership lookup refused (HTTP ${res.status}). deck cannot read guild ${guildId} - ` +
          'it has probably been removed from that server. Re-invite it, or delete the rig.',
      );
      return {
        kind: 'unavailable',
        reason: 'deck cannot read that Discord server, so your membership could not be checked. That is a problem with the rig, not with your account.',
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
        isGuildOwner: (await guildOwnerId(guildId)) === userId,
      },
    };
  } catch (err) {
    const message = (err as Error).message;
    log.warn('membership lookup errored:', message);
    return { kind: 'unavailable', reason: `Could not reach Discord to check your membership (${message}).` };
  }
}

/**
 * Startup check: says plainly whether deck can actually see a guild, rather
 * than leaving it to be discovered by the first person who cannot log in.
 *
 * Nearly always true now that onboarding invites the bot itself - but a bot can
 * be kicked from a server without anybody telling the rig, and that is exactly
 * the case worth naming in a log rather than in a support message.
 */
export async function verifyAuthAccess(guildId: string): Promise<boolean> {
  try {
    const res = await api(`/guilds/${guildId}`);
    if (res.ok) {
      const guild = (await res.json()) as { name?: string };
      log.info(`sign-in gate reading guild "${guild.name ?? guildId}"`);
      return true;
    }
    log.error(
      `the sign-in gate cannot read guild ${guildId} (HTTP ${res.status}). deck is not in that ` +
        'server, so nobody there will be able to sign in - re-invite it, or delete the rig.',
    );
  } catch (err) {
    log.error('sign-in gate check failed:', (err as Error).message);
  }
  return false;
}

export interface GuildInfo {
  id: string;
  name: string;
  ownerId: string | null;
  iconUrl: string | null;
}

/** What a guild is called, for naming a rig without asking anyone to type it. */
export async function guildInfo(guildId: string): Promise<GuildInfo | null> {
  try {
    const res = await api(`/guilds/${guildId}`);
    if (!res.ok) return null;
    const guild = (await res.json()) as { id: string; name: string; owner_id?: string; icon?: string };
    return {
      id: guild.id,
      name: guild.name,
      ownerId: guild.owner_id ?? null,
      iconUrl: guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
        : null,
    };
  } catch (err) {
    log.debug('could not read guild:', (err as Error).message);
    return null;
  }
}

export interface RoleInfo {
  id: string;
  name: string;
  color: number;
  /** Everyone has this one, so offering it as "the DJ role" would be a no-op. */
  isEveryone: boolean;
}

/**
 * The roles somebody can pick from when setting a rig up.
 *
 * Managed roles are left out: those belong to integrations and bots, nobody
 * hands them to a person, and a list with fifteen of them in is harder to read
 * than one without.
 */
export async function guildRoles(guildId: string): Promise<RoleInfo[]> {
  try {
    const res = await api(`/guilds/${guildId}/roles`);
    if (!res.ok) return [];
    const roles = (await res.json()) as Array<{
      id: string;
      name: string;
      color: number;
      managed?: boolean;
      position: number;
    }>;
    return roles
      .filter((role) => !role.managed)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        isEveryone: role.id === guildId,
      }));
  } catch (err) {
    log.debug('could not read roles:', (err as Error).message);
    return [];
  }
}
