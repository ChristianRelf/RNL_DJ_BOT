import crypto from 'node:crypto';
import { config } from './config';

/**
 * Encryption for the few secrets that arrive at runtime rather than from the
 * environment - currently the bot tokens an owner adds from the console.
 *
 * A bot token is a password for a Discord account: anyone holding one can speak
 * as that bot anywhere it has been invited. It has to be kept because the rig
 * needs to log in with it again after a restart, so the next best thing is that
 * a copy of db.json on its own is not enough to use it. The key is derived from
 * SESSION_SECRET, which already has to be long, secret and stable - rotating it
 * signs everyone out *and* invalidates the stored tokens, which is the right
 * blast radius for a secret that has leaked.
 *
 * AES-256-GCM, so a tampered ciphertext fails to decrypt rather than decrypting
 * to something else.
 */

const KEY_INFO = 'rnl-dj-bot/token-encryption/v1';
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) {
    // scrypt over a fixed salt: the input is already high-entropy and this has
    // to be deterministic across restarts, so the salt is a domain separator
    // rather than a defence against a dictionary attack.
    cachedKey = crypto.scryptSync(config.http.sessionSecret, KEY_INFO, 32);
  }
  return cachedKey;
}

/** Encrypts a secret for storage. The result is safe to write to db.json. */
export function seal(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${body.toString('base64url')}`;
}

/**
 * Recovers a sealed secret, or null if it cannot be read - a rotated
 * SESSION_SECRET, a hand-edited database, or a value written by a future
 * format. Callers treat that as "this bot needs its token entering again"
 * rather than as a crash.
 */
export function unseal(sealed: string): string | null {
  try {
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !body) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * A short, stable identifier for a secret, so two tokens can be told apart in
 * the UI and in the log without either being shown.
 */
export function fingerprint(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8);
}
