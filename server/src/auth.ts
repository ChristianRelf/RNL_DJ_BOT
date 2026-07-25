import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config, redirectUri } from './config';
import { bot } from './discord/bot';
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
  isAdmin: boolean;
  displayName: string;
  reason?: string;
}

const accessCache = new Map<string, { at: number; result: AccessResult }>();

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
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

export async function exchangeCode(code: string): Promise<DiscordUserResponse> {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
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
  return (await userRes.json()) as DiscordUserResponse;
}

/** Guild membership + role gate. The bot token is the source of truth here. */
export async function checkAccess(userId: string, fallbackName: string): Promise<AccessResult> {
  const cached = accessCache.get(userId);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.result;

  const member = await bot.member(userId);
  let result: AccessResult;

  if (!member) {
    result = {
      allowed: false,
      isAdmin: false,
      displayName: fallbackName,
      reason: 'You are not a member of the DJ server.',
    };
  } else {
    const roleIds = new Set(member.roles.cache.map((r) => r.id));
    const isAdmin =
      config.access.adminUserIds.includes(userId) ||
      config.access.adminRoleIds.some((id) => roleIds.has(id)) ||
      member.id === member.guild.ownerId;
    const hasDjRole =
      config.access.djRoleIds.length === 0 || config.access.djRoleIds.some((id) => roleIds.has(id));

    result = {
      allowed: isAdmin || hasDjRole,
      isAdmin,
      displayName: member.displayName || fallbackName,
      reason: isAdmin || hasDjRole ? undefined : 'You do not have a DJ role in this server.',
    };
  }

  accessCache.set(userId, { at: Date.now(), result });
  return result;
}

export function invalidateAccess(userId?: string): void {
  if (userId) accessCache.delete(userId);
  else accessCache.clear();
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
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function setStateCookie(res: Response, state: string): void {
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.http.publicUrl.startsWith('https://'),
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
}

export function readSessionToken(cookieHeader: string | undefined, name = SESSION_COOKIE): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

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
      isAdmin: payload.isAdmin,
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

export const cookieNames = { session: SESSION_COOKIE, state: STATE_COOKIE };
