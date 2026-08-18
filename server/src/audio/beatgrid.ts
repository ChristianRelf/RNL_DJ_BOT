import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { createLogger } from '../logger';
import { CHANNELS, SAMPLE_RATE } from '../protocol';
import type { BeatGrid } from '../protocol';

const log = createLogger('beatgrid');

/** Analysis is offline and optional; nothing waits on it, but nothing hangs either. */
const TIMEOUT_MS = 120_000;
/** Past this length the analysis is not worth the temp file or the wait. */
const MAX_DURATION_MS = 20 * 60 * 1000;
/** Tempo is folded into this range. Anything outside it is a wrong octave. */
const MIN_BPM = 70;
const MAX_BPM = 180;
/**
 * How tightly the detected beats have to agree with a single steady grid before
 * the grid is worth keeping. A missing grid is honest — the console falls back
 * to tapping — but a grid that is subtly wrong is worse than none, because
 * everything downstream will believe it.
 */
const MIN_CONFIDENCE = 0.35;

/** Sample rate the detector is fed at. Onsets do not need the top two octaves. */
const ANALYSIS_RATE = 22050;

/**
 * Finds the beat grid of a decoded track.
 *
 * Detection is aubio's job rather than ours — onset detection done properly is
 * a research problem, and there is a well-tested binary for it. What is done
 * here is the part aubio does not do: turning a list of beat times, which is
 * noisy and has gaps in quiet passages, into one tempo and one offset that a
 * deck can trust for six minutes without drifting off the music.
 */
export async function analyseBeats(pcmFile: string, durationMs: number): Promise<BeatGrid | null> {
  if (durationMs > MAX_DURATION_MS) {
    log.info(`skipping beat analysis: ${(durationMs / 60000).toFixed(0)} minutes is too long`);
    return null;
  }

  const wav = path.join(
    config.paths.tmpDir,
    `beats-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );

  try {
    await toAnalysisWav(pcmFile, wav);
    const beats = await runAubio(wav);
    if (!beats) return null;
    return fitGrid(beats);
  } catch (err) {
    log.warn(`beat analysis failed: ${(err as Error).message}`);
    return null;
  } finally {
    await fs.promises.unlink(wav).catch(() => undefined);
  }
}

/**
 * Turns the flat PCM into something aubio will open.
 *
 * aubio reads through libsndfile, which wants a header, and pointing it at the
 * original upload would mean relying on whatever decoders the packaged build
 * happens to have. Going back through the decoded PCM avoids both: ffmpeg is
 * only demuxing raw samples it already produced, and mono at 22 kHz is what the
 * detector wants anyway at an eighth of the size.
 */
function toAnalysisWav(pcmFile: string, wavFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      config.bin.ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS),
        '-i', pcmFile,
        '-ac', '1', '-ar', String(ANALYSIS_RATE), '-f', 'wav', '-y', wavFile,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });
    proc.on('error', (err: NodeJS.ErrnoException) =>
      reject(
        new Error(
          err.code === 'ENOENT'
            ? `ffmpeg not found at "${config.bin.ffmpeg}"`
            : `could not run ffmpeg: ${err.message}`,
        ),
      ),
    );
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited ${code}`)),
    );
  });
}

/**
 * Beat times in seconds, or null when aubio is not installed.
 *
 * An absent optional binary is a missing feature, not a fault — the track still
 * imports and still plays, it just has no grid until somebody installs aubio
 * and asks for it again.
 */
function runAubio(wavFile: string): Promise<number[] | null> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.bin.aubio, ['tempo', '-i', wavFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      finish(() => reject(new Error('aubio timed out')));
    }, TIMEOUT_MS);

    proc.on('error', (err: NodeJS.ErrnoException) =>
      finish(() => {
        if (err.code === 'ENOENT') {
          log.info(
            `aubio not installed (looked for "${config.bin.aubio}") — ` +
              'tracks import without a beat grid. Install aubio or set AUBIO_PATH.',
          );
          resolve(null);
        } else {
          reject(new Error(`could not run aubio: ${err.message}`));
        }
      }),
    );
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      // A pathological file could print a beat a millisecond; stop reading long
      // before that becomes a memory problem.
      if (stdout.length > 4_000_000) proc.kill('SIGKILL');
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });

    proc.on('close', (code) =>
      finish(() => {
        if (code !== 0) {
          reject(new Error(stderr.trim().split('\n').pop() || `aubio exited ${code}`));
          return;
        }
        const beats: number[] = [];
        for (const line of stdout.split('\n')) {
          const value = Number.parseFloat(line);
          if (Number.isFinite(value) && value >= 0) beats.push(value * 1000);
        }
        resolve(beats);
      }),
    );
  });
}

/* -------------------------------------------------------------- the fit */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How well a set of beat times agrees with a grid of the given period, and
 * where that grid sits.
 *
 * Each beat is a point on a circle — its position within one period, as an
 * angle. Beats that agree cluster, and the mean of the unit vectors points at
 * the offset they agree on. Its *length* falls out as the confidence: near 1
 * when everything lines up, near 0 when the times are scattered, with no
 * threshold or tuning anywhere in it.
 */
function circularFit(beats: number[], period: number): { offsetMs: number; strength: number } {
  let re = 0;
  let im = 0;
  for (const t of beats) {
    const phase = (2 * Math.PI * (t % period)) / period;
    re += Math.cos(phase);
    im += Math.sin(phase);
  }
  const strength = Math.hypot(re, im) / beats.length;
  let offset = (Math.atan2(im, re) / (2 * Math.PI)) * period;
  if (offset < 0) offset += period;
  return { offsetMs: offset, strength };
}

/**
 * Fits one steady grid to aubio's beat times.
 *
 * The period from the raw intervals is close but not close enough: 0.1 BPM out
 * at 128 accumulates a third of a beat over six minutes, which is the
 * difference between a grid that holds a mix together and one that slides off
 * it. So the period is refined against the whole track — the value that makes
 * every beat agree best is the one that will still be right at the end.
 */
export function fitGrid(beatsMs: number[]): BeatGrid | null {
  if (beatsMs.length < 8) return null;

  const beats = [...beatsMs].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i] - beats[i - 1];
    if (gap > 0) intervals.push(gap);
  }
  if (intervals.length < 6) return null;

  // Median, not mean: aubio drops beats in quiet passages and doubles them in
  // busy ones, and a single doubled interval would drag a mean off entirely.
  const detected = median(intervals);
  if (!Number.isFinite(detected) || detected <= 0) return null;

  // Refine against the whole track, then home in. This happens at the period
  // the beats were *detected* at, before any octave folding, because that is
  // the only period they all agree on: fold first and half of them land on the
  // off-beat of the folded grid, the fit collapses, and a perfectly good track
  // gets refused for having too clear a pulse.
  let best = { period: detected, ...circularFit(beats, detected) };
  for (const span of [0.02, 0.004, 0.0008]) {
    const from = best.period * (1 - span);
    const to = best.period * (1 + span);
    const step = (to - from) / 40;
    for (let p = from; p <= to; p += step) {
      const fit = circularFit(beats, p);
      if (fit.strength > best.strength) best = { period: p, ...fit };
    }
  }

  if (best.strength < MIN_CONFIDENCE) {
    log.info(`no usable beat grid: beats agree only ${(best.strength * 100).toFixed(0)}%`);
    return null;
  }

  // Now fold, for reporting. A grid at half or double the tempo is not wrong
  // about where the beats are, only about which of them to call a beat — and
  // the offset stays valid either way, since doubling the period keeps every
  // other beat and halving it adds beats between the ones already there.
  let period = best.period;
  while (60000 / period > MAX_BPM) period *= 2;
  while (60000 / period < MIN_BPM) period /= 2;
  if (60000 / period > MAX_BPM || 60000 / period < MIN_BPM) return null;
  const offsetMs = ((best.offsetMs % period) + period) % period;

  return {
    bpm: Math.round((60000 / period) * 100) / 100,
    beatOffsetMs: Math.round(offsetMs * 100) / 100,
    beatsPerBar: 4,
    // aubio finds beats, not bars. Guessing which of the four is the downbeat
    // would be a coin toss dressed up as data, so it stays at zero until an
    // operator stamps it.
    downbeat: 0,
    confidence: Math.round(best.strength * 100) / 100,
    source: 'auto',
  };
}
