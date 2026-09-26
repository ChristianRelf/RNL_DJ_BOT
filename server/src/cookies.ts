import type { CookieOptions, Response } from 'express';
import { config } from './config';

/**
 * Every authentication cookie uses one policy. Keeping this here prevents a
 * callback from setting a parent-domain cookie and later trying to clear a
 * host-only cookie with the same name (which leaves the real cookie behind).
 */
const BASE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.http.publicUrl.startsWith('https://'),
  path: '/',
};

function sharedOptions(): CookieOptions {
  return {
    ...BASE_OPTIONS,
    ...(config.http.cookieDomain ? { domain: config.http.cookieDomain } : {}),
  };
}

/**
 * Set a cookie on the configured shared domain. Before doing that, expire an
 * old host-only cookie with the same name. Both can otherwise be sent in one
 * Cookie header, where the older value can hide a freshly issued session.
 */
export function setSharedCookie(
  res: Response,
  name: string,
  value: string,
  maxAge: number,
): void {
  if (config.http.cookieDomain) res.clearCookie(name, BASE_OPTIONS);
  res.cookie(name, value, { ...sharedOptions(), maxAge, priority: 'high' });
}

/** Clear both the current shared cookie and any legacy host-only variant. */
export function clearSharedCookie(res: Response, name: string): void {
  res.clearCookie(name, sharedOptions());
  if (config.http.cookieDomain) res.clearCookie(name, BASE_OPTIONS);
}

/**
 * Return every value for a cookie name. Browsers may send both a host-only and
 * a parent-domain cookie with that name, while ordinary cookie parsers keep
 * only one of them.
 */
export function readCookieValues(cookieHeader: string | undefined, name: string): string[] {
  if (!cookieHeader) return [];
  const values: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0 || part.slice(0, idx).trim() !== name) continue;
    try {
      values.push(decodeURIComponent(part.slice(idx + 1).trim()));
    } catch {
      // A malformed percent escape is not allowed to abort a request or a
      // Socket.IO handshake. Ignore it and inspect any duplicate candidate.
    }
  }
  return values;
}
