/**
 * Render-cost bench for the mix graph.
 *
 *   npm run build -w server && npm run bench -w server
 *
 * The voice player pulls a frame every 20 ms; a late frame is a dropout the
 * room hears. So the only number that matters here is how much of that 20 ms
 * one frame actually costs, under the worst load the console can produce —
 * both decks playing off pitch and all eight pads firing.
 *
 * Run it before and after anything that touches the audio path. It is the
 * evidence for "this is affordable", which is not a thing to take on faith.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Mixer } from '../dist/audio/mixer.js';
import { FRAME_MS, PAD_COUNT, SAMPLE_RATE } from '../dist/protocol.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-bench-'));
const FRAMES = Number(process.env.BENCH_FRAMES ?? 3000);

/** A stereo sine as 48k s16le, the same shape a decoded upload lands in. */
function writePcm(file, seconds, freq) {
  const frames = Math.round(SAMPLE_RATE * seconds);
  const buf = Buffer.allocUnsafe(frames * 4);
  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE;
    // Two partials and a slow sweep, so the interpolator has something with
    // real high-frequency content to chew on rather than a pure tone.
    const v =
      Math.sin(2 * Math.PI * freq * t) * 0.5 +
      Math.sin(2 * Math.PI * freq * 2.5 * t + Math.sin(t)) * 0.3;
    const s = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
    buf.writeInt16LE(s, i * 4);
    buf.writeInt16LE(s, i * 4 + 2);
  }
  fs.writeFileSync(file, buf);
  return file;
}

function report(label, timer) {
  const [p50, p95] = timer.percentiles();
  const budget = FRAME_MS;
  const pct = (v) => `${((v / budget) * 100).toFixed(1)}%`;
  console.log(
    `  ${label.padEnd(34)} p50 ${p50.toFixed(3)}ms (${pct(p50)})   ` +
      `p95 ${p95.toFixed(3)}ms (${pct(p95)})   max ${timer.max.toFixed(3)}ms (${pct(timer.max)})`,
  );
}

function run(mixer, frames) {
  mixer.frameTimer.reset();
  for (let i = 0; i < frames; i++) mixer.renderFrame();
}

console.log(`mix graph bench — ${FRAMES} frames per case, ${FRAME_MS}ms budget each`);
console.log(`  node ${process.version} on ${os.platform()} ${os.arch()}, ${os.cpus()[0]?.model ?? '?'}`);
console.log();

// Long enough to stream rather than sit in whatever the source caches.
const trackA = writePcm(path.join(tmp, 'a.pcm'), 200, 220);
const trackB = writePcm(path.join(tmp, 'b.pcm'), 200, 330);
const stab = writePcm(path.join(tmp, 'stab.pcm'), 2, 660);

const mixer = new Mixer();
try {
  const { A, B } = mixer.decks;
  // The freewheel would render frames underneath the bench and pollute it.
  mixer.createStream();

  run(mixer, 200);
  report('idle', mixer.frameTimer);

  A.load({ mediaId: 'a', title: 'a', pcmPath: trackA, bpm: 128 });
  A.play();
  mixer.applyMixer({ crossfader: -1 });
  run(mixer, FRAMES);
  report('one deck, unity rate', mixer.frameTimer);

  B.load({ mediaId: 'b', title: 'b', pcmPath: trackB, bpm: 124 });
  B.play();
  mixer.applyMixer({ crossfader: 0 });
  run(mixer, FRAMES);
  report('two decks, unity rate', mixer.frameTimer);

  // Off unity is the case that actually exercises the interpolator, and it is
  // where a DJ spends the whole set.
  A.applySettings({ rate: 1.06 });
  B.applySettings({ rate: 0.94 });
  run(mixer, FRAMES);
  report('two decks, pitched ±6%', mixer.frameTimer);

  A.applySettings({ rate: 2 });
  B.applySettings({ rate: 0.5 });
  run(mixer, FRAMES);
  report('two decks, pitched to the rails', mixer.frameTimer);

  A.applySettings({ rate: 1.06 });
  B.applySettings({ rate: 0.94 });
  A.setEq({ low: -8, mid: 3, high: -26 });
  B.setEq({ low: 4, mid: -12, high: 2 });
  A.setFilter(-0.6);
  B.setFilter(0.5);
  mixer.applyMixer({ masterEq: { low: 2, mid: -3, high: 1 }, limiter: true });
  run(mixer, FRAMES);
  report('+ EQ, filters, master EQ', mixer.frameTimer);

  mixer.applyMixer({ fx: { type: 'echo', mix: 0.6, timeMs: 375, feedback: 0.6, tone: 0.7 } });
  A.applySettings({ fxSend: 0.8 });
  B.applySettings({ fxSend: 0.5 });
  run(mixer, FRAMES);
  report('+ echo send', mixer.frameTimer);

  mixer.applyMixer({ fx: { type: 'reverb' } });
  run(mixer, FRAMES);
  report('+ reverb send', mixer.frameTimer);

  for (let i = 0; i < PAD_COUNT; i++) {
    mixer.pads[i].assign('stab', 'stab', stab);
    mixer.pads[i].trigger();
  }
  run(mixer, FRAMES);
  report('+ eight pads firing', mixer.frameTimer);

  const [, p95] = mixer.frameTimer.percentiles();
  console.log();
  console.log(
    p95 < FRAME_MS * 0.5
      ? `  headroom: p95 is ${((p95 / FRAME_MS) * 100).toFixed(1)}% of budget under full load.`
      : `  WARNING: p95 is ${((p95 / FRAME_MS) * 100).toFixed(1)}% of budget — little room left.`,
  );
} finally {
  mixer.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
}
