/**
 * Tempo maths for the deck tools.
 *
 * Loop points and cue points are stored in *source* milliseconds — the deck
 * advances its read head by `rate` frames per output frame — so a beat is
 * always 60000 / bpm here, regardless of where the pitch fader sits. Only the
 * tempo the room hears is rate-dependent.
 */

/** Length of one beat in source ms, or null when the track has no tempo. */
export function beatMs(bpm: number | null): number | null {
  return bpm && bpm > 0 ? 60000 / bpm : null;
}

/** The tempo the room actually hears once the pitch fader is off centre. */
export function playingBpm(bpm: number | null, rate: number): number | null {
  return bpm && bpm > 0 ? bpm * rate : null;
}

/**
 * Playback rate that lands this deck on the target tempo. Halves or doubles
 * until the match sits inside the deck's 0.5x–2x range, so a 174 bpm drum
 * track can ride alongside a 87 bpm house track instead of refusing to sync.
 */
export function syncRate(bpm: number | null, targetBpm: number | null): number | null {
  if (!bpm || !targetBpm || bpm <= 0 || targetBpm <= 0) return null;
  let rate = targetBpm / bpm;
  while (rate > 2) rate /= 2;
  while (rate < 0.5) rate *= 2;
  return rate;
}

/** Beat divisions offered by the loop roll, shortest first. */
export const BEAT_LOOPS = [
  { beats: 0.25, label: '1/4' },
  { beats: 0.5, label: '1/2' },
  { beats: 1, label: '1' },
  { beats: 2, label: '2' },
  { beats: 4, label: '4' },
  { beats: 8, label: '8' },
] as const;

/** How many beats a loop of this length spans, or null if it isn't a clean fit. */
export function loopBeats(lengthMs: number, bpm: number | null): number | null {
  const beat = beatMs(bpm);
  if (!beat || lengthMs <= 0) return null;
  const beats = lengthMs / beat;
  // Within 2% of a division counts as that division; anything else is a
  // hand-set loop and gets shown in seconds instead.
  const nearest = BEAT_LOOPS.find((option) => Math.abs(beats - option.beats) < option.beats * 0.02);
  return nearest ? nearest.beats : null;
}
