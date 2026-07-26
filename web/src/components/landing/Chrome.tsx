import { useEffect, useRef, useState } from 'react';
import { BPM, useFrame, useReducedMotion } from './beat';

/**
 * The page, wearing the console's chrome.
 *
 * A booth always tells you two things without being asked: where you are in
 * the track, and that the clock is still running. So does this page. The strip
 * bottom-left is a now-playing readout where the track is the section you are
 * reading and the elapsed time is how far you have scrolled; the rail down the
 * right is the same information as a fader you can grab.
 *
 * Both update from the shared clock by writing to the DOM directly. Sixty
 * renders a second to move a bar four pixels would be a strange way to prove
 * the page is not heavy.
 */

export type Marker = { id: string; label: string };

/** Turns a 0–1 position into a plausible-looking set time. */
function clock(progress: number) {
  const total = 42 * 60;
  const at = Math.round(progress * total);
  return `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`;
}

export function Chrome({ markers }: { markers: readonly Marker[] }) {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();

  const fillRef = useRef<HTMLSpanElement | null>(null);
  const capRef = useRef<HTMLSpanElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);
  // The clock ticks sixty times a second and the bar count changes twice a
  // second. Writing it anyway would be sixty pointless text-node swaps.
  const shownBar = useRef(-1);
  // The scrollable height is a layout read, so it is taken on resize rather
  // than sixty times a second on the way down the page.
  const span = useRef(1);

  useEffect(() => {
    const measure = () => {
      span.current = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    const timer = window.setInterval(measure, 2000);
    return () => {
      window.removeEventListener('resize', measure);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const nodes = markers
      .map((marker) => document.getElementById(marker.id))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = markers.findIndex((marker) => marker.id === entry.target.id);
          if (index >= 0) setActive(index);
        }
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [markers]);

  useFrame((frame) => {
    const progress = Math.min(1, Math.max(0, window.scrollY / span.current));
    const percent = `${(progress * 100).toFixed(2)}%`;
    if (fillRef.current) fillRef.current.style.width = percent;
    if (capRef.current) capRef.current.style.top = percent;
    if (timeRef.current) timeRef.current.textContent = clock(progress);

    const bar = (Math.floor(frame.beats / 4) % 64) + 1;
    if (barRef.current && !reduced && bar !== shownBar.current) {
      shownBar.current = bar;
      barRef.current.textContent = String(bar).padStart(2, '0');
    }
  });

  return (
    <>
      <aside className="home-nowplaying" aria-hidden="true">
        <span className="home-np-head">
          <span className="home-np-dot" />
          Now playing
        </span>
        <strong className="home-np-title">{markers[active]?.label ?? 'Intro'}</strong>
        <span className="home-np-bar">
          <span className="home-np-fill" ref={fillRef} />
        </span>
        <span className="home-np-meta mono">
          <span ref={timeRef}>0:00</span>
          <span>
            {BPM.toFixed(1)} BPM · BAR <span ref={barRef}>01</span>
          </span>
        </span>
      </aside>

      <nav className="home-rail" aria-label="Sections">
        <span className="home-rail-track" aria-hidden="true">
          <span className="home-rail-cap" ref={capRef} />
        </span>
        <ul>
          {markers.map((marker, index) => (
            <li key={marker.id} className={index === active ? 'is-active' : ''}>
              <a href={`#${marker.id}`}>
                <span className="home-rail-tick" aria-hidden="true" />
                <span className="home-rail-label">{marker.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

/* -------------------------------------------------------------- readout */

/** The live transport line under the headline: tempo, bar, and an on-air lamp. */
export function Readout() {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const beatRef = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(-1);
  const reduced = useReducedMotion();

  useFrame((frame) => {
    if (reduced) return;
    // One write per beat, not one per frame: the attribute drives a style
    // recalculation, and setting it to the value it already has is not free.
    const beats = Math.floor(frame.beats);
    if (beats === shown.current) return;
    shown.current = beats;
    if (beatRef.current) beatRef.current.dataset.beat = String((beats % 4) + 1);
    if (barRef.current) {
      barRef.current.textContent = String((Math.floor(beats / 4) % 999) + 1).padStart(3, '0');
    }
  });

  return (
    <div className="home-readout mono">
      <span className="home-readout-live">
        <i />
        On air
      </span>
      <span>{BPM.toFixed(1)} BPM</span>
      <span>
        BAR <span ref={barRef}>001</span>
      </span>
      <span className="home-readout-beats" ref={beatRef} data-beat="1" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
