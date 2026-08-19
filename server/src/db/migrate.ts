import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { createLogger } from '../logger';
import { db, meta, setMeta } from './index';
import * as platform from './platform';
import { DEFAULT_MIXER, DEFAULT_TOOLS, type PersistedBot, type WaitlistEntry } from '../store';
import type { MediaItem, MixerState, PadMode, QueueItem, ToolsState } from '../protocol';

const log = createLogger('migrate');

const DONE_KEY = 'imported:db.json';

/** The single-guild document this replaces. */
interface LegacyDb {
  media?: Record<string, MediaItem>;
  mixer?: MixerState;
  tools?: ToolsState;
  pads?: Array<{ mediaId: string | null; gain: number; mode: PadMode }>;
  lastVoiceChannelId?: string | null;
  queue?: { items?: QueueItem[]; auto?: boolean };
  waitlist?: WaitlistEntry[];
  bots?: PersistedBot[];
  activeBotId?: string | null;
}

/**
 * Brings a single-guild `db.json` into the database, once.
 *
 * The file is left where it is rather than deleted. It is the only copy of a
 * library's tempos and cue points, this runs unattended on somebody's server,
 * and "it imported, then something else failed, and now the original is gone"
 * is not a position to put anyone in. A meta key stops it running twice.
 */
export function importLegacyDb(): void {
  if (meta(DONE_KEY)) return;

  const file = path.join(config.paths.dataDir, 'db.json');
  if (!fs.existsSync(file)) {
    setMeta(DONE_KEY, String(Date.now()));
    return;
  }

  const guildId = config.discord.guildId;
  if (!guildId) {
    log.warn(
      'found a db.json but DISCORD_GUILD_ID is not set, so there is nothing to attach it to. ' +
        'Set it once to import, or delete the file if the rig is being started fresh.',
    );
    return;
  }

  let legacy: LegacyDb;
  try {
    legacy = JSON.parse(fs.readFileSync(file, 'utf8')) as LegacyDb;
  } catch (err) {
    log.error(`could not read db.json: ${(err as Error).message} - leaving it alone`);
    return;
  }

  const database = db();
  const media = Object.values(legacy.media ?? {});
  const queue = (legacy.queue?.items ?? []).filter((entry) => entry?.mediaId);

  database.exec('BEGIN');
  try {
    if (!platform.getGuild(guildId)) {
      platform.createGuild({
        id: guildId,
        name: 'Deck',
        createdBy: config.access.platformAdminIds[0] ?? '',
        djRoleIds: config.access.djRoleIds,
        adminRoleIds: config.access.adminRoleIds,
      });
    }

    database
      .prepare(
        `UPDATE guilds SET mixer = ?, tools = ?, queue_auto = ?,
                last_voice_channel_id = ?, active_bot_id = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify({ ...DEFAULT_MIXER, ...(legacy.mixer ?? {}) }),
        JSON.stringify({ ...DEFAULT_TOOLS, ...(legacy.tools ?? {}) }),
        legacy.queue?.auto ? 1 : 0,
        legacy.lastVoiceChannelId ?? null,
        legacy.activeBotId ?? null,
        guildId,
      );

    const insertMedia = database.prepare(
      `INSERT INTO media (id, guild_id, uploaded_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, id) DO NOTHING`,
    );
    for (const item of media) {
      if (!item?.id) continue;
      insertMedia.run(item.id, guildId, item.uploadedAt ?? 0, JSON.stringify(item));
    }

    const insertQueue = database.prepare(
      'INSERT INTO queue (id, guild_id, position, data) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    );
    queue.forEach((entry, index) => {
      insertQueue.run(entry.id, guildId, index, JSON.stringify(entry));
    });

    const insertPad = database.prepare(
      `INSERT INTO pads (guild_id, idx, media_id, gain, mode) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, idx) DO NOTHING`,
    );
    (legacy.pads ?? []).forEach((pad, index) => {
      if (index > 7) return;
      insertPad.run(guildId, index, pad?.mediaId ?? null, pad?.gain ?? 0.9, pad?.mode ?? 'oneshot');
    });

    for (const bot of legacy.bots ?? []) {
      if (!bot?.id) continue;
      if (platform.getBot(bot.id)) continue;
      platform.addBot(bot);
      database
        .prepare('INSERT INTO guild_bots (guild_id, bot_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
        .run(guildId, bot.id);
    }

    for (const entry of legacy.waitlist ?? []) {
      if (!entry?.id) continue;
      database
        .prepare(
          `INSERT INTO waitlist (id, discord, email, community, size, note, at)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .run(entry.id, entry.discord, entry.email, entry.community, entry.size, entry.note, entry.at);
    }

    // Whoever the rig already answered to keeps their access, so an import does
    // not lock the operator out of their own server on the next restart.
    for (const id of new Set([...config.access.platformAdminIds, ...config.access.adminUserIds])) {
      platform.allow({ discordId: id, note: 'imported from .env', addedBy: 'import' });
    }

    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    log.error(`import failed, db.json left untouched: ${(err as Error).message}`);
    return;
  }

  setMeta(DONE_KEY, String(Date.now()));
  log.info(
    `imported db.json into guild ${guildId}: ${media.length} media, ${queue.length} queued. ` +
      'The file is left in place; it is no longer read.',
  );
}
