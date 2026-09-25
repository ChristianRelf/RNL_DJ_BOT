import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const tempRoot = path.resolve(os.tmpdir());
const dataDir = fs.mkdtempSync(path.join(tempRoot, 'rnl-billing-'));

try {
  // Represents a database created before account suspension and billing existed.
  const legacy = new DatabaseSync(path.join(dataDir, 'deck.db'));
  legacy.exec(`CREATE TABLE allowlist (
    discord_id TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    can_onboard INTEGER NOT NULL DEFAULT 1,
    added_by TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL
  );
  CREATE TABLE cloud_media (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE TABLE cloud_cache_metrics (
    guild_id TEXT PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    misses INTEGER NOT NULL DEFAULT 0,
    resumed_bytes INTEGER NOT NULL DEFAULT 0,
    evictions INTEGER NOT NULL DEFAULT 0,
    corruptions INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`);
  legacy.close();

  process.env.DATA_DIR = dataDir;
  process.env.DISCORD_BOT_TOKEN = 'test';
  process.env.DISCORD_CLIENT_ID = '123';
  process.env.DISCORD_CLIENT_SECRET = 'test';
  process.env.SESSION_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
  process.env.PLATFORM_ADMIN_IDS = '123456789012345';

  const database = require('../dist/db');
  const platform = require('../dist/db/platform');
  const billing = require('../dist/billing');
  const cloud = require('../dist/cloudMedia');
  const opened = database.db();

  const columns = opened.prepare('PRAGMA table_info(allowlist)').all().map((row) => row.name);
  if (!columns.includes('status')) throw new Error('allowlist status migration missing');
  if (!opened.prepare("SELECT name FROM sqlite_master WHERE name = 'billing_accounts'").get()) {
    throw new Error('billing table missing');
  }
  const cloudColumns = opened.prepare('PRAGMA table_info(cloud_media)').all().map((row) => row.name);
  for (const required of ['etag', 'sha256', 'verified_at', 'error']) {
    if (!cloudColumns.includes(required)) throw new Error(`cloud_media ${required} migration missing`);
  }
  if (!opened.prepare("SELECT name FROM sqlite_master WHERE name = 'cloud_cache_metrics'").get()) {
    throw new Error('cloud cache metrics table missing');
  }
  const metricColumns = opened.prepare('PRAGMA table_info(cloud_cache_metrics)').all().map((row) => row.name);
  for (const required of ['cdn_bytes', 'origin_bytes']) {
    if (!metricColumns.includes(required)) throw new Error(`cloud_cache_metrics ${required} migration missing`);
  }

  platform.allow({
    discordId: '123456789012346',
    note: 'migration test',
    addedBy: '123456789012345',
  });
  if (platform.isAllowed('123456789012346')?.status !== 'active') {
    throw new Error('new account was not active');
  }
  if (!billing.hasCloudEntitlement('self-hosted-test')) {
    throw new Error('self-hosted entitlement fallback failed');
  }
  cloud.recordCloudCacheMetrics('self-hosted-test', { hits: 2, misses: 1, resumedBytes: 4096, originBytes: 8192 });
  const metrics = cloud.cloudCacheMetrics('self-hosted-test');
  if (metrics.hits !== 2 || metrics.misses !== 1 || metrics.resumedBytes !== 4096 || metrics.originBytes !== 8192) {
    throw new Error('cloud cache metric aggregation failed');
  }

  database.closeDb();
  console.log('billing/cloud schema migration, metrics, and entitlement fallback: ok');
} finally {
  const resolved = path.resolve(dataDir);
  if (resolved.startsWith(tempRoot + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
}
