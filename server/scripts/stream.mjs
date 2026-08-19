/**
 * Drives a deck entirely from a simulated host device.
 *
 *   npm run build -w server && npm run stream -w server
 *
 * Everything in the streaming path that can be wrong is wrong quietly: a ring
 * that wraps a frame early plays a click nobody can reproduce, a stale chunk
 * accepted after a seek plays two seconds of the wrong part of the track, and
 * an off-by-one in the request pipeline sounds exactly like a slow connection.
 *
 * So the test is not "does audio come out". It is that the samples coming out
 * are bit-for-bit the samples that went in, across a ring wrap, across seeks,
 * and with chunks arriving late and out of order.
 */
import assert from 'node:assert/strict';
import { PcmSource } from '../dist/audio/source.js';
import { RemoteWindowReader, CHUNK_FRAMES, RING_FRAMES } from '../dist/audio/remoteWindow.js';
import { SAMPLE_RATE } from '../dist/protocol.js';

const BLOCK = 960;
const SECONDS = 30;
const TOTAL_FRAMES = SAMPLE_RATE * SECONDS;

/**
 * A signal where every frame is identifiable on sight, so a chunk written to
 * the wrong place is caught by position rather than by ear. The ramp repeats
 * slowly enough to stay well inside Int16 and fast enough that no two nearby
 * frames share a value.
 */
const pcm = new Int16Array(TOTAL_FRAMES * 2);
for (let i = 0; i < TOTAL_FRAMES; i++) {
  pcm[i * 2] = (i % 30011) - 15005;
  pcm[i * 2 + 1] = 15005 - (i % 30011);
}
const expected = (frame, ch) => pcm[frame * 2 + ch] / 32768;

/** The device at the other end of the socket. Answers when told to, not before. */
class FakeHost {
  constructor() {
    this.queue = [];
    this.bytes = 0;
    this.served = 0;
    this.rejected = 0;
  }

  need(request) {
    this.queue.push(request);
  }

  /** Delivers everything outstanding, oldest first. */
  flush(reader) {
    const pending = this.queue;
    this.queue = [];
    for (const req of pending) this.deliver(reader, req);
    return pending.length;
  }

  deliver(reader, req) {
    const frames = Math.min(req.frames, TOTAL_FRAMES - req.fromFrame);
    if (frames <= 0) return;
    const slice = pcm.subarray(req.fromFrame * 2, (req.fromFrame + frames) * 2);
    this.bytes += slice.byteLength;
    this.served++;
    if (!reader.push(req.seq, req.fromFrame, slice)) this.rejected++;
  }
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}   ${name}${detail ? `  ${detail}` : ''}`);
}

console.log('\nstreaming a deck off a remote host - sample accuracy, wrap, seeks\n');

const host = new FakeHost();
const reader = new RemoteWindowReader(TOTAL_FRAMES, 'deck:A', 'track-1', (n) => host.need(n));
const source = new PcmSource(reader, 0);

// The constructor already asked for the head of the track; answering before the
// first render means nothing ever starves and the comparison can be exact.
host.flush(reader);

const outL = new Float32Array(BLOCK);
const outR = new Float32Array(BLOCK);

/* ---------------------------------------------- straight play, past a wrap */

let pos = 0;
let mismatches = 0;
let firstMismatch = -1;
let starvedBlocks = 0;

// Twelve seconds: comfortably past the eight-second ring, so the wrap is
// exercised in the middle of ordinary playback rather than as a special case.
const playBlocks = Math.floor((SAMPLE_RATE * 12) / BLOCK);
const bytesAtStart = host.bytes;
for (let b = 0; b < playBlocks; b++) {
  const startFrame = pos;
  pos = source.readBlock(pos, 1, 1, outL, outR, 0, BLOCK);
  if (source.starving) starvedBlocks++;
  for (let i = 0; i < BLOCK; i++) {
    const frame = startFrame + i;
    if (outL[i] !== expected(frame, 0) || outR[i] !== expected(frame, 1)) {
      if (firstMismatch < 0) firstMismatch = frame;
      mismatches++;
    }
  }
  source.prefetch(pos, true);
  host.flush(reader);
}

const bytesAfterPlay = host.bytes;

check('twelve seconds play without starving', starvedBlocks === 0, `${starvedBlocks} starved blocks`);
check(
  'every sample matches the source across the ring wrap',
  mismatches === 0,
  mismatches === 0
    ? `${playBlocks * BLOCK} frames, ring is ${RING_FRAMES}`
    : `${mismatches} bad frames, first at ${firstMismatch}`,
);
check('the head is where it should be', pos === playBlocks * BLOCK, `${pos}`);
check(
  'steady playback never refills from scratch',
  reader.stats.restarts === 1,
  `${reader.stats.restarts} restarts (1 is the initial fill)`,
);
{
  const played = playBlocks * BLOCK;
  const asked = reader.stats.requested;
  // Everything fetched is either played or still sitting in the ring ahead of
  // the playhead. Anything beyond that was fetched and thrown away.
  const waste = asked - played - reader.stats.buffered;
  check(
    'nothing is fetched twice',
    waste <= 0,
    `asked ${asked}, played ${played}, buffered ${reader.stats.buffered}, waste ${waste}`,
  );
}

/* --------------------------------------------------------------- a seek */

const seekTo = SAMPLE_RATE * 25;
pos = seekTo;

// Nothing delivered yet, so the first block after the jump has to come up dry.
const dryBlock = source.readBlock(pos, 1, 1, outL, outR, 0, BLOCK);
check('a seek into unbuffered audio starves rather than plays the wrong thing', source.starving);
pos = dryBlock;

// Now let the refill land and play on.
let recovered = -1;
let seekMismatches = 0;
for (let b = 0; b < 200; b++) {
  source.prefetch(pos, true);
  host.flush(reader);
  const startFrame = pos;
  pos = source.readBlock(pos, 1, 1, outL, outR, 0, BLOCK);
  if (!source.starving) {
    if (recovered < 0) recovered = b;
    // The fade back in scales the first 30 ms, so accuracy is only claimed
    // once it is complete.
    if (recovered >= 0 && b > recovered + 2) {
      for (let i = 0; i < BLOCK; i++) {
        if (outL[i] !== expected(startFrame + i, 0)) seekMismatches++;
      }
    }
  }
}

check('it recovers from the seek', recovered >= 0, `after ${recovered} blocks`);
check('and plays the right audio from the new position', seekMismatches === 0, `${seekMismatches} bad`);

/* ------------------------------------------------- stale chunks after a seek */

// Jump somewhere unbuffered so the restart fires a burst of requests, then
// jump again before any of them are answered. The first burst describes a
// position nobody is at any more and must be refused on arrival.
pos = SAMPLE_RATE * 18;
source.readBlock(pos, 1, 1, outL, outR, 0, BLOCK);
source.prefetch(pos, true);
const inFlight = host.queue.length;

pos = SAMPLE_RATE * 3;
source.readBlock(pos, 1, 1, outL, outR, 0, BLOCK);
source.prefetch(pos, true);

const rejectedBefore = host.rejected;
host.flush(reader);
const rejectedByStaleness = host.rejected - rejectedBefore;

check(
  'chunks in flight across a seek are refused',
  inFlight > 0 && rejectedByStaleness === inFlight,
  `${rejectedByStaleness} of ${inFlight} rejected`,
);

// And the deck still plays correct audio at the new position afterwards.
let afterStale = 0;
let afterStaleChecked = 0;
for (let b = 0; b < 60; b++) {
  source.prefetch(pos, true);
  host.flush(reader);
  const startFrame = pos;
  pos = source.readBlock(pos, 1, 1, outL, outR, 0, BLOCK);
  if (!source.starving && b > 20) {
    for (let i = 0; i < BLOCK; i++) {
      afterStaleChecked++;
      if (outL[i] !== expected(startFrame + i, 0)) afterStale++;
    }
  }
}
check(
  'the ring is not poisoned by the refused chunks',
  afterStale === 0 && afterStaleChecked > 0,
  `${afterStaleChecked} frames checked`,
);

/* ------------------------------------------- a host that is still decoding */

// The first request for a track always arrives while the device is still
// decoding it. The host says so rather than staying quiet, because requests are
// capped in flight: eight silent refusals would leave the reader believing it
// had eight answers coming, and the deck would go quiet the moment a track was
// loaded and stay quiet for good. This is that, end to end.
{
  const slowHost = new FakeHost();
  const slowReader = new RemoteWindowReader(
    TOTAL_FRAMES,
    'deck:B',
    'track-2',
    (n) => slowHost.need(n),
  );
  const slowSource = new PcmSource(slowReader, 1);

  let declined = 0;
  let p = 0;
  const until = Date.now() + 900;
  while (Date.now() < until) {
    for (const req of slowHost.queue.splice(0)) {
      slowReader.decline(req.seq, req.fromFrame);
      declined++;
    }
    slowSource.prefetch(p, true);
    p = slowSource.readBlock(p, 1, 1, outL, outR, 0, BLOCK);
    await new Promise((r) => setTimeout(r, 20));
  }

  check(
    'a host that is not ready yet keeps being asked',
    declined > 8,
    `${declined} requests refused and retried`,
  );
  check('and the deck stays silent meanwhile', slowSource.starving);

  // The decode finishes. Nothing tells the reader; it simply gets an answer.
  p = 0;
  let recovered = false;
  let wrong = 0;
  for (let b = 0; b < 400; b++) {
    slowSource.prefetch(p, true);
    slowHost.flush(slowReader);
    const startFrame = p;
    p = slowSource.readBlock(p, 1, 1, outL, outR, 0, BLOCK);
    if (!slowSource.starving) {
      if (!recovered) recovered = true;
      else for (let i = 0; i < BLOCK; i++) {
        if (outL[i] !== expected(startFrame + i, 0)) wrong++;
      }
    }
  }

  check('it recovers once the decode lands', recovered);
  check('and plays the track from the top, correctly', wrong === 0, `${wrong} bad frames`);
  slowSource.close();
}

/* ------------------------------------------------------------ bandwidth */

// Steady-state only. A seek refills from nothing, so folding those into the
// figure would describe a deck nobody is playing.
const streamed = bytesAfterPlay - bytesAtStart;
const seconds = (playBlocks * BLOCK) / SAMPLE_RATE;
const mbit = ((streamed / seconds) * 8) / 1e6;
console.log(
  `
  steady state: ${(streamed / 1048576).toFixed(1)} MB over ${seconds}s in ` +
    `${CHUNK_FRAMES}-frame chunks - ${mbit.toFixed(2)} Mbit/s per playing deck`,
);

source.close();

const failed = checks.filter((c) => !c.ok);
console.log(
  failed.length === 0
    ? '\nall checks passed\n'
    : `\n${failed.length} check${failed.length > 1 ? 's' : ''} failed\n`,
);
process.exit(failed.length === 0 ? 0 : 1);
