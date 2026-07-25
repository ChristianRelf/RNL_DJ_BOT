import { useCallback, useEffect, useRef, useState } from 'react';
import { Slider } from './controls';
import type { DjClient } from '../socket';

/** Auto-fade lengths, in seconds. */
const FADE_TIMES = [2, 4, 8, 16] as const;

interface CrossfaderProps {
  value: number;
  locked: boolean;
  send: DjClient['send'];
  throttled: (command: 'mixer:set', payload: any) => void;
  /** Standalone widget draws its own frame; inside the mixer it does not. */
  standalone?: boolean;
}

/**
 * The crossfader and its timed auto-fade.
 *
 * Lives on its own so the mixer strip and the standalone widget are the same
 * control rather than two that drift apart.
 */
export function Crossfader({ value, locked, send, throttled, standalone }: CrossfaderProps) {
  const [fadeSeconds, setFadeSeconds] = useState<number>(4);
  const [fading, setFading] = useState(false);
  const frame = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;

  const stopFade = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setFading(false);
  }, []);

  // Losing control mid-fade would leave the animation driving a console it can
  // no longer touch.
  useEffect(() => {
    if (locked) stopFade();
  }, [locked, stopFade]);

  useEffect(() => stopFade, [stopFade]);

  /** Walks the crossfader across to `target` over the chosen time. */
  const runFade = (target: number) => {
    stopFade();
    const from = latest.current;
    const span = target - from;
    if (Math.abs(span) < 0.02) return;

    const ms = fadeSeconds * 1000;
    const started = performance.now();
    setFading(true);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / ms);
      if (progress >= 1) {
        // The last value goes unthrottled, so the fade lands exactly on target
        // rather than wherever the throttle happened to drop it.
        void send('mixer:set', { crossfader: target });
        frame.current = null;
        setFading(false);
        return;
      }
      throttled('mixer:set', { crossfader: from + span * progress });
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
  };

  const body = (
    <>
      <div className="crossfader-labels">
        <span className="xf-a">A</span>
        <span className="muted">CROSSFADER</span>
        <span className="xf-b">B</span>
      </div>

      <Slider
        label="Crossfader"
        value={value}
        min={-1}
        max={1}
        defaultValue={0}
        centred
        disabled={locked}
        // Taking hold of it beats whatever the auto-fade was doing.
        onGrab={stopFade}
        onChange={(next) => {
          stopFade();
          throttled('mixer:set', { crossfader: next });
        }}
      />

      <div className="crossfader-actions">
        <button
          type="button"
          className="btn tiny"
          disabled={locked}
          title="Slam the crossfader to deck A"
          onClick={() => void send('mixer:set', { crossfader: -1 })}
        >
          A
        </button>
        <button
          type="button"
          className="btn tiny"
          disabled={locked}
          title="Centre the crossfader"
          onClick={() => void send('mixer:set', { crossfader: 0 })}
        >
          CTR
        </button>
        <button
          type="button"
          className="btn tiny"
          disabled={locked}
          title="Slam the crossfader to deck B"
          onClick={() => void send('mixer:set', { crossfader: 1 })}
        >
          B
        </button>
      </div>

      <div className="autofade">
        <span className="tool-label">Auto fade</span>
        {fading ? (
          <button
            type="button"
            className="btn tiny is-fading"
            onClick={stopFade}
            title="Stop the fade where it is"
          >
            STOP
          </button>
        ) : (
          <div className="autofade-row">
            <button
              type="button"
              className="btn tiny autofade-time"
              disabled={locked}
              title="How long the fade takes"
              onClick={() =>
                setFadeSeconds(
                  (current) =>
                    FADE_TIMES[(FADE_TIMES.indexOf(current as never) + 1) % FADE_TIMES.length],
                )
              }
            >
              {fadeSeconds}s
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={locked}
              title={`Fade across to deck A over ${fadeSeconds} seconds`}
              onClick={() => runFade(-1)}
            >
              ‹ A
            </button>
            <button
              type="button"
              className="btn tiny"
              disabled={locked}
              title={`Fade across to deck B over ${fadeSeconds} seconds`}
              onClick={() => runFade(1)}
            >
              B ›
            </button>
          </div>
        )}
      </div>
    </>
  );

  if (!standalone) return <div className="crossfader">{body}</div>;

  return (
    <section className="panel xfader-panel">
      <h2 className="panel-title">Crossfader</h2>
      <div className="crossfader is-bare">{body}</div>
    </section>
  );
}
