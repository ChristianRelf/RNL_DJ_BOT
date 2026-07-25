import { Fader, Knob, Meter, Slider } from './controls';
import { formatDb, formatPercent } from '../lib/format';
import { DECK_IDS, type DeckState, type MixerState } from '../protocol';
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

export function MixerPanel({ decks, mixer, locked, send, throttled }: MixerPanelProps) {
  return (
    <section className="panel mixer">
      <h2 className="panel-title">Mixer</h2>

      <div className="mixer-strips">
        {DECK_IDS.map((id) => {
          const deck = decks[id];
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
                  min={-26}
                  max={6}
                  defaultValue={0}
                  format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`}
                  disabled={locked}
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
                  Math.abs(v) < 0.02 ? 'off' : `${v < 0 ? 'LP' : 'HP'} ${Math.abs(v * 100).toFixed(0)}`
                }
                disabled={locked}
                onChange={(filter) => throttled('deck:set', { deck: id, filter })}
              />

              <div className="strip-fader">
                <Fader
                  value={deck.gain}
                  min={0}
                  max={1.25}
                  disabled={locked}
                  onChange={(gain) => throttled('deck:set', { deck: id, gain })}
                />
                <Meter channel={id} />
              </div>
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
          <div className="strip-fader">
            <Fader
              value={mixer.master}
              min={0}
              max={1.5}
              disabled={locked}
              onChange={(master) => throttled('mixer:set', { master })}
            />
            <Meter channel="master" />
          </div>
        </div>
      </div>

      <div className="crossfader">
        <div className="crossfader-labels">
          <span>A</span>
          <span className="muted">CROSSFADER</span>
          <span>B</span>
        </div>
        <Slider
          label="Crossfader"
          value={mixer.crossfader}
          min={-1}
          max={1}
          centred
          disabled={locked}
          onChange={(crossfader) => throttled('mixer:set', { crossfader })}
        />
        <div className="crossfader-actions">
          <button
            type="button"
            className="btn tiny"
            disabled={locked}
            onClick={() => void send('mixer:set', { crossfader: -1 })}
          >
            A
          </button>
          <button
            type="button"
            className="btn tiny"
            disabled={locked}
            onClick={() => void send('mixer:set', { crossfader: 0 })}
          >
            CTR
          </button>
          <button
            type="button"
            className="btn tiny"
            disabled={locked}
            onClick={() => void send('mixer:set', { crossfader: 1 })}
          >
            B
          </button>
        </div>
      </div>
    </section>
  );
}
