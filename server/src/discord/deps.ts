import { createLogger } from '../logger';

const log = createLogger('voice-deps');

/** @discordjs/voice picks the first of these it can load. */
const OPUS_PACKAGES = ['@discordjs/opus', 'opusscript', 'node-opus'];
const ENCRYPTION_PACKAGES = [
  'sodium-native',
  'libsodium-wrappers',
  '@noble/ciphers',
  '@stablelib/xchacha20poly1305',
  'tweetnacl',
];

function loadable(name: string): boolean {
  try {
    require(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Voice needs an Opus encoder and an encryption backend, both resolved at
 * runtime by @discordjs/voice. When the encryption package is missing the
 * connection simply never reaches Ready and times out with no explanation, so
 * surface it at boot instead.
 */
export function checkVoiceDependencies(): void {
  const opus = OPUS_PACKAGES.filter(loadable);
  const encryption = ENCRYPTION_PACKAGES.filter(loadable);

  log.info(`opus: ${opus.join(', ') || 'none'} | encryption: ${encryption.join(', ') || 'none'}`);

  if (encryption.length === 0) {
    log.error(
      'No voice encryption package could be loaded. Voice connections will time ' +
        'out before becoming ready. Reinstall dependencies (libsodium-wrappers).',
    );
  }
  if (opus.length === 0) {
    log.error(
      'No Opus encoder could be loaded. The bot will connect but stay silent. ' +
        '@discordjs/opus needs python3/make/g++ at install time.',
    );
  }
}
