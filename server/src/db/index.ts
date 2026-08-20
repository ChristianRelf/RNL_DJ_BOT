import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config';
import { createLogger } from '../logger';

const log = createLogger('db');

/**
 * The database.
 *
 * SQLite through `node:sqlite` - part of the runtime, so there is no dependency
 * to audit and no native module to rebuild when the base image moves. It
 * replaces a single JSON document that was rewritten whole on every change,
 * which was fine for one guild and is not fine for twenty: two rigs saving in
 * the same tick would have raced over one file, and the last writer would have
 * quietly dropped the other's set.
 *
 * Rows that nothing is ever queried by - a media item, a queue entry - are kept
 * as JSON in one column. The shapes are already defined by the wire protocol and
 * already validated, and fifteen columns that only ever move as a unit would be
 * a schema to migrate rather than a thing to look things up by.
 */

let database: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS guilds (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  created_by            TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'active',
  active_bot_id         TEXT,
  dj_role_ids           TEXT NOT NULL DEFAULT '[]',
  admin_role_ids        TEXT NOT NULL DEFAULT '[]',
  last_voice_channel_id TEXT,
  queue_auto            INTEGER NOT NULL DEFAULT 0,
  mixer                 TEXT NOT NULL,
  tools                 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id          TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  data        TEXT NOT NULL,
  PRIMARY KEY (guild_id, id)
);
CREATE INDEX IF NOT EXISTS media_by_guild ON media (guild_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS queue (
  id       TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  data     TEXT NOT NULL,
  PRIMARY KEY (guild_id, id)
);
CREATE INDEX IF NOT EXISTS queue_by_guild ON queue (guild_id, position);

-- What the room has asked for. Kept out of the queue table on purpose: a
-- request is not a queue entry until somebody in the booth says it is, and one
-- that was declined is still worth being able to see.
CREATE TABLE IF NOT EXISTS requests (
  id       TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  at       INTEGER NOT NULL,
  data     TEXT NOT NULL,
  PRIMARY KEY (guild_id, id)
);
CREATE INDEX IF NOT EXISTS requests_by_guild ON requests (guild_id, at DESC);

CREATE TABLE IF NOT EXISTS pads (
  guild_id TEXT NOT NULL,
  idx      INTEGER NOT NULL,
  media_id TEXT,
  gain     REAL NOT NULL,
  mode     TEXT NOT NULL,
  PRIMARY KEY (guild_id, idx)
);

-- Playback bots are a platform-wide pool: one Discord account can be on air in
-- several guilds at once, so which rigs may use it is a separate question from
-- which rig is using it now.
CREATE TABLE IF NOT EXISTS bots (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  application_id TEXT NOT NULL,
  tag            TEXT,
  token          TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  added_by_id    TEXT NOT NULL,
  added_by_name  TEXT NOT NULL,
  added_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_bots (
  guild_id TEXT NOT NULL,
  bot_id   TEXT NOT NULL,
  PRIMARY KEY (guild_id, bot_id)
);

-- Who may sign in at all, before any guild has an opinion about them.
CREATE TABLE IF NOT EXISTS allowlist (
  discord_id    TEXT PRIMARY KEY,
  note          TEXT NOT NULL DEFAULT '',
  can_onboard   INTEGER NOT NULL DEFAULT 1,
  added_by      TEXT NOT NULL DEFAULT '',
  added_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  guild_id    TEXT,
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_by     TEXT,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS invites_by_guild ON invites (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id    TEXT NOT NULL,
  discord_id  TEXT NOT NULL,
  invited_by  TEXT NOT NULL,
  invited_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, discord_id)
);

CREATE TABLE IF NOT EXISTS waitlist (
  id        TEXT PRIMARY KEY,
  discord   TEXT NOT NULL,
  email     TEXT NOT NULL,
  community TEXT NOT NULL,
  size      TEXT NOT NULL DEFAULT '',
  note      TEXT NOT NULL DEFAULT '',
  at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function db(): DatabaseSync {
  if (database) return database;

  const file = path.join(config.paths.dataDir, 'deck.db');
  fs.mkdirSync(config.paths.dataDir, { recursive: true });

  database = new DatabaseSync(file);
  // WAL so a read never blocks behind a write. Several rigs save independently
  // and none of them should ever wait on another to finish.
  database.exec('PRAGMA journal_mode = WAL');
  // NORMAL rather than FULL: a crash can cost the last few hundred milliseconds
  // of knob positions, which is a fair trade against an fsync on every change.
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(SCHEMA);

  log.info(`opened ${file}`);
  return database;
}

export function meta(key: string): string | null {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, value, value);
}

export function closeDb(): void {
  database?.close();
  database = null;
}
