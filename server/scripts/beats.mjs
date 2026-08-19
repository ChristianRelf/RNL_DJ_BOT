/**
 * Beat-grid fitting checks.
 *
 *   npm run build -w server && npm run beats -w server
 *
 * Detection itself is aubio's job. What is tested here is the part this repo
 * owns: turning a noisy list of beat times - with gaps, extra beats and jitter,
 * which is what a real detector produces - into one tempo and one offset that
 * still line up with the music six minutes later.
 *
 * No aubio needed. The input to `fitGrid` is a list of numbers, so the fitting
 * can be held to a standard whether or not the binary is installed.
 */
// The module reaches for ffmpeg and aubio paths out of the config, and the
// config refuses to load without a real environment. The fitting itself is
// pure - a list of numbers in, a grid out - so a stub environment is enough to
// get at it, and is the honest way to say this test needs neither binary.
process.env.DISCORD_GUILD_ID ??= '0';
process.env.DISCORD_BOT_TOKEN ??= 'x';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DISCORD_CLIENT_SECRET ??= 'x';
process.env.SESSION_SECRET ??= 'x'.repeat(32);

const { fitGrid } = await import('../dist/audio/beatgrid.js');

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

/** Beat times for a steady track, with the wobble a real detector produces. */
function beats({ bpm, offsetMs = 0, seconds = 300, jitterMs = 0, drop = 0, add = 0, seed = 1 }) {
  // Deterministic noise: a failing run has to be reproducible.
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const period = 60000 / bpm;
  const out = [];
  for (let n = 0; n * period + offsetMs < seconds * 1000; n++) {
    if (drop > 0 && rand() < drop) continue;
    out.push(offsetMs + n * period + (rand() - 0.5) * 2 * jitterMs);
    // An extra beat where the detector heard a strong off-beat.
    if (add > 0 && rand() < add) out.push(offsetMs + (n + 0.5) * period);
  }
  return out;
}

console.log('beat grid fitting\n');

// --- the clean case -------------------------------------------------------
{
  const grid = fitGrid(beats({ bpm: 128, offsetMs: 250 }));
  check('finds the tempo of a steady track', grid && Math.abs(grid.bpm - 128) < 0.05, `${grid?.bpm}`);
  check(
    'finds where the first beat is',
    grid && Math.abs(grid.beatOffsetMs - 250) < 2,
    `${grid?.beatOffsetMs}ms`,
  );
  check('is confident about it', grid && grid.confidence > 0.99, `${grid?.confidence}`);
}

// --- the grid has to still be right at the end of the track ---------------
// This is the whole reason the period is refined rather than taken from the
// median interval: 0.1 bpm out at 128 is a third of a beat adrift by the sixth
// minute, which is the difference between a grid that holds a mix together and
// one that quietly slides off it.
{
  const grid = fitGrid(beats({ bpm: 128, offsetMs: 250, jitterMs: 6, seconds: 360 }));
  const period = 60000 / grid.bpm;
  const lastBeat = 250 + Math.floor((360000 - 250) / (60000 / 128)) * (60000 / 128);
  const n = Math.round((lastBeat - grid.beatOffsetMs) / period);
  const drift = Math.abs(grid.beatOffsetMs + n * period - lastBeat);
  check('the grid still lands on the beat six minutes in', drift < 12, `${drift.toFixed(1)}ms adrift`);
}

// --- what a real detector actually hands over -----------------------------
{
  const grid = fitGrid(beats({ bpm: 174, offsetMs: 90, jitterMs: 8, drop: 0.12, add: 0.08, seed: 7 }));
  check(
    'survives dropped and doubled beats',
    grid && Math.abs(grid.bpm - 174) < 0.5,
    `${grid?.bpm}`,
  );
}

// --- octave folding -------------------------------------------------------
{
  const slow = fitGrid(beats({ bpm: 61 }));
  check('folds a half-time reading up into range', slow && Math.abs(slow.bpm - 122) < 0.5, `${slow?.bpm}`);
  const fast = fitGrid(beats({ bpm: 200 }));
  check('folds a double-time reading down into range', fast && Math.abs(fast.bpm - 100) < 0.5, `${fast?.bpm}`);
}

// --- refusing is a valid answer -------------------------------------------
// A grid that is subtly wrong is worse than no grid: the console falls back to
// tapping when there is none, but everything downstream believes a bad one.
{
  let s = 99;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const noise = Array.from({ length: 400 }, () => rand() * 300000).sort((a, b) => a - b);
  check('refuses to grid something with no pulse', fitGrid(noise) === null);
  check('refuses a handful of beats', fitGrid([0, 500, 1000, 1500]) === null);
  check('refuses nothing at all', fitGrid([]) === null);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
