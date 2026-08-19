import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useReducedMotion, useReveal } from './beat';

/**
 * The difference, on a crossfader.
 *
 * The whole pitch is one category distinction - a music bot queues links, a
 * booth mixes records - so it is made with the control that draws the line.
 * Ride the fader and the sentences change under it. Nobody has to be told what
 * a crossfader does; the page just hands them one.
 *
 * The position lives in a ref and is written straight to a CSS variable. A
 * drag is sixty frames a second of a number changing, and none of those frames
 * are worth a React render.
 */

export type Contrast = { them: string; us: string; body: string };

/** Where the fader rides in after the section arrives - mostly deck, not all. */
const SETTLE = 0.72;

export function Crossfade({ items }: { items: readonly Contrast[] }) {
  const [rootRef, shown] = useReveal<HTMLDivElement>();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const capRef = useRef<HTMLDivElement | null>(null);
  const value = useRef(0);
  const [touched, setTouched] = useState(false);
  const reduced = useReducedMotion();

  const put = (next: number) => {
    const x = Math.min(1, Math.max(0, next));
    value.current = x;
    rootRef.current?.style.setProperty('--x', x.toFixed(4));
    capRef.current?.setAttribute('aria-valuenow', String(Math.round(x * 100)));
  };

  // The fader rides itself in the first time you see it: the demonstration is
  // the invitation, and a control that has already moved once reads as one you
  // are allowed to move.
  useEffect(() => {
    if (!shown) return;
    if (reduced) {
      put(SETTLE);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 1450);
      put(SETTLE * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [shown, reduced]);

  const fromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const box = track.getBoundingClientRect();
    put((clientX - box.left) / Math.max(1, box.width));
  };

  const onDown = (event: ReactPointerEvent) => {
    event.preventDefault();
    setTouched(true);
    (event.target as Element).setPointerCapture?.(event.pointerId);
    rootRef.current?.classList.add('is-riding');
    fromPointer(event.clientX);
  };

  const onMove = (event: ReactPointerEvent) => {
    if (event.buttons === 0) return;
    fromPointer(event.clientX);
  };

  const onUp = () => rootRef.current?.classList.remove('is-riding');

  const onKey = (event: ReactKeyboardEvent) => {
    const step = event.shiftKey ? 0.02 : 0.08;
    const moves: Record<string, number> = {
      ArrowLeft: -step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowUp: step,
    };
    if (event.key in moves) {
      event.preventDefault();
      setTouched(true);
      put(value.current + moves[event.key]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      put(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      put(1);
    }
  };

  return (
    <div className="xf" ref={rootRef}>
      <div className="xf-stage">
        {items.map((item) => (
          <div className="xf-row" key={item.us}>
            <div className="xf-line">
              <span className="xf-them">{item.them}</span>
              <span className="xf-us">
                <strong>deck</strong>
                {item.us.replace(/^deck/, '')}
              </span>
            </div>
            <p>{item.body}</p>
          </div>
        ))}
        <div className="xf-seam" aria-hidden="true" />
      </div>

      <div className="xf-desk">
        <span className="xf-end is-them">Music bot</span>
        <div className="xf-track" ref={trackRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          <span className="xf-track-fill" aria-hidden="true" />
          <div
            className="xf-cap"
            ref={capRef}
            role="slider"
            tabIndex={0}
            aria-label="How much deck is in the mix"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            aria-valuetext="Crossfade between a music bot and a booth"
            onKeyDown={onKey}
          />
          {touched ? null : <span className="xf-hint">drag me</span>}
        </div>
        <span className="xf-end is-us">deck</span>
      </div>
    </div>
  );
}
