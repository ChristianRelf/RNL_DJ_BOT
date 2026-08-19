import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { bump, useFrame } from './beat';

/**
 * The page is one track, and you are scrubbing through it.
 *
 * There is a single mechanism here and everything else on the page is hung off
 * it. Down the left runs the whole set drawn as one waveform, the full height
 * of the document. A playhead sits fixed at 40% of the window. Scrolling drags
 * the waveform past the playhead; the part that has gone by is lit, the part
 * still to come is not. Every piece of copy on the page is a cue point on that
 * waveform, and it goes live at the moment it crosses the head - the lamp
 * lights, the transport at the bottom renames itself, and the light behind the
 * page flares.
 *
 * That is the whole design. There are no sections, no cards and no separate
 * treatments to invent per block: a page laid out as one instrument reads as
 * one thing, and a page laid out as eleven boxes reads as eleven pages.
 */

/** Where the head sits in the window, as a fraction of its height. */
const PLAYHEAD = 0.4;
const LiveCue = createContext<string | null>(null);

/* --------------------------------------------------------------- the wave */

const BARS = 560;

/**
 * The shape of a set: in quietly, up to a first peak, a breakdown two thirds
 * of the way through, a second peak, and out. Deterministic - it draws the
 * same waveform on every visit, because it is the same track every time.
 */
function envelope(i: number) {
  const t = i / BARS;
  const arc =
    Math.min(1, t * 7) *
    Math.min(1, (1 - t) * 6) *
    (1 - 0.62 * Math.exp(-Math.pow((t - 0.62) / 0.05, 2))) *
    (0.72 + 0.28 * Math.sin(t * 7.4));
  const grain =
    Math.abs(Math.sin(i * 0.71)) * 0.5 +
    Math.abs(Math.sin(i * 0.23 + 1.7)) * 0.32 +
    Math.abs(Math.sin(i * 1.93)) * 0.18;
  return 0.08 + arc * grain * 0.92;
}

/** One path, 560 little rectangles, mirrored about the middle of the column. */
const WAVE = Array.from({ length: BARS }, (_, i) => {
  const a = envelope(i) * 47;
  return `M${50 - a} ${i}h${a * 2}v0.58h${-a * 2}z`;
}).join('');

/* ------------------------------------------------------------------- mix */

export function Mix({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const spineRef = useRef<HTMLDivElement | null>(null);
  const beamRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const [live, setLive] = useState<{ id: string; n: string; label: string } | null>(null);
  // The playhead only moves when the page scrolls, so the clip and the fill
  // are only rewritten when they would actually change.
  const drawn = useRef(-1);

  // The document offset and height of the mix. Both are layout reads, so they
  // are taken when the page changes shape rather than once a frame.
  const box = useRef({ top: 0, height: 1 });

  useEffect(() => {
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      box.current = { top: rect.top + window.scrollY, height: Math.max(1, rect.height) };
    };
    measure();
    window.addEventListener('resize', measure);
    // Fonts landing and details opening both change the height under us.
    const timer = window.setInterval(measure, 1500);
    return () => {
      window.removeEventListener('resize', measure);
      window.clearInterval(timer);
    };
  }, []);

  // One observer, one zero-height band across the window at the playhead.
  // Whatever is crossing that line is the cue you are on - the same rule the
  // lit half of the waveform is drawn by, so the two can never disagree.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const cues = Array.from(root.querySelectorAll<HTMLElement>('[data-cue]'));
    if (!cues.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          setLive((prev) => {
            if (prev?.id === el.id) return prev;
            // Every cue crossing the head is a hit, and the light behind the
            // page answers it. That is what ties the two together.
            bump(0.7);
            return { id: el.id, n: el.dataset.cue ?? '', label: el.dataset.label ?? '' };
          });
        }
      },
      { rootMargin: `-${PLAYHEAD * 100}% 0px -${100 - PLAYHEAD * 100}% 0px` },
    );
    cues.forEach((cue) => observer.observe(cue));
    return () => observer.disconnect();
  }, []);

  useFrame((frame) => {
    const { top, height } = box.current;
    const head = window.scrollY + window.innerHeight * PLAYHEAD - top;
    const played = Math.min(height, Math.max(0, head));

    // The beam answers cue hits, so it is written every frame; the playhead is
    // only written when it has actually moved.
    if (beamRef.current) beamRef.current.style.opacity = (0.06 + frame.energy * 0.5).toFixed(3);
    if (Math.abs(played - drawn.current) < 0.5) return;
    drawn.current = played;

    const progress = played / height;
    spineRef.current?.style.setProperty('--played', `${played.toFixed(1)}px`);
    if (fillRef.current) fillRef.current.style.width = `${(progress * 100).toFixed(2)}%`;
  });

  return (
    <LiveCue.Provider value={live?.id ?? null}>
      <div className="mix" ref={rootRef}>
        <div className="spine" ref={spineRef} aria-hidden="true">
          <svg className="spine-wave" viewBox={`0 0 100 ${BARS}`} preserveAspectRatio="none">
            <path d={WAVE} />
          </svg>
          <svg className="spine-wave is-lit" viewBox={`0 0 100 ${BARS}`} preserveAspectRatio="none">
            <path d={WAVE} />
          </svg>
          <span className="spine-head" />
        </div>

        {/* The head, carried across the page. It stays almost invisible until a
            cue lands on it, which is the only time it has anything to say. */}
        <div className="mix-beam" ref={beamRef} aria-hidden="true" />

        {children}
      </div>

      <div className="transport">
        <span className="transport-now mono">
          <b>{live?.n ?? '01'}</b>
          {live?.label ?? 'Intro'}
        </span>
        <span className="transport-track">
          <span className="transport-fill" ref={fillRef} />
        </span>
        <a className="transport-cta" href="/home/access">
          Request access
        </a>
      </div>
    </LiveCue.Provider>
  );
}

/* ------------------------------------------------------------------ cue */

/**
 * One cue point. Every block on the page is one of these and they all have the
 * same anatomy - mark, number, label, statement, and whatever the cue is
 * actually about. The uniformity is the point: it is one track.
 */
export function Cue({
  id,
  n,
  label,
  statement,
  lede,
  lead,
  children,
}: {
  id: string;
  n: string;
  label: string;
  statement?: ReactNode;
  lede?: string;
  /** The opening cue runs at a larger size; nothing else varies. */
  lead?: boolean;
  children?: ReactNode;
}) {
  const isLive = useContext(LiveCue) === id;
  // The opening cue is the page's heading; every other cue is a section of it.
  const Statement = lead ? 'h1' : 'h2';

  return (
    <section
      className={`cue ${lead ? 'is-lead' : ''} ${isLive ? 'is-live' : ''}`}
      id={id}
      data-cue={n}
      data-label={label}
    >
      <span className="cue-mark" aria-hidden="true" />
      <span className="cue-label mono">
        <b>{n}</b>
        {label}
      </span>
      {statement ? <Statement className="cue-statement">{statement}</Statement> : null}
      {lede ? <p className="cue-lede">{lede}</p> : null}
      {children}
    </section>
  );
}
