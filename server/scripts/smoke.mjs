/**
 * Audio engine smoke test — exercises the realtime path without Discord or
 * ffmpeg by synthesising raw PCM directly.
 *
 *   npm run build -w server && npm run smoke -w server
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Mixer } from '../dist/audio/mixer.js';
import { FRAME_SAMPLES, SAMPLE_RATE } from '../dist/protocol.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-smoke-'));
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

/** Write a stereo sine sweep of `seconds` length as 48k s16le. */
function writeSine(file, seconds, freq = 440) {
  const frames = Math.round(SAMPLE_RATE * seconds);
  const buf = Buffer.allocUnsafe(frames * 4);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * 0.8 * 32767);
    buf.writeInt16LE(v, i * 4);
    buf.writeInt16LE(v, i * 4 + 2);
  }
  fs.writeFileSync(file, buf);
  return file;
}

/** Peak sample of a rendered frame, normalised to 0..1. */
function framePeak(frame) {
  let peak = 0;
  for (let i = 0; i < frame.length; i += 2) {
    const v = Math.abs(frame.readInt16LE(i)) / 32768;
    if (v > peak) peak = v;
  }
  return peak;
}

/** Peak of one channel only, for anything that moves the stereo image. */
function channelPeak(frame, channel) {
  let peak = 0;
  for (let i = channel * 2; i < frame.length; i += 4) {
    const v = Math.abs(frame.readInt16LE(i)) / 32768;
    if (v > peak) peak = v;
  }
  return peak;
}

function renderPeak(mixer, frames) {
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, framePeak(mixer.renderFrame()));
  return peak;
}

function renderChannelPeaks(mixer, frames) {
  let left = 0;
  let right = 0;
  for (let i = 0; i < frames; i++) {
    const out = mixer.renderFrame();
    left = Math.max(left, channelPeak(out, 0));
    right = Math.max(right, channelPeak(out, 1));
  }
  return [left, right];
}

console.log('audio engine smoke test');

const shortFile = writeSine(path.join(tmp, 'short.pcm'), 4);
// Larger than the 28 MB preload threshold, so this one streams through the
// sliding window instead of sitting in RAM.
const longFile = writeSine(path.join(tmp, 'long.pcm'), 170, 220);

const mixer = new Mixer();
try {
  const { A, B } = mixer.decks;

  // --- format ------------------------------------------------------------
  const frame = mixer.renderFrame();
  check('frame is one 20 ms Opus frame', frame.length === FRAME_SAMPLES * 4, `got ${frame.length}`);
  check('silent when idle', framePeak(frame) === 0);

  // --- playback ----------------------------------------------------------
  A.load({ mediaId: 'short', title: 'sine', pcmPath: shortFile, bpm: null });
  check('duration read from file', Math.abs(A.durationMs - 4000) < 2, `${A.durationMs}ms`);

  A.play();
  mixer.applyMixer({ crossfader: -1, master: 1 });
  let peak = renderPeak(mixer, 30);
  check('deck A audible on the A side of the crossfader', peak > 0.4, `peak ${peak.toFixed(3)}`);
  check('transport advanced', A.positionMs > 500, `${A.positionMs.toFixed(0)}ms`);

  mixer.applyMixer({ crossfader: 1 });
  renderPeak(mixer, 20); // let the constant-power fade settle
  peak = renderPeak(mixer, 20);
  check('crossfading away silences deck A', peak < 0.02, `peak ${peak.toFixed(4)}`);

  // --- eq ----------------------------------------------------------------
  mixer.applyMixer({ crossfader: -1 });
  renderPeak(mixer, 25);
  const flat = renderPeak(mixer, 25);
  A.setEq({ low: -26, mid: -26, high: -26 });
  renderPeak(mixer, 25);
  const cut = renderPeak(mixer, 25);
  check('full EQ cut attenuates the signal', cut < flat * 0.3, `${cut.toFixed(3)} vs ${flat.toFixed(3)}`);
  A.setEq({ low: 0, mid: 0, high: 0 });

  // --- transport ---------------------------------------------------------
  A.seekMs(2000);
  check('seek lands on the requested position', Math.abs(A.positionMs - 2000) < 1);

  A.setLoop(true, 1000, 1200);
  A.seekMs(1150);
  renderPeak(mixer, 20); // 400 ms of audio through a 200 ms loop
  check('loop wraps inside its window', A.positionMs >= 1000 && A.positionMs < 1200, `${A.positionMs.toFixed(0)}ms`);
  A.setLoop(false);

  A.seekMs(3990);
  A.play();
  renderPeak(mixer, 20);
  check('stops at the end of the track', !A.playing);

  // --- windowed source ---------------------------------------------------
  B.load({ mediaId: 'long', title: 'long sine', pcmPath: longFile, bpm: null });
  check('long file duration', Math.abs(B.durationMs - 170_000) < 5, `${B.durationMs}ms`);
  B.seekMs(120_000);
  B.play();
  mixer.applyMixer({ crossfader: 1 });
  renderPeak(mixer, 20);
  peak = renderPeak(mixer, 30);
  check('streams a file larger than the preload limit', peak > 0.4, `peak ${peak.toFixed(3)}`);

  B.rate = 2;
  const before = B.positionMs;
  renderPeak(mixer, 50);
  const advanced = B.positionMs - before;
  check('double rate advances twice as fast', Math.abs(advanced - 2000) < 60, `${advanced.toFixed(0)}ms`);
  B.rate = 1;

  // --- pads ---------------------------------------------------------------
  const pad = mixer.pads[0];
  pad.assign('short', 'sine', shortFile);
  pad.set({ gain: 1 });
  B.pause();
  mixer.applyMixer({ crossfader: 0, padBus: 1, padDuck: 0 });
  renderPeak(mixer, 20);
  pad.trigger();
  peak = renderPeak(mixer, 20);
  check('pad plays over the decks', peak > 0.3, `peak ${peak.toFixed(3)}`);
  pad.stop();

  // --- mute, pan and balance ------------------------------------------------
  // On the long file from here on: these sections run through more audio than
  // the short one holds, and a deck that has quietly run off the end would let
  // every "this is now silent" check pass for the wrong reason.
  B.seekMs(10_000);
  B.play();
  mixer.applyMixer({ crossfader: 1, master: 1, balance: 0, masterEq: { low: 0, mid: 0, high: 0 } });
  renderPeak(mixer, 30);
  const audible = renderPeak(mixer, 20);
  check('deck B is the reference for the mix tests', audible > 0.4, `peak ${audible.toFixed(3)}`);

  B.applySettings({ muted: true });
  renderPeak(mixer, 25);
  peak = renderPeak(mixer, 20);
  check('mute takes the channel off the master', peak < 0.02, `peak ${peak.toFixed(4)}`);
  B.applySettings({ muted: false });

  B.applySettings({ pan: -1 });
  renderPeak(mixer, 30);
  let [left, right] = renderChannelPeaks(mixer, 20);
  check(
    'hard left pan empties the right channel',
    left > 0.4 && right < left * 0.05,
    `${left.toFixed(3)} / ${right.toFixed(3)}`,
  );
  B.applySettings({ pan: 0 });

  mixer.applyMixer({ balance: 1 });
  renderPeak(mixer, 30);
  [left, right] = renderChannelPeaks(mixer, 20);
  check(
    'balance hard right empties the left channel',
    right > 0.4 && left < right * 0.05,
    `${left.toFixed(3)} / ${right.toFixed(3)}`,
  );
  mixer.applyMixer({ balance: 0 });

  // --- master eq -----------------------------------------------------------
  renderPeak(mixer, 25);
  const masterFlat = renderPeak(mixer, 25);
  mixer.applyMixer({ masterEq: { low: -26, mid: -26, high: -26 } });
  renderPeak(mixer, 25);
  const masterCut = renderPeak(mixer, 25);
  check(
    'master EQ cuts the whole output',
    masterFlat > 0.4 && masterCut < masterFlat * 0.3,
    `${masterCut.toFixed(3)} vs ${masterFlat.toFixed(3)}`,
  );
  mixer.applyMixer({ masterEq: { low: 0, mid: 0, high: 0 } });

  // --- crossfader curve ----------------------------------------------------
  // Half travel towards B: the blend law is still climbing there, the cut law
  // is already wide open.
  mixer.applyMixer({ crossfader: 0.5, crossfaderCurve: 0 });
  renderPeak(mixer, 40);
  const blended = renderPeak(mixer, 20);
  mixer.applyMixer({ crossfaderCurve: 1 });
  renderPeak(mixer, 40);
  const cutCurve = renderPeak(mixer, 20);
  check(
    'a sharp crossfader curve reaches full level sooner',
    cutCurve > blended * 1.03,
    `${cutCurve.toFixed(3)} vs ${blended.toFixed(3)}`,
  );
  mixer.applyMixer({ crossfader: 1, crossfaderCurve: 0 });

  // --- effects bus ---------------------------------------------------------
  // The source is stopped, so anything still audible is the echo ringing out of
  // the bus rather than the deck itself.
  mixer.applyMixer({ fx: { type: 'echo', mix: 1, timeMs: 400, feedback: 0.6, tone: 1 } });
  B.applySettings({ fxSend: 1 });
  renderPeak(mixer, 60);
  B.pause();
  renderPeak(mixer, 25); // let the deck's own fade finish
  const tail = renderPeak(mixer, 25);
  check('the effects bus rings on after the source stops', tail > 0.02, `peak ${tail.toFixed(4)}`);

  mixer.applyMixer({ fx: { mix: 0 } });
  renderPeak(mixer, 30);
  const closed = renderPeak(mixer, 20);
  check('a closed return silences the bus', closed < 0.005, `peak ${closed.toFixed(4)}`);
  B.applySettings({ fxSend: 0 });

  // --- limiter -------------------------------------------------------------
  A.seekMs(0);
  A.play();
  A.trim = 2;
  A.gain = 1.25;
  mixer.applyMixer({ crossfader: -1, master: 1.5, limiter: true });
  let clipped = false;
  for (let i = 0; i < 40; i++) {
    const out = mixer.renderFrame();
    for (let j = 0; j < out.length; j += 2) {
      const v = out.readInt16LE(j);
      if (v === -32768 || Number.isNaN(v)) clipped = true;
    }
  }
  check('master limiter keeps samples in range', !clipped);
  check('limiter reports its gain reduction', mixer.meters().reduction < 0.99, `${mixer.meters().reduction.toFixed(3)}`);

  // --- mono ----------------------------------------------------------------
  A.trim = 1;
  A.gain = 0.85;
  A.applySettings({ pan: -1 });
  mixer.applyMixer({ master: 1, mono: true });
  renderPeak(mixer, 40);
  [left, right] = renderChannelPeaks(mixer, 20);
  check(
    'mono sums a hard-panned channel back to both sides',
    Math.abs(left - right) < 0.02,
    `${left.toFixed(3)} / ${right.toFixed(3)}`,
  );
} finally {
  mixer.destroy();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
