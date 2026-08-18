import { db } from './index';
import { DEFAULT_MIXER, DEFAULT_TOOLS, type GuildRecord, type PersistedBot, type WaitlistEntry } from '../store';

/**
 * Everything that belongs to the platform rather than to one rig: which guilds
 * exist, which Discord accounts can be played through, who may sign in at all,
 * and who has asked to.
 *
 * These are read rarely and written rarely, so unlike a guild's own state there
 * is nothing mirrored in memory — the database is simply asked.
 */

/* --------------------------------------------------------------- guilds */

interface GuildRow {
  id: string;
  slug: string;
  name: string;
  created_at: number;
  created_by: string;
  status: string;
  dj_role_ids: string;
  admin_role_ids: string;
}

function toGuild(row: GuildRow): GuildRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
    createdBy: row.created_by,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    djRoleIds: JSON.parse(row.dj_role_ids) as string[],
    adminRoleIds: JSON.parse(row.admin_role_ids) as string[],
  };
}

const GUILD_COLUMNS =
  'id, slug, name, created_at, created_by, status, dj_role_ids, admin_role_ids';

export function listGuilds(): GuildRecord[] {
  const rows = db()
    .prepare(`SELECT ${GUILD_COLUMNS} FROM guilds ORDER BY created_at`)
    .all() as unknown as GuildRow[];
  return rows.map(toGuild);
}

export function getGuild(id: string): GuildRecord | null {
  const row = db()
    .prepare(`SELECT ${GUILD_COLUMNS} FROM guilds WHERE id = ?`)
    .get(id) as unknown as GuildRow | undefined;
  return row ? toGuild(row) : null;
}

export function getGuildBySlug(slug: string): GuildRecord | null {
  const row = db()
    .prepare(`SELECT ${GUILD_COLUMNS} FROM guilds WHERE slug = ?`)
    .get(slug) as unknown as GuildRow | undefined;
  return row ? toGuild(row) : null;
}

/**
 * A slug that is safe in a URL and not already taken.
 *
 * Collisions get a numeric suffix rather than an error: two servers called
 * "The Basement" is a thing that will happen, and it is not the second one's
 * problem to solve.
 */
export function uniqueSlug(desired: string): string {
  const base =
    desired
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'rig';

  let slug = base;
  let n = 2;
  while (getGuildBySlug(slug)) slug = `${base}-${n++}`;
  return slug;
}

export function createGuild(params: {
  id: string;
  name: string;
  slug?: string;
  createdBy: string;
  djRoleIds?: string[];
  adminRoleIds?: string[];
}): GuildRecord {
  const slug = uniqueSlug(params.slug ?? params.name);
  db()
    .prepare(
      `INSERT INTO guilds (id, slug, name, created_at, created_by, status,
                           dj_role_ids, admin_role_ids, mixer, tools)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      params.id,
      slug,
      params.name.slice(0, 120),
      Date.now(),
      params.createdBy,
      JSON.stringify(params.djRoleIds ?? []),
      JSON.stringify(params.adminRoleIds ?? []),
      JSON.stringify(DEFAULT_MIXER),
      JSON.stringify(DEFAULT_TOOLS),
    );
  return getGuild(params.id) as GuildRecord;
}

export function updateGuild(
  id: string,
  patch: Partial<Pick<GuildRecord, 'name' | 'slug' | 'status' | 'djRoleIds' | 'adminRoleIds'>>,
): void {
  const current = getGuild(id);
  if (!current) return;
  db()
    .prepare(
      `UPDATE guilds SET name = ?, slug = ?, status = ?, dj_role_ids = ?, admin_role_ids = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? current.name,
      patch.slug ?? current.slug,
      patch.status ?? current.status,
      JSON.stringify(patch.djRoleIds ?? current.djRoleIds),
      JSON.stringify(patch.adminRoleIds ?? current.adminRoleIds),
      id,
    );
}

/** Removes a rig and everything belonging to it. */
export function deleteGuild(id: string): void {
  const database = db();
  database.exec('BEGIN');
  try {
    for (const table of ['media', 'queue', 'pads', 'guild_bots']) {
      database.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(id);
    }
    database.prepare('DELETE FROM guilds WHERE id = ?').run(id);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

/* ----------------------------------------------------------------- bots */

interface BotRow {
  id: string;
  name: string;
  application_id: string;
  tag: string | null;
  token: string;
  fingerprint: string;
  added_by_id: string;
  added_by_name: string;
  added_at: number;
}

function toBot(row: BotRow): PersistedBot {
  return {
    id: row.id,
    name: row.name,
    applicationId: row.application_id,
    tag: row.tag,
    token: row.token,
    fingerprint: row.fingerprint,
    addedBy: { id: row.added_by_id, name: row.added_by_name },
    addedAt: row.added_at,
  };
}

export function listBots(): PersistedBot[] {
  return (db().prepare('SELECT * FROM bots ORDER BY added_at').all() as unknown as BotRow[]).map(toBot);
}

export function getBot(id: string): PersistedBot | null {
  const row = db().prepare('SELECT * FROM bots WHERE id = ?').get(id) as unknown as BotRow | undefined;
  return row ? toBot(row) : null;
}

export function findBotByFingerprint(fingerprint: string): PersistedBot | null {
  const row = db().prepare('SELECT * FROM bots WHERE fingerprint = ?').get(fingerprint) as unknown as
    | BotRow
    | undefined;
  return row ? toBot(row) : null;
}

export function addBot(bot: PersistedBot): void {
  db()
    .prepare(
      `INSERT INTO bots (id, name, application_id, tag, token, fingerprint,
                         added_by_id, added_by_name, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      bot.id,
      bot.name,
      bot.applicationId,
      bot.tag,
      bot.token,
      bot.fingerprint,
      bot.addedBy.id,
      bot.addedBy.name,
      bot.addedAt,
    );
}

export function removeBot(id: string): void {
  const database = db();
  database.prepare('DELETE FROM guild_bots WHERE bot_id = ?').run(id);
  // A rig pointed at a bot that no longer exists falls back to the default,
  // which is the same thing that happens to an id that never resolved.
  database.prepare('UPDATE guilds SET active_bot_id = NULL WHERE active_bot_id = ?').run(id);
  database.prepare('DELETE FROM bots WHERE id = ?').run(id);
}

/* ------------------------------------------------------------ allowlist */

export interface AllowEntry {
  discordId: string;
  note: string;
  canOnboard: boolean;
  addedBy: string;
  addedAt: number;
}

export function listAllowed(): AllowEntry[] {
  const rows = db().prepare('SELECT * FROM allowlist ORDER BY added_at DESC').all() as unknown as Array<{
    discord_id: string;
    note: string;
    can_onboard: number;
    added_by: string;
    added_at: number;
  }>;
  return rows.map((r) => ({
    discordId: r.discord_id,
    note: r.note,
    canOnboard: r.can_onboard === 1,
    addedBy: r.added_by,
    addedAt: r.added_at,
  }));
}

export function isAllowed(discordId: string): AllowEntry | null {
  const row = db().prepare('SELECT * FROM allowlist WHERE discord_id = ?').get(discordId) as unknown as
    | { discord_id: string; note: string; can_onboard: number; added_by: string; added_at: number }
    | undefined;
  if (!row) return null;
  return {
    discordId: row.discord_id,
    note: row.note,
    canOnboard: row.can_onboard === 1,
    addedBy: row.added_by,
    addedAt: row.added_at,
  };
}

export function allow(entry: {
  discordId: string;
  note?: string;
  canOnboard?: boolean;
  addedBy: string;
}): void {
  db()
    .prepare(
      `INSERT INTO allowlist (discord_id, note, can_onboard, added_by, added_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(discord_id) DO UPDATE SET note = excluded.note,
                                             can_onboard = excluded.can_onboard`,
    )
    .run(
      entry.discordId,
      entry.note ?? '',
      entry.canOnboard === false ? 0 : 1,
      entry.addedBy,
      Date.now(),
    );
}

export function disallow(discordId: string): void {
  db().prepare('DELETE FROM allowlist WHERE discord_id = ?').run(discordId);
}

/* ------------------------------------------------------------- waitlist */

export function listWaitlist(): WaitlistEntry[] {
  return db().prepare('SELECT * FROM waitlist ORDER BY at DESC').all() as unknown as WaitlistEntry[];
}

export function waitlistCount(): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM waitlist').get() as unknown as { n: number };
  return row.n;
}

export function waitlistHas(discord: string, email: string): boolean {
  const row = db()
    .prepare('SELECT 1 FROM waitlist WHERE lower(discord) = ? OR lower(email) = ? LIMIT 1')
    .get(discord.toLowerCase(), email.toLowerCase());
  return Boolean(row);
}

export function addWaitlist(entry: WaitlistEntry): void {
  db()
    .prepare(
      'INSERT INTO waitlist (id, discord, email, community, size, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(entry.id, entry.discord, entry.email, entry.community, entry.size, entry.note, entry.at);
}

export function removeWaitlist(id: string): void {
  db().prepare('DELETE FROM waitlist WHERE id = ?').run(id);
}
