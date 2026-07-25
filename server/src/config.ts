import path from 'node:path';
import fs from 'node:fs';

const missing: string[] = [];

/** Records rather than throws, so one run reports every missing variable. */
function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    missing.push(name);
    return '';
  }
  return v.trim();
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');

export const config = {
  discord: {
    token: req('DISCORD_BOT_TOKEN'),
    clientId: req('DISCORD_CLIENT_ID'),
    clientSecret: req('DISCORD_CLIENT_SECRET'),
    guildId: req('DISCORD_GUILD_ID'),
  },
  access: {
    djRoleIds: list('DJ_ROLE_IDS'),
    adminRoleIds: list('ADMIN_ROLE_IDS'),
    adminUserIds: list('ADMIN_USER_IDS'),
  },
  http: {
    port: num('PORT', 7403),
    publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:7403').replace(/\/+$/, ''),
    sessionSecret: req('SESSION_SECRET'),
    maxUploadBytes: Math.round(num('MAX_UPLOAD_MB', 100) * 1024 * 1024),
  },
  control: {
    idleTimeoutMs: Math.round(num('CONTROL_IDLE_TIMEOUT_S', 180) * 1000),
    disconnectGraceMs: Math.round(num('CONTROL_DISCONNECT_GRACE_S', 20) * 1000),
  },
  paths: {
    dataDir,
    mediaDir: path.join(dataDir, 'media'),
    pcmDir: path.join(dataDir, 'pcm'),
    tmpDir: path.join(dataDir, 'tmp'),
    dbFile: path.join(dataDir, 'db.json'),
    webDist: path.resolve(__dirname, '../../web/dist'),
  },
  ffmpeg: {
    ffmpeg: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe: process.env.FFPROBE_PATH ?? 'ffprobe',
  },
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.\n` +
      '  Copy .env.example to .env and fill it in (docker compose reads .env automatically).',
  );
}

if (config.http.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long.');
}

// A scheme-less PUBLIC_URL still boots but breaks OAuth (Discord rejects a
// relative redirect URI) and silently drops the Secure flag from cookies, so
// reject it here rather than at first login.
{
  let parsed: URL | null = null;
  try {
    parsed = new URL(config.http.publicUrl);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw new Error(
      `PUBLIC_URL must be an absolute URL including the scheme, for example ` +
        `https://deck.ronation.live (got "${config.http.publicUrl}").`,
    );
  }
}

export function ensureDirs(): void {
  for (const dir of [
    config.paths.dataDir,
    config.paths.mediaDir,
    config.paths.pcmDir,
    config.paths.tmpDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const redirectUri = `${config.http.publicUrl}/api/auth/callback`;
