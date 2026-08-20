import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';
import { db } from './db';

export interface CloudMediaItem {
  id: string; guildId: string; key: string; name: string; sizeBytes: number;
  contentType: string; createdBy: string; createdAt: number;
  status: 'pending' | 'ready';
}

export const spacesEnabled = Boolean(config.spaces.bucket);

const client = spacesEnabled ? new S3Client({
  endpoint: config.spaces.endpoint,
  region: config.spaces.region,
  forcePathStyle: false,
  credentials: { accessKeyId: config.spaces.accessKeyId, secretAccessKey: config.spaces.secretAccessKey },
}) : null;

function row(item: any): CloudMediaItem {
  return { id: item.id, guildId: item.guild_id, key: item.object_key, name: item.name,
    sizeBytes: item.size_bytes, contentType: item.content_type, createdBy: item.created_by, createdAt: item.created_at,
    status: item.status === 'ready' ? 'ready' : 'pending' };
}

export function listCloudMedia(guildId: string): CloudMediaItem[] {
  return (db().prepare('SELECT * FROM cloud_media WHERE guild_id = ? ORDER BY created_at DESC').all(guildId) as any[]).map(row);
}

export function getCloudMedia(guildId: string, id: string): CloudMediaItem | null {
  const found = db().prepare('SELECT * FROM cloud_media WHERE guild_id = ? AND id = ?').get(guildId, id);
  return found ? row(found) : null;
}

export function cloudUsage(guildId: string): { usedBytes: number; limitBytes: number; remainingBytes: number } {
  const result = db().prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM cloud_media WHERE guild_id = ?').get(guildId) as { bytes: number };
  const usedBytes = Number(result.bytes) || 0;
  return { usedBytes, limitBytes: config.spaces.guildLimitBytes,
    remainingBytes: Math.max(0, config.spaces.guildLimitBytes - usedBytes) };
}

export async function prepareUpload(guildId: string, userId: string, name: string, sizeBytes: number, contentType: string) {
  if (!client) throw new Error('Cloud library is not configured.');
  const id = crypto.randomUUID();
  const extension = name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0]?.toLowerCase() ?? '';
  const key = `rigs/${guildId}/${id}${extension}`;
  const createdAt = Date.now();
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const used = database.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM cloud_media WHERE guild_id = ?').get(guildId) as { bytes: number };
    if ((Number(used.bytes) || 0) + sizeBytes > config.spaces.guildLimitBytes) {
      database.exec('ROLLBACK');
      throw new Error('This rig has reached its cloud-storage limit.');
    }
    database.prepare(`INSERT INTO cloud_media (id, guild_id, object_key, name, size_bytes, content_type, created_by, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(id, guildId, key, name, sizeBytes, contentType, userId, createdAt);
    database.exec('COMMIT');
  } catch (err) {
    try { database.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
  try {
    const command = new PutObjectCommand({ Bucket: config.spaces.bucket, Key: key, ContentType: contentType,
      ACL: config.spaces.publicCdn ? 'public-read' : 'private',
      CacheControl: config.spaces.publicCdn ? 'public, max-age=31536000, immutable' : 'private, no-store',
      Metadata: { 'rig-id': guildId, 'media-id': id } });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 15 * 60 });
    return { item: { id, guildId, key, name, sizeBytes, contentType, createdBy: userId, createdAt, status: 'pending' as const }, uploadUrl,
      headers: { 'content-type': contentType, 'x-amz-acl': config.spaces.publicCdn ? 'public-read' : 'private' } };
  } catch (err) {
    db().prepare('DELETE FROM cloud_media WHERE id = ?').run(id);
    throw err;
  }
}

export async function confirmUpload(item: CloudMediaItem): Promise<CloudMediaItem> {
  if (!client) throw new Error('Cloud library is not configured.');
  const result = await client.send(new HeadObjectCommand({ Bucket: config.spaces.bucket, Key: item.key }));
  if (result.ContentLength !== item.sizeBytes) throw new Error('The uploaded object size does not match the requested file.');
  db().prepare("UPDATE cloud_media SET status = 'ready' WHERE id = ?").run(item.id);
  return { ...item, status: 'ready' };
}

export async function playbackUrl(item: CloudMediaItem): Promise<string> {
  if (!client) throw new Error('Cloud library is not configured.');
  if (item.status !== 'ready') throw new Error('That upload is not complete.');
  if (config.spaces.publicCdn) return `${config.spaces.cdnUrl}/${item.key.split('/').map(encodeURIComponent).join('/')}`;
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.spaces.bucket, Key: item.key }), { expiresIn: 60 * 60 });
}

export async function removeCloudMedia(item: CloudMediaItem): Promise<void> {
  if (!client) throw new Error('Cloud library is not configured.');
  await client.send(new DeleteObjectCommand({ Bucket: config.spaces.bucket, Key: item.key }));
  db().prepare('DELETE FROM cloud_media WHERE id = ?').run(item.id);
}
