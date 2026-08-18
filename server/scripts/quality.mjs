/**
 * Measures what the resampler actually does to a signal.
 *
 *   npm run build -w server && npm run quality -w server
 *
 * The claim behind Phase 1 is that linear interpolation was audibly the worst
 * thing on the audio path and cubic fixes most of it. That is a measurable
 * claim, so it is measured here rather than asserted: a pure tone goes in, and
 * everything that comes out which is not that tone is the error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PcmSource } from '../dist/audio/source.js';
import { SAMPLE_RATE } from '../dist/protocol.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-quality-'));

function writeSine(file, seconds, freq) {
  const frames = Math.round(SAMPLE_RATE * seconds);
  const buf = Buffer.allocUnsafe(frames * 4);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * 0.5 * 32767);
    buf.writeInt16LE(v, i * 4);
    buf.writeInt16LE(v, i * 4 + 2);
  }
  fs.writeFileSync(file, buf);
  return file;
}

/** Reads a file the way the old source did: two taps, straight line between. */
function readLinear(file, frames, startPos, rate, n) {
  const raw = fs.readFileSync(file);
  const out = new Float32Array(n);
  let pos = startPos;
  for (let i = 0; i < n; i++) {
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const i1 = i0 + 1 < frames ? i0 + 1 : i0;
    const a = raw.readInt16LE(i0 * 4) / 32768;
    const b = raw.readInt16LE(i1 * 4) / 32768;
    out[i] = a + (b - a) * frac;
    pos += rate;
  }
  return out;
}

/** Energy at one frequency, and everything else, over a Hann-windowed block. */
function toneToNoise(signal, freq) {
  const n = signal.length;
  let re = 0;
  let im = 0;
  let total = 0;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));

  for (let i = 0; i < n; i++) {
    const v = signal[i] * w[i];
    const phase = (2 * Math.PI * freq * i) / SAMPLE_RATE;
    re += v * Math.cos(phase);
    im -= v * Math.sin(phase);
    total += v * v;
  }
  // Hann spreads a tone over three bins, so the neighbours belong to it too.
  const bin = (freq * n) / SAMPLE_RATE;
  let tone = ((re * re + im * im) * 2) / n;
  for (const off of [-1, 1]) {
    const f = ((bin + off) * SAMPLE_RATE) / n;
    let r2 = 0;
    let i2 = 0;
    for (let i = 0; i < n; i++) {
      const v = signal[i] * w[i];
      const phase = (2 * Math.PI * f * i) / SAMPLE_RATE;
      r2 += v * Math.cos(phase);
      i2 -= v * Math.sin(phase);
    }
    tone += ((r2 * r2 + i2 * i2) * 2) / n;
  }
  const noise = Math.max(total - tone, 1e-30);
  return 10 * Math.log10(tone / noise);
}

const N = 4096;
console.log('resampler quality — signal to everything-that-is-not-the-signal\n');
console.log('  source     rate    linear (was)      cubic (now)     improvement');

const cases = [
  { freq: 5000, rate: 0.5 },
  { freq: 10000, rate: 0.5 },
  { freq: 15000, rate: 0.5 },
  { freq: 5000, rate: 0.75 },
  { freq: 10000, rate: 1.06 },
  { freq: 10000, rate: 1.5 },
];

let worstGain = Infinity;
let regressed = false;
for (const { freq, rate } of cases) {
  const file = writeSine(path.join(tmp, `s${freq}-${rate}.pcm`), 6, freq);
  const frames = Math.floor(fs.statSync(file).size / 4);
  // Start a little in, so neither reader is sitting on the file's first frames.
  const start = 20000.5;

  const src = new PcmSource(file);
  const cubicL = new Float32Array(N);
  const cubicR = new Float32Array(N);
  src.readBlock(start, rate, rate, cubicL, cubicR, 0, N);
  src.close();

  const linear = readLinear(file, frames, start, rate, N);

  // The tone the resampled signal should be, aliased into the first Nyquist
  // zone if the rate pushed it past.
  let out = freq * rate;
  while (out > SAMPLE_RATE / 2) out = Math.abs(SAMPLE_RATE - out);

  const lin = toneToNoise(linear, out);
  const cub = toneToNoise(cubicL, out);
  const gain = cub - lin;
  if (gain < worstGain) worstGain = gain;
  // The invariant worth asserting. How much better cubic is depends on where
  // the content sits against Nyquist — a 15 kHz tone dropped an octave is hard
  // for any four-tap kernel — but it must never come out worse.
  if (gain < 0) regressed = true;
  console.log(
    `  ${String(freq).padStart(6)}Hz  ${rate.toFixed(2)}   ` +
      `${lin.toFixed(1).padStart(8)} dB   ${cub.toFixed(1).padStart(10)} dB   ` +
      `${(gain >= 0 ? '+' : '') + gain.toFixed(1)} dB`,
  );
}

// --- the unity path has to be exact -----------------------------------------
{
  const file = writeSine(path.join(tmp, 'unity.pcm'), 4, 997);
  const raw = fs.readFileSync(file);
  const src = new PcmSource(file);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const start = 30000;
  src.readBlock(start, 1, 1, L, R, 0, N);
  src.close();

  let worst = 0;
  for (let i = 0; i < N; i++) {
    const want = raw.readInt16LE((start + i) * 4) / 32768;
    worst = Math.max(worst, Math.abs(L[i] - want));
  }
  console.log(
    `\n  unity rate is a straight copy: worst sample error ${worst.toExponential(2)} ` +
      `(${worst === 0 ? 'exact' : 'NOT EXACT'})`,
  );
  if (worst !== 0) process.exitCode = 1;
}

// --- reading across a window refill must not seam ---------------------------
{
  const file = writeSine(path.join(tmp, 'seam.pcm'), 30, 1000);
  const src = new PcmSource(file);
  const L = new Float32Array(960);
  const R = new Float32Array(960);
  // Walk well past the four-second window so it refills several times, and
  // watch for a sample that jumps further than a 1 kHz sine ever could.
  let pos = 1000.25;
  let worst = 0;
  let previous = null;
  // The first block is the filter settling from a standing start, which in the
  // engine always happens under the transport fade. What is being looked for
  // here is a step at a window boundary, hundreds of blocks in.
  pos = src.readBlock(pos, 1.03, 1.03, L, R, 0, 960);
  for (let block = 0; block < 900; block++) {
    pos = src.readBlock(pos, 1.03, 1.03, L, R, 0, 960);
    for (let i = 0; i < 960; i++) {
      if (previous !== null) worst = Math.max(worst, Math.abs(L[i] - previous));
      previous = L[i];
    }
  }
  src.close();
  const limit = 0.5 * 2 * Math.PI * (1030 / SAMPLE_RATE) * 1.5;
  console.log(
    `  no seam across ${Math.round(pos / SAMPLE_RATE)}s of refills: ` +
      `largest step ${worst.toFixed(5)} (limit ${limit.toFixed(5)}) ` +
      `${worst < limit ? 'ok' : 'FAIL'}`,
  );
  if (worst >= limit) process.exitCode = 1;
}

console.log(`\n  cubic is better everywhere: ${regressed ? 'NO — a case regressed' : 'yes'}`);
console.log(`  smallest improvement across the set: ${worstGain.toFixed(1)} dB`);
if (regressed) process.exitCode = 1;

fs.rmSync(tmp, { recursive: true, force: true });
