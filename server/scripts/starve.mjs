/**
 * What a source does when its reader runs dry.
 *
 *   npm run build -w server && npm run starve -w server
 *
 * A `FileWindowReader` never comes up short — the page cache does not run out —
 * so the whole underrun path is unreachable from local disk and would sit
 * untested until the first time a deck was fed over a socket and dropped out in
 * front of a room. This drives it directly through a reader that can be choked
 * on demand.
 *
 * The claim being tested is not "it goes quiet". It is that it goes quiet
 * *without clicking*, comes back on its own, and never reports a position it
 * did not actually play.
 */
import assert from 'node:assert/strict';
import { PcmSource } from '../dist/audio/source.js';
import { SAMPLE_RATE } from '../dist/protocol.js';

const BLOCK = 960;
/** Must match STARVE_FADE_FRAMES in source.ts. */
const FADE_FRAMES = Math.round(SAMPLE_RATE * 0.03);
const SECONDS = 10;
const TOTAL_FRAMES = SAMPLE_RATE * SECONDS;
/** 200 Hz, so the natural sample-to-sample step is small and a click stands out. */
const FREQ = 200;

/** Interleaved s16le, the shape a decoded upload lands in. */
const pcm = new Int16Array(TOTAL_FRAMES * 2);
for (let i = 0; i < TOTAL_FRAMES; i++) {
  const v = Math.round(Math.sin((2 * Math.PI * FREQ * i) / SAMPLE_RATE) * 0.5 * 32767);
  pcm[i * 2] = v;
  pcm[i * 2 + 1] = v;
}

/**
 * A reader that will only ever hand over the first `limit` frames, so the
 * supply can be cut and restored between blocks.
 */
class ChokeReader {
  constructor(limit) {
    this.totalFrames = TOTAL_FRAMES;
    this.limit = limit;
    this.reads = 0;
  }

  read(fromFrame, frames, into) {
    this.reads++;
    const available = Math.max(0, Math.min(fromFrame + frames, this.limit) - fromFrame);
    for (let k = 0; k < available * 2; k++) into[k] = pcm[fromFrame * 2 + k];
    return available;
  }

  prefetch() {}
  dispose() {}
}

const outL = new Float32Array(BLOCK);
const outR = new Float32Array(BLOCK);

/** Renders one block and returns what came out, plus the largest step in it. */
function render(source, pos) {
  const next = source.readBlock(pos, 1, 1, outL, outR, 0, BLOCK);
  let peak = 0;
  for (let i = 0; i < BLOCK; i++) peak = Math.max(peak, Math.abs(outL[i]));
  return { next, peak, samples: Float32Array.from(outL) };
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}   ${name}${detail ? `  ${detail}` : ''}`);
}

console.log('\nsource underrun — fading out and back rather than dropping out\n');

// Only the first second is servable, so the head runs off the end of the
// supply about a second in with plenty of file left behind it.
const reader = new ChokeReader(SAMPLE_RATE);
const source = new PcmSource(reader, 0);

let pos = 0;
let lastSample = 0;
let worstStep = 0;
let peakBeforeStarving = 0;
let starvedAt = -1;
let silentAt = -1;

// Run past the supply and keep going, so the fade has room to complete.
const blocks = Math.ceil((SAMPLE_RATE * 1.5) / BLOCK);
for (let b = 0; b < blocks; b++) {
  const { next, peak, samples } = render(source, pos);
  for (let i = 0; i < BLOCK; i++) {
    worstStep = Math.max(worstStep, Math.abs(samples[i] - lastSample));
    lastSample = samples[i];
    assert.ok(Number.isFinite(samples[i]), `non-finite sample in block ${b}`);
  }
  if (!source.starving) peakBeforeStarving = Math.max(peakBeforeStarving, peak);
  if (source.starving && starvedAt < 0) starvedAt = b * BLOCK;
  if (starvedAt >= 0 && silentAt < 0 && peak === 0) silentAt = b * BLOCK + BLOCK;
  pos = next;
}

check('the source reports starving once the supply runs out', starvedAt >= 0, `at frame ${starvedAt}`);
check('it reaches silence rather than holding a level', silentAt >= 0, `by frame ${silentAt}`);

// The fade is bounded: it must not take much longer than one fade length past
// the point the audio ran out, or a dropout becomes an audible sag first.
const fadeTook = silentAt - starvedAt;
check(
  'the fade is over inside one fade length',
  fadeTook > 0 && fadeTook <= FADE_FRAMES + BLOCK * 2,
  `${fadeTook} frames, limit ${FADE_FRAMES + BLOCK * 2}`,
);

// The point of the whole exercise. A step to zero would be a click; the
// natural step of a 200 Hz sine at 48k is about 0.033 at this amplitude.
const naturalStep = Math.abs(Math.sin((2 * Math.PI * FREQ) / SAMPLE_RATE)) * 0.5 * 2;
check(
  'nothing in the dropout steps harder than the signal itself',
  worstStep <= naturalStep,
  `worst ${worstStep.toFixed(5)}, natural ${naturalStep.toFixed(5)}`,
);

// Now the bytes turn up. Nothing tells the source about it, so this also tests
// that a window which came up short is retried rather than trusted forever.
reader.limit = TOTAL_FRAMES;

let recoveredPeak = 0;
let recoveredAt = -1;
for (let b = 0; b < 20; b++) {
  const { next, peak, samples } = render(source, pos);
  for (let i = 0; i < BLOCK; i++) {
    worstStep = Math.max(worstStep, Math.abs(samples[i] - lastSample));
    lastSample = samples[i];
  }
  if (peak > 0 && recoveredAt < 0) recoveredAt = b * BLOCK;
  recoveredPeak = Math.max(recoveredPeak, peak);
  pos = next;
}

check('it comes back on its own once the bytes arrive', recoveredAt >= 0, `at frame ${recoveredAt}`);
check(
  'it comes back to full level',
  recoveredPeak > peakBeforeStarving * 0.95,
  `${recoveredPeak.toFixed(3)} vs ${peakBeforeStarving.toFixed(3)}`,
);
check('no longer reports starving', !source.starving);
check(
  'the recovery does not click either',
  worstStep <= naturalStep,
  `worst ${worstStep.toFixed(5)}`,
);

// A starved read still advances the head. A source that stalled its position
// would silently desynchronise from the deck's idea of where it is.
check('the head keeps moving through a dropout', pos > SAMPLE_RATE, `${Math.round(pos)} frames`);

source.close();

const failed = checks.filter((c) => !c.ok);
console.log(
  failed.length === 0
    ? '\nall checks passed\n'
    : `\n${failed.length} check${failed.length > 1 ? 's' : ''} failed\n`,
);
process.exit(failed.length === 0 ? 0 : 1);
