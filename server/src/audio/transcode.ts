import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createLogger } from '../logger';
import { config } from '../config';
import { CHANNELS, PEAK_BUCKETS, SAMPLE_RATE } from '../protocol';

const log = createLogger('transcode');

const BYTES_PER_SAMPLE_FRAME = CHANNELS * 2; // s16le stereo
/** Envelope resolution while decoding: one peak per 10 ms. */
const ENVELOPE_FRAMES = SAMPLE_RATE / 100;

export interface DecodeResult {
  durationMs: number;
  peaks: number[];
  pcmBytes: number;
}

/**
 * Accumulates a mono peak envelope from interleaved s16le stereo, handling
 * chunk boundaries that fall inside a sample frame.
 */
class PeakEnvelope {
  private readonly buckets: number[] = [];
  private current = 0;
  private framesInBucket = 0;
  private carry = Buffer.alloc(0);

  push(chunk: Buffer): void {
    let buf = chunk;
    if (this.carry.length) {
      buf = Buffer.concat([this.carry, chunk]);
      this.carry = Buffer.alloc(0);
    }
    const usable = buf.length - (buf.length % BYTES_PER_SAMPLE_FRAME);
    if (usable < buf.length) this.carry = Buffer.from(buf.subarray(usable));

    for (let i = 0; i < usable; i += BYTES_PER_SAMPLE_FRAME) {
      const l = buf.readInt16LE(i);
      const r = buf.readInt16LE(i + 2);
      const mono = Math.abs(l + r) / 2;
      if (mono > this.current) this.current = mono;
      if (++this.framesInBucket >= ENVELOPE_FRAMES) {
        this.buckets.push(this.current / 32768);
        this.current = 0;
        this.framesInBucket = 0;
      }
    }
  }

  /** Downsample the 10 ms envelope to a fixed-width array for the UI. */
  finish(): number[] {
    if (this.framesInBucket > 0) this.buckets.push(this.current / 32768);
    const src = this.buckets;
    if (src.length === 0) return new Array(PEAK_BUCKETS).fill(0);
    const out = new Array<number>(PEAK_BUCKETS);
    for (let i = 0; i < PEAK_BUCKETS; i++) {
      const start = Math.floor((i * src.length) / PEAK_BUCKETS);
      const end = Math.max(start + 1, Math.floor(((i + 1) * src.length) / PEAK_BUCKETS));
      let peak = 0;
      for (let j = start; j < end && j < src.length; j++) if (src[j] > peak) peak = src[j];
      out[i] = Math.min(1, peak);
    }
    return out;
  }
}

/**
 * Decode any container/codec ffmpeg understands into headerless 48 kHz stereo
 * s16le, the exact format the mixer and Opus encoder want. Decoding once at
 * upload time keeps the realtime path free of codecs and makes seeking O(1).
 */
export function decodeToPcm(inputPath: string, pcmPath: string): Promise<DecodeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      inputPath,
      '-vn',
      '-sn',
      '-dn',
      '-map',
      'a:0',
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-ac',
      String(CHANNELS),
      '-ar',
      String(SAMPLE_RATE),
      'pipe:1',
    ];

    const proc = spawn(config.bin.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = fs.createWriteStream(pcmPath);
    const envelope = new PeakEnvelope();
    let bytes = 0;
    let stderr = '';
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      out.destroy();
      reject(err);
    };

    proc.on('error', (err) =>
      fail(
        new Error(
          `could not run ffmpeg ("${config.bin.ffmpeg}"): ${err.message}. ` +
            'Install ffmpeg or set FFMPEG_PATH.',
        ),
      ),
    );
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      envelope.push(chunk);
      if (!out.write(chunk)) {
        proc.stdout.pause();
        out.once('drain', () => proc.stdout.resume());
      }
    });

    out.on('error', (err) => fail(err));

    proc.on('close', (code) => {
      if (settled) return;
      out.end(() => {
        if (settled) return;
        settled = true;
        if (code !== 0) {
          reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with code ${code}`));
          return;
        }
        if (bytes < BYTES_PER_SAMPLE_FRAME) {
          reject(new Error('no decodable audio stream found in that file'));
          return;
        }
        const frames = Math.floor(bytes / BYTES_PER_SAMPLE_FRAME);
        resolve({
          durationMs: Math.round((frames / SAMPLE_RATE) * 1000),
          peaks: envelope.finish(),
          pcmBytes: frames * BYTES_PER_SAMPLE_FRAME,
        });
      });
    });
  });
}

/** Best-effort title/artist from container tags; falls back to the filename. */
export async function probeTitle(inputPath: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(
      config.bin.ffprobe,
      [
        '-v',
        'quiet',
        '-show_entries',
        'format_tags=title,artist',
        '-of',
        'default=noprint_wrappers=1:nokey=0',
        inputPath,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let buf = '';
    const done = (value: string) => resolve(value.slice(0, 120));
    proc.stdout.on('data', (d: Buffer) => (buf += d.toString()));
    proc.on('error', () => done(fallback));
    proc.on('close', () => {
      const tags = new Map<string, string>();
      for (const line of buf.split('\n')) {
        const idx = line.indexOf('=');
        if (idx > 0) tags.set(line.slice(0, idx).toLowerCase().trim(), line.slice(idx + 1).trim());
      }
      const title = tags.get('tag:title');
      const artist = tags.get('tag:artist');
      if (title && artist) return done(`${artist} - ${title}`);
      if (title) return done(title);
      done(fallback);
    });
  });
}

/** Serialises decodes so a burst of uploads cannot pin every core. */
class DecodeQueue {
  private tail: Promise<unknown> = Promise.resolve();

  add<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

export const decodeQueue = new DecodeQueue();

export function logDecode(id: string, ms: number): void {
  log.info(`decoded ${id} in ${ms}ms`);
}
