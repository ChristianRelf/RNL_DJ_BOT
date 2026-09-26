import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config, redirectUri } from './config';
import { member } from './discord/gate';
import { getGuild, isAllowed, isGuildMemberInvited } from './db/platform';
import { createLogger } from './logger';
import type { SessionUser } from './protocol';
import { billingEnabled, hasCloudEntitlement } from './billing';
import { clearSharedCookie, readCookieValues, setSharedCookie } from './cookies';

const log = createLogger('auth');

const SESSION_COOKIE = 'rnl_dj_session';
const STATE_COOKIE = 'rnl_dj_state';
const SESSION_TTL_S = 7 * 24 * 60 * 60;
/** Membership/role checks are cached briefly so every socket connect is not a REST call. */
const ACCESS_CACHE_TTL_MS = 60_000;
const STATE_CONTEXT = 'rnl-dj-oauth-state-v1\0';

/**
 * What a session is for.
 *
 * `dj` is the ordinary session: the account is active, and every rig they open
 * decides for itself whether they may drive it. `listener` is issued to
 * somebody who has not opened a full account and arrived at a rig's request page -
 * a member of the Discord server with no DJ role, who can ask for a track and
 * do nothing else. The two are told apart in the token rather than by what is
 * asked of them, so a listener cookie cannot be pointed at the console by
 * changing the URL.
 */
export type SessionScope = 'dj' | 'listener';

export interface SessionRecord {
  user: SessionUser;
  scope: SessionScope;
}

/** Membership in one guild, with no opinion about roles. */
export interface MemberResult {
  member: boolean;
  displayName: string;
  reason?: string;
}

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
 * database - there has to be someone who can let the first person in.
 */
export function isPlatformAdmin(userId: string): boolean {
  return config.access.platformAdminIds.includes(userId);
}

/**
 * May sign in at all, before any guild has an opinion. New accounts are added
 * by the OAuth callback; this lookup preserves explicit operator suspensions.
 *
 * Platform admins are exempt: locking the operator out of their own install by
 * editing a table is not a state worth being able to reach.
 */
export function maySignIn(userId: string): boolean {
  return isPlatformAdmin(userId) || isAllowed(userId)?.status === 'active';
}

/** Keyed by guild as well as user: the same person is not the same thing in two servers. */
const accessCache = new Map<string, { at: number; result: AccessResult }>();
/** The same, for plain membership - a different question with a different answer. */
const memberCache = new Map<string, { at: number; result: MemberResult }>();

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.discord.playback.applicationId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Just `identify`. Setting a rig up goes through Discord's own bot-invite
    // flow, which hands back the guild it was added to - so there is never a
    // need to list somebody's servers, or to hold a token that could.
    scope: 'identify',
    state,
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
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    log.warn('token exchange failed:', tokenRes.status, text.slice(0, 200));
    throw new Error('Discord rejected the login. Check the client secret and redirect URI.');
  }
  const token = (await tokenRes.json()) as DiscordTokenResponse;

  const userRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { authorization: `${token.token_type} ${token.access_token}` },
    signal: AbortSignal.timeout(10_000),
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
 * playing - swapping the playback bot must not change who is allowed in.
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
  if (billingEnabled && !hasCloudEntitlement(guildId) && !isPlatformAdmin(userId)) {
    return {
      allowed: false,
      isAdmin: false,
      displayName: fallbackName,
      reason: 'This rig needs an active Deck subscription.',
    };
  }
  // Account, rig and billing status are deliberately checked above the cache:
  // suspensions and failed subscriptions take effect on the very next request.
  if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.result;

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
    const hasInvitation = isGuildMemberInvited(guildId, userId);

    result = {
      allowed: isAdmin || hasDjRole || hasInvitation,
      isAdmin,
      displayName: found.displayName || fallbackName,
      reason: isAdmin || hasDjRole || hasInvitation ? undefined : 'You do not have a DJ role in that server.',
    };
  }

  accessCache.set(key, { at: Date.now(), result });
  return result;
}

/**
 * In the guild at all, whatever their roles.
 *
 * The request page's gate. Deliberately not `checkAccess` with a flag: that
 * function answers "may this person drive this rig", and quietly widening it to
 * mean two things is how a DJ-role check stops being one. Suspended rigs are
 * refused here as well - a rig somebody has turned off should not still be
 * taking requests.
 */
export async function checkMember(
  guildId: string,
  userId: string,
  fallbackName: string,
): Promise<MemberResult> {
  const key = `${guildId}:${userId}`;
  const cached = memberCache.get(key);

  const guild = getGuild(guildId);
  if (!guild || guild.status !== 'active') {
    return { member: false, displayName: fallbackName, reason: 'No such rig.' };
  }
  if (billingEnabled && !hasCloudEntitlement(guildId) && !isPlatformAdmin(userId)) {
    return { member: false, displayName: fallbackName, reason: 'This rig is not accepting requests.' };
  }
  if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) return cached.result;

  const lookup = await member(guildId, userId);
  // Same as above: an outage must not be cached as a refusal.
  if (lookup.kind === 'unavailable') {
    return { member: false, displayName: fallbackName, reason: lookup.reason };
  }

  const result: MemberResult =
    lookup.kind === 'absent'
      ? {
          member: isPlatformAdmin(userId),
          displayName: fallbackName,
          reason: 'You are not a member of that Discord server.',
        }
      : { member: true, displayName: lookup.member.displayName || fallbackName };

  memberCache.set(key, { at: Date.now(), result });
  return result;
}

export function invalidateAccess(guildId?: string, userId?: string): void {
  if (!guildId) {
    accessCache.clear();
    memberCache.clear();
    return;
  }
  if (userId) {
    accessCache.delete(`${guildId}:${userId}`);
    memberCache.delete(`${guildId}:${userId}`);
    return;
  }
  for (const cache of [accessCache, memberCache]) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${guildId}:`)) cache.delete(key);
    }
  }
}

export function avatarUrl(user: DiscordUserResponse): string | null {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
}

export function issueSession(res: Response, user: SessionUser, scope: SessionScope = 'dj'): void {
  const token = jwt.sign({ ...user, scope }, config.http.sessionSecret, {
    algorithm: 'HS256',
    expiresIn: SESSION_TTL_S,
  });
  // Set on the parent so one sign-in covers the portal subdomain too.
  setSharedCookie(res, SESSION_COOKIE, token, SESSION_TTL_S * 1000);
}

export function clearSession(res: Response): void {
  clearSharedCookie(res, SESSION_COOKIE);
}

/**
 * The OAuth state, and where to land afterwards.
 *
 * Both in the one cookie because they have the same lifetime and the same
 * one reader. The return path never crosses Discord - it is not in the state
 * parameter - so it cannot be set by whoever sends somebody the login link.
 */
export function setStateCookie(res: Response, state: string, next?: string): void {
  const payload = next ? `${state}:${Buffer.from(next).toString('base64url')}` : state;
  const signature = crypto
    .createHmac('sha256', config.http.sessionSecret)
    .update(STATE_CONTEXT)
    .update(payload)
    .digest('base64url');
  setSharedCookie(res, STATE_COOKIE, `${payload}.${signature}`, 10 * 60 * 1000);
}

export function clearStateCookie(res: Response): void {
  clearSharedCookie(res, STATE_COOKIE);
}

/**
 * Splits the state cookie back up. The path is only ever handed back as a
 * same-site path - anything that is not one is dropped rather than corrected,
 * so a mangled cookie sends somebody to the front door instead of somewhere
 * off the site.
 */
export function readStateCookie(value: string | undefined): { state: string; next: string | null } {
  if (!value) return { state: '', next: null };
  const signedAt = value.lastIndexOf('.');
  if (signedAt < 1) return { state: '', next: null };
  const payload = value.slice(0, signedAt);
  const supplied = Buffer.from(value.slice(signedAt + 1), 'base64url');
  const expected = crypto
    .createHmac('sha256', config.http.sessionSecret)
    .update(STATE_CONTEXT)
    .update(payload)
    .digest();
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return { state: '', next: null };
  }

  const cut = payload.indexOf(':');
  if (cut < 0) return { state: payload, next: null };
  let next: string | null = null;
  try {
    const decoded = Buffer.from(payload.slice(cut + 1), 'base64url').toString('utf8');
    // A single leading slash, and no second one: `//elsewhere` is a URL with
    // the scheme left off, and handing that to a redirect leaves the site.
    if (/^\/(?!\/)[\w\-/]*$/.test(decoded)) next = decoded;
  } catch {
    next = null;
  }
  return { state: payload.slice(0, cut), next };
}

export function readSessionToken(
  cookieHeader: string | undefined,
  name = SESSION_COOKIE,
): string | null {
  return readCookieValues(cookieHeader, name)[0] ?? null;
}

/**
 * The session, as identity only.
 *
 * `isAdmin` is deliberately not carried here any more. It used to be baked in
 * at sign-in, which was true of a rig that served one guild and is a lie in a
 * process that serves twenty - a token cannot say "admin" without saying where.
 * It is resolved per connection instead, against the guild being connected to.
 */
export function verifySession(token: string | null | undefined): SessionUser | null {
  const session = readSession(token);
  // Only a DJ session is a session as far as the rest of the server is
  // concerned. Every console path - the socket handshake, every rig route -
  // asks this one question, so a listener token is refused by all of them
  // without any of them having to know that listeners exist.
  return session && session.scope === 'dj' && maySignIn(session.user.id) ? session.user : null;
}

/** Resolve a socket handshake even when a legacy cookie duplicates the current one. */
export function verifySessionCookies(cookieHeader: string | undefined): SessionUser | null {
  const sessions = readCookieValues(cookieHeader, SESSION_COOKIE)
    .map((token, index) => ({ user: verifySession(token), issuedAt: sessionIssuedAt(token), index }))
    .filter(
      (candidate): candidate is { user: SessionUser; issuedAt: number; index: number } =>
        Boolean(candidate.user),
    )
    // Cookie headers put older same-path cookies first. When two sessions were
    // issued in the same second, prefer the later value (normally the shared
    // cookie just written by the callback).
    .sort((a, b) => b.issuedAt - a.issuedAt || b.index - a.index);
  return sessions[0]?.user ?? null;
}

/** Used only after signature verification, to prefer a newly issued shared cookie. */
function sessionIssuedAt(token: string): number {
  if (token.length > 4096) return 0;
  try {
    const payload = jwt.decode(token);
    return payload && typeof payload !== 'string' && typeof payload.iat === 'number'
      ? payload.iat
      : 0;
  } catch {
    return 0;
  }
}

/** The session as it actually is, scope and all. Only the request page wants this. */
export function readSession(token: string | null | undefined): SessionRecord | null {
  if (!token || token.length > 4096) return null;
  try {
    const payload = jwt.verify(token, config.http.sessionSecret, {
      algorithms: ['HS256'],
    }) as SessionUser & {
      scope?: SessionScope;
      iat: number;
      exp: number;
    };
    if (
      typeof payload.id !== 'string' ||
      !payload.id ||
      typeof payload.username !== 'string' ||
      typeof payload.displayName !== 'string' ||
      (payload.avatarUrl !== null && typeof payload.avatarUrl !== 'string')
    ) {
      return null;
    }
    return {
      // Cookies issued before scopes existed carry none, and every one of them
      // was a DJ session.
      scope: payload.scope === 'listener' ? 'listener' : 'dj',
      user: {
        id: payload.id,
        username: payload.username,
        displayName: payload.displayName,
        avatarUrl: payload.avatarUrl ?? null,
        isAdmin: false,
        // Read from configuration rather than trusted from the token, so adding
        // or removing a platform admin takes effect without waiting for sessions
        // to expire - in both directions.
        isPlatformAdmin: isPlatformAdmin(payload.id),
      },
    };
  } catch {
    return null;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
    /** Whoever is signed in, listeners included. Only the request routes read it. */
    session?: SessionRecord;
  }
}

export function attachUser(req: Request, res: Response, next: NextFunction): void {
  // A browser may retain both an old host-only cookie and the current
  // parent-domain cookie. cookie-parser keeps only the first; inspect every
  // candidate so an invalid legacy value cannot mask the valid shared one.
  const candidates = readCookieValues(req.headers.cookie, SESSION_COOKIE);
  if (candidates.length === 0 && typeof req.cookies?.[SESSION_COOKIE] === 'string') {
    candidates.push(req.cookies[SESSION_COOKIE]);
  }
  const sessions = candidates
    .map((token, index) => ({ record: readSession(token), issuedAt: sessionIssuedAt(token), index }))
    .filter(
      (candidate): candidate is { record: SessionRecord; issuedAt: number; index: number } =>
        Boolean(candidate.record),
    )
    .sort((a, b) => b.issuedAt - a.issuedAt || b.index - a.index);
  // Prefer the full account when an old listener cookie and the shared DJ
  // cookie arrive together. With only one cookie this preserves normal scope.
  const session =
    sessions.find(
      (candidate) =>
        candidate.record.scope === 'dj' && maySignIn(candidate.record.user.id),
    )?.record ?? sessions[0]?.record;
  const signedIn = session?.scope === 'dj' && maySignIn(session.user.id);

  // Expired, malformed, rotated-secret and suspended-account DJ cookies should
  // not keep coming back on every request or obscure the next successful login.
  if ((candidates.length > 0 && sessions.length === 0) || (session?.scope === 'dj' && !signedIn)) {
    clearSession(res);
  }

  req.session = session?.scope === 'dj' && !signedIn ? undefined : session;
  req.user = signedIn ? session.user : undefined;
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
