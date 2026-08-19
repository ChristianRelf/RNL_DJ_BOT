/**
 * Which rigs this account can open.
 *
 * The console is addressed by slug — `/g/nightshift/deck` — because a Discord
 * snowflake in a URL is a thing nobody can read or type. The slug is resolved
 * to a guild id once, here, and everything below works in ids: the socket
 * handshake, the API paths, the rooms the server broadcasts into.
 */

export interface RigSummary {
  id: string;
  slug: string;
  name: string;
  isAdmin: boolean;
  running: boolean;
  hosted: boolean;
  live: boolean;
}

export async function fetchRigs(): Promise<RigSummary[]> {
  const res = await fetch('/api/rigs', { credentials: 'include' });
  if (!res.ok) throw new Error(res.status === 401 ? 'Not signed in.' : 'Could not load your rigs.');
  const body = (await res.json()) as { rigs: RigSummary[] };
  return body.rigs ?? [];
}

/** The API prefix for one rig. Every guild-scoped endpoint hangs off this. */
export function apiBase(guildId: string): string {
  return `/api/g/${encodeURIComponent(guildId)}`;
}

/** `/g/<slug>`, `/g/<slug>/deck` or `/g/<slug>/tools`. Null for anything else. */
export function parseRigPath(pathname: string): { slug: string; view: 'console' | 'tools' } | null {
  const match = /^\/g\/([a-z0-9-]+)(?:\/(deck|tools))?$/i.exec(pathname.replace(/\/+$/, ''));
  if (!match) return null;
  return { slug: match[1].toLowerCase(), view: match[2] === 'tools' ? 'tools' : 'console' };
}

/**
 * `/g/<slug>/request`, or the short `/<slug>/request` — the form that gets read
 * out in a voice channel. Null for anything else.
 *
 * The short form is safe to take literally because of the `/request` on the
 * end: no front-of-house page is two segments deep ending in that word, so
 * there is nothing for a slug to shadow.
 */
export function parseRequestPath(pathname: string): string | null {
  const match = /^\/(?:g\/)?([a-z0-9-]+)\/request$/i.exec(pathname.replace(/\/+$/, ''));
  return match ? match[1].toLowerCase() : null;
}
