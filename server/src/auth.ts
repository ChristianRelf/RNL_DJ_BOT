import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config, redirectUri } from './config';
import { member } from './discord/gate';
import { getGuild, isAllowed } from './db/platform';
import { createLogger } from './logger';
import type { SessionUser } from './protocol';

const log = createLogger('auth');

const SESSION_COOKIE = 'rnl_dj_session';
const STATE_COOKIE = 'rnl_dj_state';
const SESSION_TTL_S = 7 * 24 * 60 * 60;
/** Membership/role checks are cached briefly so every socket connect is not a REST call. */
const ACCESS_CACHE_TTL_MS = 60_000;

export interface AccessResult {
  allowed: boolean;
  /** Per guild: may force-take control and delete anyone's media. */
  isAdmin: boolean;
  displayName: string;
  reason?: string;
}

/**
 * Runs the platform: the portal, the allowlist, the bot pool, every rig.
 *
 * Configured by id rather than stored, so it holds even against an empty
 * database — there has to be someone who can let the first person in.
 */
export function isPlatformAdmin(userId: string): boolean {
  return config.access.platformAdminIds.includes(userId);
}

/**
 * May sign in at all, before any guild has an opinion.
 *
 * Platform admins are exempt: locking the operator out of their own install by
 * editing a table is not a state worth being able to reach.
 */
export function maySignIn(userId: string): boolean {
  return isPlatformAdmin(userId) || isAllowed(userId) !== null;
}

/** Keyed by guild as well as user: the same person is not the same thing in two servers. */
const accessCache = new Map<string, { at: number; result: AccessResult }>();

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.discord.playback.applicationId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Just `identify`. Setting a rig up goes through Discord's own bot-invite
    // flow, which hands back the guild it was added to — so there is never a
    // need to list somebody's servers, or to hold a token that could.
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export function newState(): string {
  return crypto.randomBytes(24).toString('base64url');
}

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name: string | null;
  discriminator: string;
  avatar: string | null;
}

export interface ExchangeResult {
  profile: DiscordUserResponse;
  /**
   * Discarded immediately by the only caller. It is returned rather than
   * dropped here so that the one place a token could be kept is a decision
   * somebody has to make on purpose, in the open.
   */
  accessToken: string;
}

export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    client_id: config.discord.playback.applicationId,
    client_secret: config.discord.playback.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    log.warn('token exchange failed:', tokenRes.status, text.slice(0, 200));
    throw new Error('Discord rejected the login. Check the client secret and redirect URI.');
  }
  const token = (await tokenRes.json()) as DiscordTokenResponse;

  const userRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { authorization: `${token.token_type} ${token.access_token}` },
  });
  if (!userRes.ok) throw new Error('Could not read your Discord profile.');
  return {
    profile: (await userRes.json()) as DiscordUserResponse,
    accessToken: token.access_token,
  };
}

/**
 * Membership + role gate for one guild.
 *
 * The auth application's token is the source of truth, never the bot currently
 * playing — swapping the playback bot must not change who is allowed in.
 *
 * Roles are read from the rig's own record rather than from the environment,
 * because "the DJ role" means a different id in every server.
 */
export async function checkAccess(
  guildId: string,
  userId: string,
  fallbackName: string,
): Promise<AccessResult> {
  const key = `${guildId}:${userId}`;
  const cached = accessCache.get(key);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.result;

  const guild = getGuild(guildId);
  if (!guild) {
    return { allowed: false, isAdmin: false, displayName: fallbackName, reason: 'No such rig.' };
  }
  if (guild.status === 'suspended') {
    return {
      allowed: false,
      isAdmin: false,
      displayName: fallbackName,
      reason: 'This rig has been suspended.',
    };
  }

  const lookup = await member(guildId, userId);
  let result: AccessResult;

  if (lookup.kind === 'unavailable') {
    // Not cached: a lookup that failed for an operational reason must not lock
    // somebody out for the next minute once it starts working again.
    return {
      allowed: false,
      isAdmin: false,
      displayName: fallbackName,
      reason: lookup.reason,
    };
  }

  if (lookup.kind === 'absent') {
    result = {
      allowed: false,
      isAdmin: isPlatformAdmin(userId),
      displayName: fallbackName,
      reason: 'You are not a member of that Discord server.',
    };
  } else {
    const found = lookup.member;
    const roleIds = new Set(found.roleIds);
    const isAdmin =
      isPlatformAdmin(userId) ||
      found.isGuildOwner ||
      guild.adminRoleIds.some((id) => roleIds.has(id));
    const hasDjRole =
      guild.djRoleIds.length === 0 || guild.djRoleIds.some((id) => roleIds.has(id));

    result = {
      allowed: isAdmin || hasDjRole,
      isAdmin,
      displayName: found.displayName || fallbackName,
      reason: isAdmin || hasDjRole ? undefined : 'You do not have a DJ role in that server.',
    };
  }

  accessCache.set(key, { at: Date.now(), result });
  return result;
}

export function invalidateAccess(guildId?: string, userId?: string): void {
  if (!guildId) {
    accessCache.clear();
    return;
  }
  if (userId) {
    accessCache.delete(`${guildId}:${userId}`);
    return;
  }
  for (const key of accessCache.keys()) {
    if (key.startsWith(`${guildId}:`)) accessCache.delete(key);
  }
}

export function avatarUrl(user: DiscordUserResponse): string | null {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
}

export function issueSession(res: Response, user: SessionUser): void {
  const token = jwt.sign(user, config.http.sessionSecret, { expiresIn: SESSION_TTL_S });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.http.publicUrl.startsWith('https://'),
    maxAge: SESSION_TTL_S * 1000,
    path: '/',
    // Set on the parent so one sign-in covers the portal subdomain too.
    ...(config.http.cookieDomain ? { domain: config.http.cookieDomain } : {}),
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    path: '/',
    ...(config.http.cookieDomain ? { domain: config.http.cookieDomain } : {}),
  });
}

export function setStateCookie(res: Response, state: string): void {
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.http.publicUrl.startsWith('https://'),
    maxAge: 10 * 60 * 1000,
    path: '/',
    ...(config.http.cookieDomain ? { domain: config.http.cookieDomain } : {}),
  });
}

export function readSessionToken(
  cookieHeader: string | undefined,
  name = SESSION_COOKIE,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/**
 * The session, as identity only.
 *
 * `isAdmin` is deliberately not carried here any more. It used to be baked in
 * at sign-in, which was true of a rig that served one guild and is a lie in a
 * process that serves twenty — a token cannot say "admin" without saying where.
 * It is resolved per connection instead, against the guild being connected to.
 */
export function verifySession(token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.http.sessionSecret) as SessionUser & {
      iat: number;
      exp: number;
    };
    return {
      id: payload.id,
      username: payload.username,
      displayName: payload.displayName,
      avatarUrl: payload.avatarUrl ?? null,
      isAdmin: false,
      // Read from configuration rather than trusted from the token, so adding
      // or removing a platform admin takes effect without waiting for sessions
      // to expire — in both directions.
      isPlatformAdmin: isPlatformAdmin(payload.id),
    };
  } catch {
    return null;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  req.user = verifySession(req.cookies?.[SESSION_COOKIE]) ?? undefined;
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  next();
}

/** Guards the portal, and everything that holds bot tokens. */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  if (!isPlatformAdmin(req.user.id)) {
    res.status(403).json({ error: 'That is not yours to manage.' });
    return;
  }
  next();
}

export const cookieNames = { session: SESSION_COOKIE, state: STATE_COOKIE };
