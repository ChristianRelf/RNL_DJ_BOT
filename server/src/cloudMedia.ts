import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';
import { db } from './db';
import { billingEnabled, billingSummary, hasCloudEntitlement, storageLimitBytes } from './billing';
import { createLogger } from './logger';
import { decodeQueue, decodeToPcm } from './audio/transcode';

const log = createLogger('cloud');

export interface CloudMediaItem {
  id: string; guildId: string; key: string; name: string; sizeBytes: number;
  contentType: string; createdBy: string; createdAt: number;
  status: 'pending' | 'ready' | 'error';
  etag: string | null;
  sha256: string | null;
  verifiedAt: number | null;
  error: string | null;
}

export interface CloudCacheMetricDelta {
  hits?: number;
  misses?: number;
  resumedBytes?: number;
  evictions?: number;
  corruptions?: number;
  downloads?: number;
  downloadedBytes?: number;
  cdnBytes?: number;
  originBytes?: number;
}

const localCloudDir = (process.env.CLOUD_LOCAL_DIR ?? '').trim();
export const spacesEnabled = Boolean(localCloudDir || config.spaces.bucket);

const client = !localCloudDir && config.spaces.bucket ? new S3Client({
  endpoint: config.spaces.endpoint,
  region: config.spaces.region,
  forcePathStyle: false,
  // PutObject is presigned before the browser has a request body. Newer AWS
  // SDK releases otherwise attach the CRC32 of that empty body to the URL,
  // which makes Spaces reject the real file with a checksum mismatch.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: config.spaces.accessKeyId, secretAccessKey: config.spaces.secretAccessKey },
}) : null;

function localPath(item: CloudMediaItem): string {
  if (!localCloudDir || !/^rigs\/[0-9]+\/source\/[a-f0-9]{64}(?:\.[a-z0-9]{1,8})?$/.test(item.key)) {
    throw new Error('Invalid local cloud object key.');
  }
  return path.join(localCloudDir, item.key);
}

export function localCloudFile(item: CloudMediaItem): string | null {
  return localCloudDir ? localPath(item) : null;
}

export function localCloudPcmFile(item: CloudMediaItem): string | null {
  return localCloudDir ? path.join(config.paths.pcmDir, `cloud-${item.id}.pcm`) : null;
}

const localDecodes = new Map<string, Promise<string>>();

export function ensureLocalCloudDecoded(item: CloudMediaItem): Promise<string> {
  const source = localCloudFile(item);
  const target = localCloudPcmFile(item);
  if (!source || !target) return Promise.reject(new Error('Local cloud storage is not configured.'));
  const inFlight = localDecodes.get(item.id);
  if (inFlight) return inFlight;
  const job = decodeQueue.add(async () => {
    const existing = await fs.promises.stat(target).catch(() => null);
    if (existing && existing.size >= 4 && existing.size % 4 === 0) return target;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await decodeToPcm(source, temporary);
      await fs.promises.rename(temporary, target);
      log.info(`decoded local cloud item ${item.id}`);
      return target;
    } catch (err) {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      throw err;
    }
  });
  localDecodes.set(item.id, job);
  void job.finally(() => localDecodes.delete(item.id)).catch(() => undefined);
  return job;
}

export async function writeLocalCloudUpload(item: CloudMediaItem, input: IncomingMessage): Promise<void> {
  if (!localCloudDir || item.status !== 'pending') throw new Error('That upload is not pending.');
  const target = localPath(item);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${item.id}.upload`;
  const digest = crypto.createHash('sha256');
  let size = 0;
  const verify = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > item.sizeBytes) return done(new Error('Upload exceeds the declared size.'));
      digest.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(input, verify, fs.createWriteStream(temporary, { flags: 'wx' }));
    if (size !== item.sizeBytes || digest.digest('hex') !== item.sha256) {
      throw new Error('The upload size or hash does not match the selected file.');
    }
    await fs.promises.rename(temporary, target);
  } catch (err) {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    throw err;
  }
}

function row(item: any): CloudMediaItem {
  return { id: item.id, guildId: item.guild_id, key: item.object_key, name: item.name,
    sizeBytes: item.size_bytes, contentType: item.content_type, createdBy: item.created_by, createdAt: item.created_at,
    status: item.status === 'ready' ? 'ready' : item.status === 'error' ? 'error' : 'pending',
    etag: item.etag ?? null, sha256: item.sha256 ?? null,
    verifiedAt: item.verified_at ?? null, error: item.error ?? null };
}

export function listCloudMedia(guildId: string): CloudMediaItem[] {
  return (db().prepare('SELECT * FROM cloud_media WHERE guild_id = ? ORDER BY created_at DESC').all(guildId) as any[]).map(row);
}

export function getCloudMedia(guildId: string, id: string): CloudMediaItem | null {
  const found = db().prepare('SELECT * FROM cloud_media WHERE guild_id = ? AND id = ?').get(guildId, id);
  return found ? row(found) : null;
}

export function cloudUsage(guildId: string): {
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  entitled: boolean;
  billingRequired: boolean;
} {
  const result = db().prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM cloud_media WHERE guild_id = ?').get(guildId) as { bytes: number };
  const usedBytes = Number(result.bytes) || 0;
  const limitBytes = storageLimitBytes(guildId);
  return { usedBytes, limitBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    entitled: hasCloudEntitlement(guildId), billingRequired: billingEnabled };
}

function cleanEtag(value: string | undefined): string | null {
  return value ? value.replace(/^"|"$/g, '') : null;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** Failed direct uploads must stop reserving quota even if the browser vanished. */
export async function expirePendingCloudMedia(now = Date.now()): Promise<number> {
  if (!spacesEnabled) return 0;
  const expired = db()
    .prepare("SELECT * FROM cloud_media WHERE status = 'pending' AND created_at < ?")
    .all(now - PENDING_TTL_MS) as any[];
  for (const raw of expired) {
    const item = row(raw);
    if (localCloudDir) {
      await fs.promises.rm(localPath(item), { force: true }).catch(() => undefined);
    } else {
      await client!.send(new DeleteObjectCommand({ Bucket: config.spaces.bucket, Key: item.key })).catch(() => undefined);
    }
    db().prepare("DELETE FROM cloud_media WHERE id = ? AND status = 'pending'").run(item.id);
  }
  return expired.length;
}

export async function prepareUpload(
  guildId: string,
  userId: string,
  name: string,
  sizeBytes: number,
  contentType: string,
  sha256: string,
) {
  if (!spacesEnabled) throw new Error('Cloud library is not configured.');
  if (!hasCloudEntitlement(guildId)) {
    const status = billingSummary(guildId).status;
    throw new Error(
      status === 'past_due' || status === 'unpaid'
        ? 'Deck Cloud uploads are paused until the subscription payment is fixed.'
        : 'An active Deck subscription is required for cloud uploads.',
    );
  }
  await expirePendingCloudMedia();

  const duplicate = db()
    .prepare("SELECT * FROM cloud_media WHERE guild_id = ? AND sha256 = ? AND size_bytes = ? AND status = 'ready' LIMIT 1")
    .get(guildId, sha256, sizeBytes);
  if (duplicate) {
    return { item: row(duplicate), uploadUrl: null, headers: {}, deduplicated: true };
  }

  const pendingDuplicate = db()
    .prepare("SELECT created_by FROM cloud_media WHERE guild_id = ? AND sha256 = ? AND size_bytes = ? AND status = 'pending' LIMIT 1")
    .get(guildId, sha256, sizeBytes) as { created_by: string } | undefined;
  if (pendingDuplicate && pendingDuplicate.created_by !== userId) {
    throw new Error('An identical upload is already in progress.');
  }

  const id = crypto.randomUUID();
  const extension = name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0]?.toLowerCase() ?? '';
  const key = `rigs/${guildId}/source/${sha256}${extension}`;
  const createdAt = Date.now();
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    // A retry for the same content replaces its unfinished reservation. The
    // deterministic object key means the next PUT safely overwrites any
    // partial object left by the abandoned request.
    database.prepare("DELETE FROM cloud_media WHERE guild_id = ? AND sha256 = ? AND size_bytes = ? AND status = 'pending' AND created_by = ?")
      .run(guildId, sha256, sizeBytes, userId);
    const used = database.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM cloud_media WHERE guild_id = ?').get(guildId) as { bytes: number };
    if ((Number(used.bytes) || 0) + sizeBytes > storageLimitBytes(guildId)) {
      database.exec('ROLLBACK');
      throw new Error('This rig has reached its cloud-storage limit.');
    }
    database.prepare(`INSERT INTO cloud_media
      (id, guild_id, object_key, name, size_bytes, content_type, created_by, created_at, status, sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
        id, guildId, key, name, sizeBytes, contentType, userId, createdAt, sha256,
      );
    database.exec('COMMIT');
  } catch (err) {
    try { database.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
  try {
    if (localCloudDir) {
      return { item: { id, guildId, key, name, sizeBytes, contentType, createdBy: userId, createdAt,
        status: 'pending' as const, etag: null, sha256, verifiedAt: null, error: null },
        uploadUrl: `/api/g/${encodeURIComponent(guildId)}/cloud/${id}/file`, headers: {}, deduplicated: false };
    }
    const checksumSha256 = Buffer.from(sha256, 'hex').toString('base64');
    const cacheControl = config.spaces.publicCdn ? 'public, max-age=31536000, immutable' : 'private, no-store';
    const command = new PutObjectCommand({ Bucket: config.spaces.bucket, Key: key, ContentType: contentType,
      ACL: config.spaces.publicCdn ? 'public-read' : 'private',
      CacheControl: cacheControl,
      ChecksumSHA256: checksumSha256,
      Metadata: { 'rig-id': guildId, 'media-id': id, 'content-sha256': sha256 } });
    const uploadUrl = await getSignedUrl(client!, command, {
      expiresIn: 15 * 60,
      // Keep upload metadata in signed request headers instead of duplicating
      // it between query parameters and headers. This also makes the intended
      // object cache policy reach Spaces (the presigner otherwise drops it).
      signableHeaders: new Set(['cache-control', 'content-type']),
      unhoistableHeaders: new Set([
        'x-amz-acl',
        'x-amz-checksum-sha256',
        'x-amz-meta-content-sha256',
        'x-amz-meta-media-id',
        'x-amz-meta-rig-id',
      ]),
    });
    return { item: { id, guildId, key, name, sizeBytes, contentType, createdBy: userId, createdAt,
      status: 'pending' as const, etag: null, sha256, verifiedAt: null, error: null }, uploadUrl,
      headers: {
        'cache-control': cacheControl,
        'content-type': contentType,
        'x-amz-acl': config.spaces.publicCdn ? 'public-read' : 'private',
        'x-amz-checksum-sha256': checksumSha256,
        'x-amz-meta-content-sha256': sha256,
        'x-amz-meta-media-id': id,
        'x-amz-meta-rig-id': guildId,
      }, deduplicated: false };
  } catch (err) {
    db().prepare('DELETE FROM cloud_media WHERE id = ?').run(id);
    throw err;
  }
}

export async function confirmUpload(item: CloudMediaItem): Promise<CloudMediaItem> {
  if (!spacesEnabled) throw new Error('Cloud library is not configured.');
  const result = localCloudDir
    ? { ContentLength: (await fs.promises.stat(localPath(item))).size, Metadata: { 'content-sha256': item.sha256 ?? '' }, ETag: item.sha256 ?? undefined }
    : await client!.send(new HeadObjectCommand({ Bucket: config.spaces.bucket, Key: item.key }));
  if (result.ContentLength !== item.sizeBytes) throw new Error('The uploaded object size does not match the requested file.');
  if (item.sha256 && result.Metadata?.['content-sha256'] !== item.sha256) {
    throw new Error('The uploaded object hash metadata does not match the requested file.');
  }

  const duplicate = item.sha256
    ? db().prepare("SELECT * FROM cloud_media WHERE guild_id = ? AND sha256 = ? AND size_bytes = ? AND status = 'ready' AND id <> ? LIMIT 1")
      .get(item.guildId, item.sha256, item.sizeBytes, item.id)
    : null;
  if (duplicate) {
    if (localCloudDir && row(duplicate).key !== item.key) {
      await fs.promises.rm(localPath(item), { force: true }).catch(() => undefined);
    }
    else if (!localCloudDir && row(duplicate).key !== item.key) {
      await client!.send(new DeleteObjectCommand({ Bucket: config.spaces.bucket, Key: item.key })).catch(() => undefined);
    }
    db().prepare('DELETE FROM cloud_media WHERE id = ?').run(item.id);
    return row(duplicate);
  }

  if (localCloudDir) await ensureLocalCloudDecoded(item);

  const etag = cleanEtag(result.ETag);
  const verifiedAt = Date.now();
  db().prepare("UPDATE cloud_media SET status = 'ready', etag = ?, verified_at = ?, error = NULL WHERE id = ?")
    .run(etag, verifiedAt, item.id);
  return { ...item, status: 'ready', etag, verifiedAt, error: null };
}

export async function playbackUrl(item: CloudMediaItem): Promise<string> {
  if (!spacesEnabled) throw new Error('Cloud library is not configured.');
  if (item.status !== 'ready') throw new Error('That upload is not complete.');
  if (localCloudDir) return `/api/g/${encodeURIComponent(item.guildId)}/cloud/${item.id}/file`;
  if (config.spaces.publicCdn) return `${config.spaces.cdnUrl}/${item.key.split('/').map(encodeURIComponent).join('/')}`;
  return getSignedUrl(client!, new GetObjectCommand({ Bucket: config.spaces.bucket, Key: item.key }), { expiresIn: 10 * 60 });
}

export async function removeCloudMedia(item: CloudMediaItem): Promise<void> {
  if (!spacesEnabled) throw new Error('Cloud library is not configured.');
  if (localCloudDir) {
    await fs.promises.rm(localPath(item), { force: true });
    await fs.promises.rm(localCloudPcmFile(item)!, { force: true });
  }
  else await client!.send(new DeleteObjectCommand({ Bucket: config.spaces.bucket, Key: item.key }));
  db().prepare('DELETE FROM cloud_media WHERE id = ?').run(item.id);
}

function metric(value: unknown): number {
  const found = Number(value);
  return Number.isSafeInteger(found) && found > 0 ? Math.min(found, 1024 * 1024 * 1024) : 0;
}

export function recordCloudCacheMetrics(guildId: string, delta: CloudCacheMetricDelta): void {
  const values = [delta.hits, delta.misses, delta.resumedBytes, delta.evictions,
    delta.corruptions, delta.downloads, delta.downloadedBytes, delta.cdnBytes, delta.originBytes].map(metric);
  db().prepare(`INSERT INTO cloud_cache_metrics
    (guild_id, hits, misses, resumed_bytes, evictions, corruptions, downloads, downloaded_bytes, cdn_bytes, origin_bytes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      hits = hits + excluded.hits,
      misses = misses + excluded.misses,
      resumed_bytes = resumed_bytes + excluded.resumed_bytes,
      evictions = evictions + excluded.evictions,
      corruptions = corruptions + excluded.corruptions,
      downloads = downloads + excluded.downloads,
      downloaded_bytes = downloaded_bytes + excluded.downloaded_bytes,
      cdn_bytes = cdn_bytes + excluded.cdn_bytes,
      origin_bytes = origin_bytes + excluded.origin_bytes,
      updated_at = excluded.updated_at`)
    .run(guildId, ...values, Date.now());
  const corruptionDelta = values[4];
  if (corruptionDelta > 0) {
    const total = cloudCacheMetrics(guildId).corruptions;
    if (total >= 3) log.warn(`rig ${guildId} has reported ${total} local cache integrity failures`);
  }
}

export function cloudCacheMetrics(guildId: string): Record<string, number> {
  const found = db().prepare('SELECT * FROM cloud_cache_metrics WHERE guild_id = ?').get(guildId) as any;
  return found ? {
    hits: found.hits, misses: found.misses, resumedBytes: found.resumed_bytes,
    evictions: found.evictions, corruptions: found.corruptions, downloads: found.downloads,
    downloadedBytes: found.downloaded_bytes, cdnBytes: found.cdn_bytes,
    originBytes: found.origin_bytes, updatedAt: found.updated_at,
  } : { hits: 0, misses: 0, resumedBytes: 0, evictions: 0, corruptions: 0,
    downloads: 0, downloadedBytes: 0, cdnBytes: 0, originBytes: 0, updatedAt: 0 };
}

export interface CloudReconcileReport {
  expiredPending: string[];
  orphanObjects: string[];
  missingObjects: string[];
  sizeMismatches: string[];
  verified: number;
  applied: boolean;
}

/** Lists first and mutates only when apply=true, so repair always has a dry run. */
export async function reconcileCloudMedia(apply = false): Promise<CloudReconcileReport> {
  if (!spacesEnabled) throw new Error('Cloud library is not configured.');
  const allRows = (db().prepare('SELECT * FROM cloud_media').all() as any[]).map(row);
  const now = Date.now();
  const expiredPending = allRows
    .filter((item) => item.status === 'pending' && item.createdAt < now - PENDING_TTL_MS)
    .map((item) => item.id);

  const objects = new Map<string, { size: number; etag: string | null }>();
  if (localCloudDir) {
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile() && !entry.name.endsWith('.upload')) {
          const key = path.relative(localCloudDir, file).split(path.sep).join('/');
          objects.set(key, { size: (await fs.promises.stat(file)).size, etag: null });
        }
      }
    };
    await visit(localCloudDir);
  } else {
    let continuationToken: string | undefined;
    do {
      const page = await client!.send(new ListObjectsV2Command({
        Bucket: config.spaces.bucket,
        Prefix: 'rigs/',
        ContinuationToken: continuationToken,
      }));
      for (const object of page.Contents ?? []) {
        if (object.Key) objects.set(object.Key, { size: object.Size ?? 0, etag: cleanEtag(object.ETag) });
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  const activeRows = allRows.filter((item) => !expiredPending.includes(item.id));
  const knownKeys = new Set(activeRows.map((item) => item.key));
  const orphanObjects = [...objects.keys()].filter((key) => !knownKeys.has(key));
  const missingObjects = activeRows.filter((item) => item.status === 'ready' && !objects.has(item.key)).map((item) => item.id);
  const sizeMismatches = activeRows
    .filter((item) => item.status === 'ready' && objects.has(item.key) && objects.get(item.key)?.size !== item.sizeBytes)
    .map((item) => item.id);
  const verified = activeRows.filter((item) => item.status === 'ready' && objects.get(item.key)?.size === item.sizeBytes).length;

  if (orphanObjects.length || missingObjects.length || sizeMismatches.length) {
    log.warn(`Deck Cloud reconcile: ${orphanObjects.length} orphan objects, ${missingObjects.length} missing objects, ${sizeMismatches.length} size mismatches`);
  }

  if (apply) {
    for (const item of allRows.filter((entry) => expiredPending.includes(entry.id))) {
      if (localCloudDir) await fs.promises.rm(localPath(item), { force: true }).catch(() => undefined);
      else await client!.send(new DeleteObjectCommand({ Bucket: config.spaces.bucket, Key: item.key })).catch(() => undefined);
    }
    for (const key of orphanObjects) {
      if (localCloudDir) {
        if (/^rigs\/[0-9]+\/source\/[a-f0-9]{64}(?:\.[a-z0-9]{1,8})?$/.test(key)) {
          await fs.promises.rm(path.join(localCloudDir, key), { force: true });
        }
      } else await client!.send(new DeleteObjectCommand({ Bucket: config.spaces.bucket, Key: key }));
    }
    const removeIds = [...expiredPending, ...missingObjects];
    const remove = db().prepare('DELETE FROM cloud_media WHERE id = ?');
    for (const id of removeIds) remove.run(id);
    const fail = db().prepare("UPDATE cloud_media SET status = 'error', error = ?, verified_at = ? WHERE id = ?");
    for (const id of sizeMismatches) fail.run('Object size does not match the database record.', now, id);
    const mark = db().prepare("UPDATE cloud_media SET etag = COALESCE(?, etag), verified_at = ?, error = NULL WHERE id = ? AND status = 'ready'");
    for (const item of activeRows) {
      const object = objects.get(item.key);
      if (object?.size === item.sizeBytes) mark.run(object.etag, now, item.id);
    }
  }

  return { expiredPending, orphanObjects, missingObjects, sizeMismatches, verified, applied: apply };
}
