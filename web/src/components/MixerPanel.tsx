import { useRef } from 'react';
import { Fader, Knob, Meter } from './controls';
import { Crossfader } from './Crossfader';
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

export function MixerPanel({ decks, mixer, locked, send, throttled }: MixerPanelProps) {
  // Kill is a console-side convenience built on the plain EQ command the engine
  // already takes, so it needs somewhere to remember what the band was sitting
  // at before it was slammed to zero. Mute is a real deck setting, so it does
  // not — and it survives a reconnect, which the old parked-gain trick did not.
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

  return (
    <section className="panel mixer">
      <header className="panel-head">
        <h2 className="panel-title">Mixer</h2>
        <span className="hint">right-click any control to reset</span>
      </header>

      <div className="mixer-strips">
        {DECK_IDS.map((id) => {
          const deck = decks[id];
          const muted = deck.muted;
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
                onClick={() => void send('deck:set', { deck: id, muted: !muted })}
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

      <Crossfader
        value={mixer.crossfader}
        locked={locked}
        send={send}
        throttled={throttled}
      />
    </section>
  );
}
