/**
 * The console, drawn.
 *
 * Deliberately an illustration rather than a screenshot: it never goes stale,
 * costs nothing to ship, and does not need a rig running to render. What it is
 * *not* allowed to be is a different product — so it mirrors the real console
 * panel for panel, in the same grid, with the same chrome: top bar, media pool,
 * two decks, the mixer, the pads and the queue.
 *
 * Every envelope comes from a fixed formula, so it renders identically every
 * time. The only motion is on the meters, which is the one part of a console
 * that really is always moving.
 */

const BARS = 88;
const WIDTH = 420;
const HEIGHT = 40;

/** A plausible track envelope: a few detuned sines under a fade. */
function envelope(seed: number): number[] {
  return Array.from({ length: BARS }, (_, i) => {
    const t = i / BARS;
    const fade = Math.min(1, t * 9) * Math.min(1, (1 - t) * 9);
    const body =
      Math.abs(Math.sin(i * 0.68 + seed)) * 0.5 +
      Math.abs(Math.sin(i * 0.21 + seed * 2)) * 0.34 +
      Math.abs(Math.sin(i * 1.83 + seed)) * 0.16;
    return 0.1 + fade * body * 0.9;
  });
}

/* ------------------------------------------------------------- pieces */

function Knob({ label, turn, value }: { label: string; turn: number; value: string }) {
  const angle = -135 + turn * 270;
  const sweep = Math.abs(turn - 0.5) * 0.75 * 94;
  return (
    <span className="pv-knob">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="pv-knob-track" cx="20" cy="20" r="15" />
        <circle
          className="pv-knob-arc"
          cx="20"
          cy="20"
          r="15"
          style={{ strokeDasharray: `${sweep} 999`, strokeDashoffset: -Math.min(turn, 0.5) * 0.75 * 94 }}
        />
        <line
          className="pv-knob-pointer"
          x1="20"
          y1="7"
          x2="20"
          y2="14"
          style={{ transform: `rotate(${angle}deg)`, transformOrigin: '20px 20px' }}
        />
      </svg>
      <span className="pv-label">{label}</span>
      <span className="pv-value">{value}</span>
    </span>
  );
}

function Fader({ at, tone }: { at: number; tone?: 'a' | 'b' }) {
  return (
    <span className={`pv-fader ${tone ? `is-${tone}` : ''}`}>
      <span className="pv-fader-fill" style={{ height: `${at * 100}%` }} />
      <span className="pv-fader-cap" style={{ bottom: `${at * 100}%` }} />
    </span>
  );
}

function Meter({ delay = 0 }: { delay?: number }) {
  return (
    <span className="pv-meter">
      <span className="pv-meter-fill" style={{ animationDelay: `${delay}s` }} />
      <span className="pv-meter-fill" style={{ animationDelay: `${delay - 0.7}s` }} />
    </span>
  );
}

/** One deck tile: title strip, waveform, transport row, pitch. */
function Deck({
  id,
  title,
  bpm,
  seed,
  head,
  playing,
  loop,
}: {
  id: 'A' | 'B';
  title: string;
  bpm: string;
  seed: number;
  head: number;
  playing?: boolean;
  loop?: [number, number];
}) {
  const peaks = envelope(seed);
  const mid = HEIGHT / 2;
  const step = WIDTH / BARS;

  return (
    <div className={`pv-panel pv-deck is-deck-${id.toLowerCase()}`}>
      <div className="pv-panel-head">
        <span className="pv-panel-title">Deck {id}</span>
        <span className="pv-bpm mono">{bpm}</span>
      </div>

      <div className="pv-track">
        <span className="pv-badge">{id}</span>
        <span className="pv-track-title">{title}</span>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="pv-wave" aria-hidden="true">
        {loop ? (
          <rect
            x={loop[0] * WIDTH}
            y="0"
            width={(loop[1] - loop[0]) * WIDTH}
            height={HEIGHT}
            className="pv-loop"
          />
        ) : null}
        {peaks.map((peak, i) => {
          const h = peak * (HEIGHT - 6);
          return (
            <rect
              key={i}
              x={i * step}
              y={mid - h / 2}
              width={Math.max(1, step - 1)}
              height={h}
              className={i * step < head * WIDTH ? 'pv-bar is-played' : 'pv-bar'}
            />
          );
        })}
        <rect x={head * WIDTH - 1} y="0" width="2" height={HEIGHT} className="pv-head" />
      </svg>

      <div className="pv-transport">
        <span className={`pv-btn ${playing ? 'is-play' : ''}`}>{playing ? '❚❚' : '▶'}</span>
        <span className="pv-btn">CUE</span>
        <span className="pv-btn">SYNC</span>
        <span className={`pv-btn ${loop ? 'is-on' : ''}`}>4</span>
        <span className="pv-time mono">{playing ? '2:41' : '0:38'}</span>
      </div>

      <div className="pv-pitch">
        <span className="pv-label">PITCH</span>
        <span className="pv-pitch-track">
          <span className="pv-pitch-cap" style={{ left: id === 'A' ? '50%' : '58%' }} />
        </span>
        <span className="pv-value mono">{id === 'A' ? '0.0%' : '+1.6%'}</span>
      </div>
    </div>
  );
}

const POOL = [
  { title: 'Midnight Service', meta: '6:12 · 124' },
  { title: 'Concrete Garden', meta: '5:48 · 126' },
  { title: 'Sundial (dub)', meta: '7:03 · 122' },
  { title: 'Long Way Down', meta: '4:26 · 128' },
];

const QUEUE = [
  { n: 1, title: 'Sundial (dub)', by: 'ro' },
  { n: 2, title: 'Long Way Down', by: 'kit' },
];

const PADS = ['AIR', 'HORN', 'DROP', 'RISE', 'VOX', 'SNAP', 'FX', 'STOP'];

export function ConsolePreview() {
  return (
    <div
      className="pv"
      role="img"
      aria-label="Illustration of the deck console: media pool, two decks, the mixer, sample pads and the queue"
    >
      {/* Top bar — the real one carries the mark, the voice controls and who
          is holding the decks. */}
      <div className="pv-topbar">
        <img className="pv-mark" src="/deckLogo.png" alt="" />
        <span className="pv-chan">#the-booth</span>
        <span className="pv-live">
          <span className="pv-live-dot" />
          ON AIR · 14 listening
        </span>
        <span className="pv-holder">nova has control</span>
      </div>

      <div className="pv-grid">
        {/* Media pool */}
        <div className="pv-panel pv-pool">
          <div className="pv-panel-head">
            <span className="pv-panel-title">Media pool</span>
            <span className="pv-label">42</span>
          </div>
          <span className="pv-search">Search…</span>
          {POOL.map((item) => (
            <span className="pv-row" key={item.title}>
              <span className="pv-row-title">{item.title}</span>
              <span className="pv-row-meta mono">{item.meta}</span>
            </span>
          ))}
        </div>

        <Deck id="A" title="Midnight Service" bpm="124.0" seed={0.4} head={0.62} playing loop={[0.58, 0.72]} />

        {/* Mixer */}
        <div className="pv-panel pv-mixer">
          <div className="pv-panel-head">
            <span className="pv-panel-title">Mixer</span>
          </div>

          <div className="pv-strips">
            {(['a', 'b', 'm'] as const).map((strip) => (
              <div className={`pv-strip is-${strip}`} key={strip}>
                <span className="pv-strip-label">
                  {strip === 'm' ? 'MST' : strip.toUpperCase()}
                </span>
                <Knob label="HIGH" turn={strip === 'b' ? 0.42 : 0.5} value="0" />
                <Knob label="MID" turn={0.5} value="0" />
                <Knob label="LOW" turn={strip === 'a' ? 0.62 : 0.5} value="+2" />
                <span className="pv-strip-fader">
                  <Fader at={strip === 'b' ? 0.62 : 0.78} tone={strip === 'm' ? undefined : strip} />
                  <Meter delay={strip === 'b' ? -1.1 : 0} />
                </span>
              </div>
            ))}
          </div>

          <div className="pv-xf">
            <span className="pv-xf-track">
              <span className="pv-xf-cap" />
            </span>
            <span className="pv-label">CROSSFADER</span>
          </div>
        </div>

        <Deck id="B" title="Concrete Garden" bpm="126.0" seed={2.7} head={0.24} />

        {/* Pads */}
        <div className="pv-panel pv-pads">
          <div className="pv-panel-head">
            <span className="pv-panel-title">Sample pads</span>
          </div>
          <div className="pv-pad-grid">
            {PADS.map((pad, i) => (
              <span className={`pv-pad ${i === 2 ? 'is-lit' : ''}`} key={pad}>
                {pad}
              </span>
            ))}
          </div>
        </div>

        {/* Queue */}
        <div className="pv-panel pv-queue">
          <div className="pv-panel-head">
            <span className="pv-panel-title">Queue</span>
            <span className="pv-label">AUTO</span>
          </div>
          {QUEUE.map((item) => (
            <span className="pv-row" key={item.n}>
              <span className="pv-row-index mono">{item.n}</span>
              <span className="pv-row-title">{item.title}</span>
              <span className="pv-row-meta">{item.by}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
