import { useCallback, useEffect, useRef, useState } from 'react';
import { Fader, Knob, Meter, Slider } from './controls';
import { formatDb, formatPercent } from '../lib/format';
import { DECK_IDS, type DeckId, type DeckState, type MixerState } from '../protocol';
import type { DjClient } from '../socket';

interface MixerPanelProps {
  decks: Record<'A' | 'B', DeckState>;
  mixer: MixerState;
  locked: boolean;
  send: DjClient['send'];
  throttled: (command: 'deck:set' | 'mixer:set', payload: any) => void;
}

const EQ_BANDS = [
  { key: 'high', label: 'HIGH' },
  { key: 'mid', label: 'MID' },
  { key: 'low', label: 'LOW' },
] as const;

/** The server treats anything at or under -25.5 dB as a real kill. */
const KILL_DB = -26;
const EQ_MAX_DB = 6;
/** Deck channel fader default, matching the engine. */
const DECK_GAIN = 0.85;
/** Auto-fade lengths, in seconds. */
const FADE_TIMES = [2, 4, 8, 16] as const;

export function MixerPanel({ decks, mixer, locked, send, throttled }: MixerPanelProps) {
  // Kill and mute are console-side conveniences built on the plain gain
  // commands the engine already takes, so they need somewhere to remember what
  // the control was sitting at before it was slammed to zero.
  const parked = useRef<Record<string, number>>({});

  const toggleKill = (id: DeckId, band: 'low' | 'mid' | 'high', value: number) => {
    const key = `${id}:${band}`;
    if (value <= KILL_DB) {
      const restore = parked.current[key] ?? 0;
      void send('deck:set', { deck: id, eq: { [band]: restore } });
    } else {
      parked.current[key] = value;
      void send('deck:set', { deck: id, eq: { [band]: KILL_DB } });
    }
  };

  const toggleMute = (id: DeckId, gain: number) => {
    const key = `${id}:gain`;
    if (gain <= 0.0001) {
      void send('deck:set', { deck: id, gain: parked.current[key] ?? DECK_GAIN });
    } else {
      parked.current[key] = gain;
      void send('deck:set', { deck: id, gain: 0 });
    }
  };

  // ---------------------------------------------------------- auto fade ---

  const [fadeSeconds, setFadeSeconds] = useState<number>(4);
  const [fading, setFading] = useState(false);
  const frame = useRef<number | null>(null);
  const crossfader = useRef(mixer.crossfader);
  crossfader.current = mixer.crossfader;

  const stopFade = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setFading(false);
  }, []);

  // Losing control mid-fade would leave the animation running against a console
  // it can no longer drive.
  useEffect(() => {
    if (locked) stopFade();
  }, [locked, stopFade]);

  useEffect(() => stopFade, [stopFade]);

  /** Walks the crossfader across to `target` over the chosen time. */
  const runFade = (target: number) => {
    stopFade();
    const from = crossfader.current;
    const span = target - from;
    if (Math.abs(span) < 0.02) return;

    const ms = fadeSeconds * 1000;
    const started = performance.now();
    setFading(true);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / ms);
      if (progress >= 1) {
        // The last value goes unthrottled, so the fade always lands exactly on
        // the target rather than wherever the throttle happened to drop it.
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

  return (
    <section className="panel mixer">
      <header className="panel-head">
        <h2 className="panel-title">Mixer</h2>
        <span className="hint">right-click any control to reset</span>
      </header>

      <div className="mixer-strips">
        {DECK_IDS.map((id) => {
          const deck = decks[id];
          const muted = deck.gain <= 0.0001;
          return (
            <div className={`strip strip-${id.toLowerCase()}`} key={id}>
              <span className="strip-label">{id}</span>

              <Knob
                label="TRIM"
                value={deck.trim}
                min={0}
                max={2}
                defaultValue={1}
                format={formatDb}
                disabled={locked}
                onChange={(trim) => throttled('deck:set', { deck: id, trim })}
              />

              {EQ_BANDS.map((band) => (
                <Knob
                  key={band.key}
                  label={band.label}
                  value={deck.eq[band.key]}
                  min={KILL_DB}
                  max={EQ_MAX_DB}
                  defaultValue={0}
                  format={(v) => (v <= KILL_DB ? 'kill' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`)}
                  disabled={locked}
                  killed={deck.eq[band.key] <= KILL_DB}
                  onKill={() => toggleKill(id, band.key, deck.eq[band.key])}
                  onChange={(value) =>
                    throttled('deck:set', { deck: id, eq: { [band.key]: value } })
                  }
                />
              ))}

              <Knob
                label="FILTER"
                value={deck.filter}
                min={-1}
                max={1}
                defaultValue={0}
                accent="filter"
                format={(v) =>
                  Math.abs(v) < 0.02
                    ? 'off'
                    : `${v < 0 ? 'LP' : 'HP'} ${Math.abs(v * 100).toFixed(0)}`
                }
                disabled={locked}
                onChange={(filter) => throttled('deck:set', { deck: id, filter })}
              />

              <div className="strip-fader">
                <Fader
                  name={`Deck ${id} level`}
                  value={deck.gain}
                  min={0}
                  max={1.25}
                  defaultValue={DECK_GAIN}
                  disabled={locked}
                  onChange={(gain) => throttled('deck:set', { deck: id, gain })}
                />
                <Meter channel={id} />
              </div>

              <button
                type="button"
                className={`btn tiny strip-mute ${muted ? 'is-muted' : ''}`}
                disabled={locked}
                aria-pressed={muted}
                title={muted ? `Unmute deck ${id}` : `Mute deck ${id}`}
                onClick={() => toggleMute(id, deck.gain)}
              >
                {muted ? 'MUTED' : 'MUTE'}
              </button>
            </div>
          );
        })}

        <div className="strip strip-master">
          <span className="strip-label">MST</span>

          <Knob
            label="PADS"
            value={mixer.padBus}
            min={0}
            max={1.5}
            defaultValue={0.9}
            format={formatDb}
            disabled={locked}
            onChange={(padBus) => throttled('mixer:set', { padBus })}
          />
          <Knob
            label="DUCK"
            value={mixer.padDuck}
            min={0}
            max={1}
            defaultValue={0.25}
            format={formatPercent}
            disabled={locked}
            onChange={(padDuck) => throttled('mixer:set', { padDuck })}
          />

          <div className="pad-bus">
            <span className="tool-label">PAD BUS</span>
            <Meter channel="pads" vertical={false} className="is-slim" />
          </div>

          <div className="strip-fader">
            <Fader
              name="Master level"
              value={mixer.master}
              min={0}
              max={1.5}
              defaultValue={1}
              disabled={locked}
              onChange={(master) => throttled('mixer:set', { master })}
            />
            <Meter channel="master" />
          </div>

          <span className="strip-foot mono">{formatDb(mixer.master)}</span>
        </div>
      </div>

      <div className="crossfader">
        <div className="crossfader-labels">
          <span className="xf-a">A</span>
          <span className="muted">CROSSFADER</span>
          <span className="xf-b">B</span>
        </div>
        <Slider
          label="Crossfader"
          value={mixer.crossfader}
          min={-1}
          max={1}
          defaultValue={0}
          centred
          disabled={locked}
          // Taking hold of it beats whatever the auto-fade was doing.
          onGrab={stopFade}
          onChange={(value) => {
            stopFade();
            throttled('mixer:set', { crossfader: value });
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
      </div>
    </section>
  );
}
