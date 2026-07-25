/**
 * A stylised console for the home page — two loaded decks and a meter bridge.
 *
 * Deliberately a drawing rather than a screenshot: it stays honest about being
 * an illustration, never goes stale, and costs nothing to ship. The envelope is
 * generated from a fixed formula so it renders identically every time.
 */

const BARS = 96;

/** A plausible track envelope: a couple of detuned sines under a fade. */
function envelope(seed: number): number[] {
  return Array.from({ length: BARS }, (_, i) => {
    const t = i / BARS;
    const fade = Math.min(1, t * 8) * Math.min(1, (1 - t) * 8);
    const body =
      Math.abs(Math.sin(i * 0.68 + seed)) * 0.5 +
      Math.abs(Math.sin(i * 0.21 + seed * 2)) * 0.34 +
      Math.abs(Math.sin(i * 1.83 + seed)) * 0.16;
    return 0.12 + fade * body * 0.88;
  });
}

interface LaneProps {
  id: 'A' | 'B';
  colour: string;
  seed: number;
  /** Playhead position, 0..1. */
  head: number;
  /** Loop region as [start, end] in 0..1, or null. */
  loop?: [number, number];
}

function Lane({ id, colour, seed, head, loop }: LaneProps) {
  const peaks = envelope(seed);
  const width = 460;
  const height = 54;
  const mid = height / 2;
  const step = width / BARS;

  return (
    <div className="preview-lane">
      <span className="preview-badge" style={{ background: colour }}>
        {id}
      </span>
      <svg viewBox={`0 0 ${width} ${height}`} className="preview-wave" aria-hidden="true">
        {loop ? (
          <rect
            x={loop[0] * width}
            y="0"
            width={(loop[1] - loop[0]) * width}
            height={height}
            className="preview-loop"
          />
        ) : null}

        {peaks.map((peak, i) => {
          const h = peak * (height - 6);
          const played = i * step < head * width;
          return (
            <rect
              key={i}
              x={i * step}
              y={mid - h / 2}
              width={Math.max(1, step - 1)}
              height={h}
              fill={colour}
              opacity={played ? 0.95 : 0.32}
            />
          );
        })}

        <rect x={head * width - 1} y="0" width="2" height={height} className="preview-head" />
      </svg>
    </div>
  );
}

function Dial({ label, ratio, colour }: { label: string; ratio: number; colour?: string }) {
  const angle = -135 + ratio * 270;
  return (
    <div className="preview-dial">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="19" className="preview-dial-track" />
        <circle
          cx="24"
          cy="24"
          r="19"
          className="preview-dial-arc"
          stroke={colour}
          style={{
            strokeDasharray: `${ratio * 0.75 * 119.4} 999`,
          }}
        />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '24px 24px' }}>
          <line x1="24" y1="8" x2="24" y2="17" className="preview-dial-pointer" />
        </g>
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function ConsolePreview() {
  return (
    <div className="preview" role="img" aria-label="Illustration of the deck mixing console">
      <div className="preview-decks">
        <Lane id="A" colour="#5b9dd9" seed={0.4} head={0.62} loop={[0.58, 0.72]} />
        <Lane id="B" colour="#d98b4a" seed={2.7} head={0.24} />
      </div>

      <div className="preview-mixer">
        <div className="preview-dials">
          <Dial label="TRIM" ratio={0.5} />
          <Dial label="HIGH" ratio={0.68} />
          <Dial label="MID" ratio={0.5} />
          <Dial label="LOW" ratio={0.34} />
          <Dial label="FILTER" ratio={0.5} colour="#5b9dd9" />
        </div>

        <div className="preview-meters">
          <span className="preview-meter-label">MASTER</span>
          {[0, 1].map((lane) => (
            <span className="preview-meter" key={lane}>
              <span className={`preview-meter-fill is-lane-${lane}`} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
