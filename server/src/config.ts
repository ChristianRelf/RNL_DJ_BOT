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

/**
 * Reads a variable that has a fallback, recording the fallback's name as the
 * missing one only if neither is set. Used by the auth/playback split, where
 * the older single-application variables still stand in for both.
 */
function reqEither(name: string, fallback: string): string {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  return req(fallback);
}

/**
 * Whoever may add and switch playback bots. This is a step above admin: an
 * admin can force-take the decks, an owner can change which Discord account the
 * rig speaks through and hold its token. Defaults to the account this rig was
 * set up under; set OWNER_USER_IDS to change or widen it.
 */
const DEFAULT_OWNER_IDS = ['541551772288811009'];

const ownerUserIds = (() => {
  const configured = list('OWNER_USER_IDS');
  return configured.length > 0 ? configured : DEFAULT_OWNER_IDS;
})();

export const config = {
  discord: {
    guildId: req('DISCORD_GUILD_ID'),
    /**
     * The default playback bot — "deck". Its token is what the rig speaks
     * through until an owner points it at another one from the console.
     */
    playback: {
      token: req('DISCORD_BOT_TOKEN'),
      applicationId: req('DISCORD_CLIENT_ID'),
    },
    /**
     * The sign-in application — "deck auth". Separate from playback so the
     * account people log in through does not change when the bot the room hears
     * does. Falls back to the playback application, which is how this rig ran
     * before the two were split.
     *
     * Its token is only ever used to read guild membership and roles, so the
     * gate keeps working no matter which bot is currently on air. That bot must
     * be in the guild; if only the playback bot is, leave AUTH_BOT_TOKEN unset
     * and the fallback covers it.
     */
    auth: {
      clientId: reqEither('AUTH_CLIENT_ID', 'DISCORD_CLIENT_ID'),
      clientSecret: reqEither('AUTH_CLIENT_SECRET', 'DISCORD_CLIENT_SECRET'),
      token: reqEither('AUTH_BOT_TOKEN', 'DISCORD_BOT_TOKEN'),
    },
  },
  access: {
    djRoleIds: list('DJ_ROLE_IDS'),
    adminRoleIds: list('ADMIN_ROLE_IDS'),
    adminUserIds: list('ADMIN_USER_IDS'),
    ownerUserIds,
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
  /**
   * External binaries the rig shells out to. None of them are on the realtime
   * path — ffmpeg decodes at upload time, yt-dlp only runs when someone pastes
   * a link — so a missing one costs a feature rather than the mix.
   */
  bin: {
    ffmpeg: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe: process.env.FFPROBE_PATH ?? 'ffprobe',
    ytdlp: process.env.YTDLP_PATH ?? 'yt-dlp',
    aubio: process.env.AUBIO_PATH ?? 'aubio',
  },
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;

// Deduplicated: a variable that stands in for two settings — the playback
// application also covering sign-in, say — would otherwise be named twice in
// the same breath, which reads like two different problems.
const missingOnce = [...new Set(missing)];

if (missingOnce.length > 0) {
  throw new Error(
    `Missing required environment variable${missingOnce.length > 1 ? 's' : ''}: ${missingOnce.join(', ')}.\n` +
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
