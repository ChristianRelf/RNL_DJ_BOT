import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { config } from '../config';
import { createLogger } from '../logger';

const log = createLogger('import');

/** A stalled download should not hold a slot open indefinitely. */
const TIMEOUT_MS = 60_000;
/** An extractor negotiates formats before a byte moves, so it gets longer. */
const EXTRACT_TIMEOUT_MS = 180_000;
const MAX_REDIRECTS = 3;

export class ImportError extends Error {}

/**
 * Hosts handed to yt-dlp instead of being fetched directly.
 *
 * Deliberately a list rather than "anything yt-dlp recognises". yt-dlp knows
 * about a couple of thousand sites, and a server-side extractor that will try
 * any URL somebody pastes is a very different thing to run than one that will
 * try YouTube. Adding a site here is a decision, not a config value.
 */
const EXTRACTOR_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

function usesExtractor(url: URL): boolean {
  return EXTRACTOR_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Content types worth trying to decode. Servers are careless with these, so an
 * octet-stream is accepted too and left for ffmpeg to accept or reject.
 */
const ACCEPTED = /^(audio|video)\//i;
const AMBIGUOUS = /^(application\/(octet-stream|binary)|binary\/octet-stream)$/i;

/**
 * Blocks the addresses that make a server-side fetcher dangerous: loopback,
 * link-local (which covers cloud metadata endpoints), private ranges, and the
 * various shared or reserved blocks. Checked after DNS resolution, and again on
 * every redirect, because a hostname that resolves publicly once can resolve
 * inward the next time.
 */
export function isPublicAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 192 && b === 0) return false; // protocol assignments
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return false;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
    if (lower.startsWith('ff')) return false; // multicast
    // ::ffff:10.0.0.1 and friends — judge the address they actually mean.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    return true;
  }
  return false;
}

/** Resolves a hostname and refuses it unless every answer is publicly routable. */
async function assertPublicHost(hostname: string): Promise<void> {
  // A literal address never reaches the resolver, so check it directly.
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new ImportError('That address is not reachable from here.');
    }
    return;
  }

  let answers: string[];
  try {
    const resolved = await dns.lookup(hostname, { all: true });
    answers = resolved.map((entry) => entry.address);
  } catch {
    throw new ImportError(`Could not resolve ${hostname}.`);
  }

  if (answers.length === 0) throw new ImportError(`Could not resolve ${hostname}.`);
  if (!answers.every(isPublicAddress)) {
    throw new ImportError('That address is not reachable from here.');
  }
}

function filenameFrom(url: URL, contentType: string | null): string {
  const base = path.basename(decodeURIComponent(url.pathname)).trim();
  if (base && base !== '/' && base.length <= 180) return base;
  const guess = contentType?.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '');
  return `import.${guess || 'audio'}`;
}

export interface FetchedFile {
  tempPath: string;
  originalName: string;
  sizeBytes: number;
}

/** Pulls the useful line out of a wall of yt-dlp output. */
function extractorMessage(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reverse()
    .find((entry) => entry.startsWith('ERROR:'));
  return line ? line.replace(/^ERROR:\s*/, '').slice(0, 200) : '';
}

/**
 * Fetches through yt-dlp, for the hosts that serve a page rather than a file.
 *
 * The video title goes into the filename via the output template, so the
 * normal ingest path picks it up as the fallback title without a second call
 * asking what the thing was called.
 */
async function fetchViaExtractor(url: URL): Promise<FetchedFile> {
  const limit = config.http.maxUploadBytes;
  await fs.promises.mkdir(config.paths.tmpDir, { recursive: true });
  const stem = `yt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const template = path.join(config.paths.tmpDir, `${stem}-%(title).120B.%(ext)s`);

  const args = [
    // A link carrying "&list=" is one track somebody wants, not the two
    // hundred behind it.
    '--no-playlist',
    // Finished files only, so the search below cannot pick up a partial one.
    '--no-part',
    '--no-continue',
    '--no-progress',
    '--no-warnings',
    '--socket-timeout',
    '30',
    '--retries',
    '2',
    '--max-filesize',
    String(limit),
    // The container is left alone: everything is decoded by ffmpeg on the way
    // into the pool anyway, so re-encoding here would be a generation of loss
    // for nothing.
    '-f',
    'bestaudio/best',
    '-o',
    template,
    // A URL that begins with "-" is a URL, not a flag.
    '--',
    url.toString(),
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(config.bin.ytdlp, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      finish(new ImportError('That download timed out.'));
    }, EXTRACT_TIMEOUT_MS);

    proc.on('error', (err: NodeJS.ErrnoException) =>
      finish(
        new ImportError(
          err.code === 'ENOENT'
            ? `yt-dlp is not installed (looked for "${config.bin.ytdlp}"). ` +
              'Install it or set YTDLP_PATH.'
            : `Could not run yt-dlp: ${err.message}`,
        ),
      ),
    );
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on('close', (code) => {
      if (code === 0) return finish();
      finish(new ImportError(extractorMessage(stderr) || `yt-dlp exited with code ${code}.`));
    });
  });

  // `--no-playlist` should leave exactly one file, but a stray second one must
  // not be left lying in the temp directory either way.
  const entries = await fs.promises.readdir(config.paths.tmpDir);
  const matches = entries.filter((entry) => entry.startsWith(`${stem}-`)).sort();
  for (const extra of matches.slice(1)) {
    await fs.promises.unlink(path.join(config.paths.tmpDir, extra)).catch(() => undefined);
  }
  const name = matches[0];
  if (!name) throw new ImportError('yt-dlp did not produce a file from that link.');

  const tempPath = path.join(config.paths.tmpDir, name);
  const stat = await fs.promises.stat(tempPath);
  // `--max-filesize` only bites when the size is known before the download
  // starts, so the real check is here, against what actually landed.
  if (stat.size === 0 || stat.size > limit) {
    await fs.promises.unlink(tempPath).catch(() => undefined);
    throw new ImportError(
      stat.size === 0
        ? 'That link produced an empty file.'
        : `That download is larger than the ${limit / 1048576} MB limit.`,
    );
  }

  log.info(`extracted ${stat.size} bytes from ${url.host}`);
  return {
    tempPath,
    originalName: name.slice(stem.length + 1),
    sizeBytes: stat.size,
  };
}

/**
 * Downloads a link to a temp path for the normal ingest path.
 *
 * Two routes in: a direct link to an audio file is fetched here, and the hosts
 * in `EXTRACTOR_HOSTS` — YouTube and its variants — are handed to yt-dlp,
 * which is the only way to get a file out of a page. Everything else is
 * refused rather than guessed at.
 *
 * Neither route is a licence check. Import what you have the right to play.
 */
export async function fetchAudio(rawUrl: string): Promise<FetchedFile> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImportError('That does not look like a URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportError('Only http and https links can be imported.');
  }
  if (usesExtractor(url)) return fetchViaExtractor(url);

  const limit = config.http.maxUploadBytes;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ImportError('Only http and https links can be imported.');
      }
      await assertPublicHost(url.hostname);

      // Redirects are followed by hand so each new host is checked before it is
      // contacted — `redirect: 'follow'` would jump to an internal address
      // without ever asking.
      const hopResponse = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'audio/*,video/*,application/octet-stream;q=0.8,*/*;q=0.5' },
      });

      if (hopResponse.status >= 300 && hopResponse.status < 400) {
        const location = hopResponse.headers.get('location');
        if (!location) throw new ImportError('That link redirected nowhere.');
        void hopResponse.body?.cancel();
        url = new URL(location, url);
        continue;
      }
      response = hopResponse;
      break;
    }

    if (!response) throw new ImportError('That link redirected too many times.');
    if (!response.ok) {
      throw new ImportError(`The server refused the download (${response.status}).`);
    }

    const contentType = response.headers.get('content-type');
    const bare = contentType?.split(';')[0]?.trim() ?? '';
    if (bare && !ACCEPTED.test(bare) && !AMBIGUOUS.test(bare)) {
      throw new ImportError(`That link is ${bare}, not an audio file.`);
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
      throw new ImportError(`That file is larger than the ${limit / 1048576} MB limit.`);
    }
    if (!response.body) throw new ImportError('That link returned nothing.');

    await fs.promises.mkdir(config.paths.tmpDir, { recursive: true });
    const tempPath = path.join(
      config.paths.tmpDir,
      `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    );
    const handle = await fs.promises.open(tempPath, 'w');
    let written = 0;

    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        written += chunk.byteLength;
        // Content-length is a claim, not a promise — enforce the cap against
        // what actually arrives.
        if (written > limit) {
          throw new ImportError(`That file is larger than the ${limit / 1048576} MB limit.`);
        }
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }

    if (written === 0) {
      await fs.promises.unlink(tempPath).catch(() => undefined);
      throw new ImportError('That link returned an empty file.');
    }

    log.info(`fetched ${written} bytes from ${url.host}`);
    return { tempPath, originalName: filenameFrom(url, contentType), sizeBytes: written };
  } catch (err) {
    if (err instanceof ImportError) throw err;
    if ((err as Error).name === 'AbortError') throw new ImportError('The download timed out.');
    throw new ImportError(`Could not fetch that link: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}
