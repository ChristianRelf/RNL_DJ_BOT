/**
 * A stylised pair of decks for the licensing page.
 *
 * Deliberately a drawing rather than a screenshot: it stays honest about being
 * an illustration, never goes stale, and costs nothing to ship. The envelope is
 * generated from a fixed formula so it renders identically every time. Kept
 * spare on purpose — the more console furniture it grows, the more it reads as
 * a cheap imitation of the real thing.
 */

const BARS = 120;
const WIDTH = 640;
const HEIGHT = 56;

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

interface LaneProps {
  id: 'A' | 'B';
  title: string;
  colour: string;
  seed: number;
  /** Playhead position, 0..1. */
  head: number;
  /** Loop region as [start, end] in 0..1. */
  loop?: [number, number];
}

function Lane({ id, title, colour, seed, head, loop }: LaneProps) {
  const peaks = envelope(seed);
  const mid = HEIGHT / 2;
  const step = WIDTH / BARS;

  return (
    <div className="preview-lane">
      <div className="preview-lane-head">
        <span className="preview-badge" style={{ background: colour }}>
          {id}
        </span>
        <span className="preview-title">{title}</span>
        {loop ? <span className="preview-chip">4 beat loop</span> : null}
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="preview-wave" aria-hidden="true">
        {loop ? (
          <rect
            x={loop[0] * WIDTH}
            y="0"
            width={(loop[1] - loop[0]) * WIDTH}
            height={HEIGHT}
            className="preview-loop"
          />
        ) : null}

        {peaks.map((peak, i) => {
          const h = peak * (HEIGHT - 8);
          return (
            <rect
              key={i}
              x={i * step}
              y={mid - h / 2}
              width={Math.max(1, step - 1)}
              height={h}
              fill={colour}
              opacity={i * step < head * WIDTH ? 0.9 : 0.26}
            />
          );
        })}

        <rect x={head * WIDTH - 1} y="0" width="2" height={HEIGHT} className="preview-head" />
      </svg>
    </div>
  );
}

export function ConsolePreview() {
  return (
    <div className="preview" role="img" aria-label="Illustration of two loaded decks">
      <Lane
        id="A"
        title="Deck A"
        colour="#5b9dd9"
        seed={0.4}
        head={0.62}
        loop={[0.58, 0.72]}
      />
      <Lane id="B" title="Deck B" colour="#d98b4a" seed={2.7} head={0.24} />

      <div className="preview-meters">
        <span className="preview-meter-label">Master</span>
        {[0, 1].map((lane) => (
          <span className="preview-meter" key={lane}>
            <span className={`preview-meter-fill is-lane-${lane}`} />
          </span>
        ))}
      </div>
    </div>
  );
}
