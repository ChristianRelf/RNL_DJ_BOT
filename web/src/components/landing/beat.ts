import { useEffect, useRef, useState } from 'react';

/**
 * The landing page runs on a clock.
 *
 * Everything that moves out front - the shader behind the page, the meters, the
 * headline, the readouts - is locked to one tempo, because the product is a DJ
 * booth and a booth that drifts out of time is not one. 124 BPM is the tempo of
 * the track in the console illustration, so the page and the picture agree.
 *
 * There is exactly one requestAnimationFrame loop for the whole page and it
 * only runs while something is subscribed. Anything that can be done in CSS is
 * done in CSS against `--beat` (below), which costs no frames at all; this hook
 * is for the handful of things that genuinely need a per-frame number - the
 * WebGL uniforms and the live readouts.
 */

const BPM = 124;
/** One beat, in seconds. The CSS side of this is `--beat`. */
export const BEAT_S = 60 / BPM;

export type Frame = {
  /** Seconds since the clock started. */
  t: number;
  /** Beats elapsed, fractional. */
  beats: number;
  /** 0 → 1 across the current beat. */
  beat: number;
  /** 0 → 1 across the current bar. */
  bar: number;
  /** Pad hits, decaying back to zero. Rest is 0, a fresh hit is about 1. */
  energy: number;
};

type Sub = (frame: Frame) => void;

const subs = new Set<Sub>();
let raf = 0;
let origin = 0;
let last = 0;
let energy = 0;

/**
 * Kicks the shared energy level. Every pad hit lands here, which is how a
 * click in one component ends up brightening a shader in another without the
 * two knowing about each other.
 */
export function bump(amount = 1) {
  energy = Math.min(2.4, energy + amount);
}

function tick(now: number) {
  raf = requestAnimationFrame(tick);

  // Clamped so a backgrounded tab returning after a minute does not arrive
  // with a single enormous step and blow the decay out.
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  energy = energy < 0.001 ? 0 : energy * Math.exp(-dt * 2.6);

  const t = (now - origin) / 1000;
  const beats = t / BEAT_S;
  const frame: Frame = { t, beats, beat: beats % 1, bar: (beats / 4) % 1, energy };
  for (const sub of subs) sub(frame);
}

/** Subscribes to the page clock for as long as the component is mounted. */
export function useFrame(callback: Sub) {
  const held = useRef(callback);
  held.current = callback;

  useEffect(() => {
    const sub: Sub = (frame) => held.current(frame);
    subs.add(sub);
    if (subs.size === 1) {
      // The origin is set once, ever: the beat has to survive the last
      // subscriber unmounting, or the page would restart mid-bar.
      if (!origin) origin = last = performance.now();
      else last = performance.now();
      raf = requestAnimationFrame(tick);
    }
    return () => {
      subs.delete(sub);
      if (subs.size === 0) cancelAnimationFrame(raf);
    };
  }, []);
}

/* ------------------------------------------------------------- helpers */

/** Whether the visitor has asked for less movement. Tracked, not sampled. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Fires once, the first time the element comes near the viewport. Used for
 * every entrance on the page, so nothing animates while it is off screen.
 */
export function useReveal<T extends Element>(rootMargin = '0px 0px -12% 0px') {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, shown] as const;
}

/** Like `useReveal`, but keeps tracking - for things that only act while seen. */
export function useOnScreen<T extends Element>(rootMargin = '0px') {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => setOn(entry.isIntersecting)),
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, on] as const;
}
