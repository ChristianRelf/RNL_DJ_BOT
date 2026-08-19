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
 * Whoever runs the platform: the portal, the allowlist, the bot pool, every
 * rig. A step above a guild admin, who can force-take the decks in one server
 * and nothing else.
 *
 * OWNER_USER_IDS is still read, because that is what this used to be called and
 * an install that sets it should not silently lose its administrator.
 */
const platformAdminIds = (() => {
  const configured = list('PLATFORM_ADMIN_IDS');
  return configured.length > 0 ? configured : list('OWNER_USER_IDS');
})();

export const config = {
  discord: {
    /**
     * The guild to import a legacy `db.json` into, and nothing else. Rigs live
     * in the database now; this exists so an install that predates that keeps
     * its library on the first start after upgrading, and can be unset after.
     */
    guildId: (process.env.DISCORD_GUILD_ID ?? '').trim(),
    /**
     * "deck" - the one Discord application this runs on.
     *
     * It is the bot people invite, the account the room hears by default, the
     * application `/dj` is registered against, and the token the sign-in gate
     * reads guild membership with.
     *
     * A rig can be pointed at a different playback account from its tools page,
     * but the gate deliberately stays on this one: who is allowed to sign in
     * must not change when the bot the room hears does.
     */
    playback: {
      token: req('DISCORD_BOT_TOKEN'),
      applicationId: req('DISCORD_CLIENT_ID'),
      clientSecret: req('DISCORD_CLIENT_SECRET'),
    },
  },
  access: {
    /** Seeds the imported guild's roles. Per-rig roles live in the database. */
    djRoleIds: list('DJ_ROLE_IDS'),
    adminRoleIds: list('ADMIN_ROLE_IDS'),
    adminUserIds: list('ADMIN_USER_IDS'),
    platformAdminIds,
  },
  http: {
    port: num('PORT', 7403),
    publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:7403').replace(/\/+$/, ''),
    /** Where the owner portal answers. Matched against the Host header. */
    portalHost: (process.env.PORTAL_HOST ?? '').trim().toLowerCase(),
    /**
     * Domain to scope the session cookie to. Set it to the parent of both the
     * console and the portal - `deck.ronation.live` covers
     * `portal.deck.ronation.live` - so one sign-in serves both. Left empty the
     * cookie is host-only, which is right for localhost.
     */
    cookieDomain: (process.env.COOKIE_DOMAIN ?? '').trim(),
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
   * path - ffmpeg decodes at upload time, yt-dlp only runs when someone pastes
   * a link - so a missing one costs a feature rather than the mix.
   */
  bin: {
    ffmpeg: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobe: process.env.FFPROBE_PATH ?? 'ffprobe',
    ytdlp: process.env.YTDLP_PATH ?? 'yt-dlp',
    aubio: process.env.AUBIO_PATH ?? 'aubio',
  },
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;

// Deduplicated: a variable that stands in for two settings - the playback
// application also covering sign-in, say - would otherwise be named twice in
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

// Signing in requires being on the allowlist, and only a platform admin can put
// anybody on it. With nobody configured, an install is not merely limited - it
// is sealed: no portal, no way to grant access, and no hint as to why. That is
// worth refusing to start over, because the alternative is discovering it as a
// login page that rejects everyone including you.
if (config.access.platformAdminIds.length === 0) {
  throw new Error(
    'PLATFORM_ADMIN_IDS is empty, so nobody could reach the portal or be let in. ' +
      'Set it to your Discord user id - enable Developer Mode in Discord, then ' +
      'right-click your own name and Copy User ID.',
  );
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
