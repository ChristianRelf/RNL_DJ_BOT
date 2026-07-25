import type { Meters } from '../protocol';

const EMPTY: Meters = {
  master: [0, 0],
  A: [0, 0],
  B: [0, 0],
  pads: [0, 0],
  clip: false,
};

type Listener = (meters: Meters) => void;

/**
 * Level meters arrive ~15 times a second. Routing them through React state
 * would re-render the whole console at that rate, so they ride an external
 * bus instead and the meter components write straight to the DOM.
 */
class MeterBus {
  private value: Meters = EMPTY;
  private listeners = new Set<Listener>();

  publish(meters: Meters): void {
    this.value = meters;
    for (const listener of this.listeners) listener(meters);
  }

  reset(): void {
    this.publish(EMPTY);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.value);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const meterBus = new MeterBus();

/** Maps a linear 0..1 peak onto a meter scale that behaves like a real VU. */
export function meterScale(peak: number): number {
  if (peak <= 0.0005) return 0;
  const db = 20 * Math.log10(peak);
  const floor = -48;
  return Math.max(0, Math.min(1, (db - floor) / -floor));
}
