import { useEffect, useRef, useState } from 'react';
import { Fader, Knob, Meter, PeakReadout } from './controls';
import { Crossfader } from './Crossfader';
import { formatDb, formatPercent } from '../lib/format';
import { meterBus } from '../lib/meters';
import { DECK_IDS, type DeckId, type DeckState, type MixerState } from '../protocol';
import type { DjClient } from '../socket';

/**
 * The full mixer.
 *
 * The compact Mixer panel is the strip you reach for mid-mix: trim, EQ, filter,
 * fader. This one is the rest of the desk - sends, pan, mutes, the master EQ,
 * the output stage and the routing - laid out in pages so a console that has it
 * open does not have to give up half its grid to knobs nobody is touching.
 */

interface Props {
  decks: Record<DeckId, DeckState>;
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
const DECK_GAIN = 0.85;

type Page = 'channels' | 'master' | 'routing';

const PAGES: Array<{ id: Page; label: string }> = [
  { id: 'channels', label: 'CHANNELS' },
  { id: 'master', label: 'MASTER' },
  { id: 'routing', label: 'ROUTING' },
];

const formatPan = (value: number) =>
  Math.abs(value) < 0.02 ? 'C' : `${value < 0 ? 'L' : 'R'}${Math.abs(value * 100).toFixed(0)}`;

export function MixerAdvanced({ decks, mixer, locked, send, throttled }: Props) {
  const [page, setPage] = useState<Page>('channels');

  const setDeck = (deck: DeckId, patch: Record<string, unknown>) =>
    throttled('deck:set', { deck, ...patch });

  return (
    <section className="panel mixer-advanced">
      <header className="panel-head">
        <h2 className="panel-title">Advanced mixer</h2>
        <div className="seg">
          {PAGES.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={`seg-btn ${page === entry.id ? 'is-on' : ''}`}
              aria-pressed={page === entry.id}
              onClick={() => setPage(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      {page === 'channels' ? (
        <div className="mixer-strips is-wide">
          {DECK_IDS.map((id) => {
            const deck = decks[id];
            return (
              <div className={`strip strip-${id.toLowerCase()}`} key={id}>
                <span className="strip-label">{id}</span>

                <div className="knob-row">
                  <Knob
                    label="TRIM"
                    value={deck.trim}
                    min={0}
                    max={2}
                    defaultValue={1}
                    size="sm"
                    format={formatDb}
                    disabled={locked}
                    onChange={(trim) => setDeck(id, { trim })}
                  />
                  <Knob
                    label="PAN"
                    value={deck.pan}
                    min={-1}
                    max={1}
                    defaultValue={0}
                    size="sm"
                    format={formatPan}
                    disabled={locked}
                    onChange={(pan) => setDeck(id, { pan })}
                  />
                </div>

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
                    onKill={() =>
                      void send('deck:set', {
                        deck: id,
                        eq: { [band.key]: deck.eq[band.key] <= KILL_DB ? 0 : KILL_DB },
                      })
                    }
                    onChange={(value) => setDeck(id, { eq: { [band.key]: value } })}
                  />
                ))}

                <div className="knob-row">
                  <Knob
                    label="FILTER"
                    value={deck.filter}
                    min={-1}
                    max={1}
                    defaultValue={0}
                    size="sm"
                    accent="filter"
                    format={(v) =>
                      Math.abs(v) < 0.02
                        ? 'off'
                        : `${v < 0 ? 'LP' : 'HP'} ${Math.abs(v * 100).toFixed(0)}`
                    }
                    disabled={locked}
                    onChange={(filter) => setDeck(id, { filter })}
                  />
                  <Knob
                    label="FX"
                    value={deck.fxSend}
                    min={0}
                    max={1}
                    defaultValue={0}
                    size="sm"
                    format={formatPercent}
                    disabled={locked}
                    onChange={(fxSend) => setDeck(id, { fxSend })}
                  />
                </div>

                <div className="strip-fader">
                  <Fader
                    name={`Deck ${id} level`}
                    value={deck.gain}
                    min={0}
                    max={1.25}
                    defaultValue={DECK_GAIN}
                    disabled={locked}
                    onChange={(gain) => setDeck(id, { gain })}
                  />
                  <Meter channel={id} />
                </div>

                <button
                  type="button"
                  className={`btn tiny strip-mute ${deck.muted ? 'is-muted' : ''}`}
                  disabled={locked}
                  aria-pressed={deck.muted}
                  title={deck.muted ? `Unmute deck ${id}` : `Mute deck ${id}`}
                  onClick={() => void send('deck:set', { deck: id, muted: !deck.muted })}
                >
                  {deck.muted ? 'MUTED' : 'MUTE'}
                </button>
                <span className="strip-foot mono">{formatPan(deck.pan)}</span>
              </div>
            );
          })}

          <div className="strip strip-master">
            <span className="strip-label">MST</span>

            <div className="knob-row">
              <Knob
                label="PADS"
                value={mixer.padBus}
                min={0}
                max={1.5}
                defaultValue={0.9}
                size="sm"
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
                size="sm"
                format={formatPercent}
                disabled={locked}
                onChange={(padDuck) => throttled('mixer:set', { padDuck })}
              />
            </div>

            <div className="knob-row">
              <Knob
                label="FX RTN"
                value={mixer.fx.mix}
                min={0}
                max={1}
                defaultValue={0}
                size="sm"
                format={formatPercent}
                disabled={locked}
                onChange={(mix) => throttled('mixer:set', { fx: { mix } })}
              />
              <Knob
                label="BAL"
                value={mixer.balance}
                min={-1}
                max={1}
                defaultValue={0}
                size="sm"
                format={formatPan}
                disabled={locked}
                onChange={(balance) => throttled('mixer:set', { balance })}
              />
            </div>

            <div className="pad-bus">
              <span className="tool-label">PAD BUS</span>
              <Meter channel="pads" vertical={false} className="is-slim" />
              <span className="tool-label">FX BUS</span>
              <Meter channel="fx" vertical={false} className="is-slim" />
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
      ) : null}

      {page === 'master' ? (
        <div className="mixer-master">
          <div className="control-cluster">
            <span className="tool-label">Master EQ</span>
            <div className="knob-row">
              {EQ_BANDS.map((band) => (
                <Knob
                  key={band.key}
                  label={band.label}
                  value={mixer.masterEq[band.key]}
                  min={KILL_DB}
                  max={EQ_MAX_DB}
                  defaultValue={0}
                  format={(v) => (v <= KILL_DB ? 'kill' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`)}
                  disabled={locked}
                  killed={mixer.masterEq[band.key] <= KILL_DB}
                  onKill={() =>
                    void send('mixer:set', {
                      masterEq: {
                        [band.key]: mixer.masterEq[band.key] <= KILL_DB ? 0 : KILL_DB,
                      },
                    })
                  }
                  onChange={(value) => throttled('mixer:set', { masterEq: { [band.key]: value } })}
                />
              ))}
            </div>
            <p className="panel-note">
              The same isolator the decks use, across the whole output. Handy for taming a room,
              less so for anything you want to undo in a hurry.
            </p>
          </div>

          <div className="control-cluster">
            <span className="tool-label">Output stage</span>
            <div className="knob-row">
              <Knob
                label="BALANCE"
                value={mixer.balance}
                min={-1}
                max={1}
                defaultValue={0}
                format={formatPan}
                disabled={locked}
                onChange={(balance) => throttled('mixer:set', { balance })}
              />
              <Knob
                label="MASTER"
                value={mixer.master}
                min={0}
                max={1.5}
                defaultValue={1}
                format={formatDb}
                disabled={locked}
                onChange={(master) => throttled('mixer:set', { master })}
              />
            </div>

            <div className="btn-row">
              <button
                type="button"
                className={`btn tiny ${mixer.mono ? 'is-on' : ''}`}
                disabled={locked}
                aria-pressed={mixer.mono}
                title="Sum the output to mono"
                onClick={() => void send('mixer:set', { mono: !mixer.mono })}
              >
                MONO
              </button>
              <button
                type="button"
                className={`btn tiny ${mixer.limiter ? 'is-on' : ''}`}
                disabled={locked}
                aria-pressed={mixer.limiter}
                title="Brickwall limiter on the master bus"
                onClick={() => void send('mixer:set', { limiter: !mixer.limiter })}
              >
                LIMITER
              </button>
            </div>

            <div className="master-readout">
              <span className="tool-label-sm">PEAK</span>
              <PeakReadout channel="master" />
              <span className="tool-label-sm">GR</span>
              <Reduction />
            </div>
            <p className="panel-note">
              With the limiter off the soft clipper is still there as a backstop, but the output
              will colour before it stops - which is sometimes what you want and mostly not.
            </p>
          </div>
        </div>
      ) : null}

      {page === 'routing' ? (
        <div className="mixer-routing">
          <div className="control-cluster">
            <span className="tool-label">Crossfader</span>
            <Crossfader value={mixer.crossfader} locked={locked} send={send} throttled={throttled} />
            <div className="knob-row">
              <Knob
                label="CURVE"
                value={mixer.crossfaderCurve}
                min={0}
                max={1}
                defaultValue={0}
                format={(v) => (v < 0.05 ? 'blend' : v > 0.9 ? 'cut' : formatPercent(v))}
                disabled={locked}
                onChange={(crossfaderCurve) => throttled('mixer:set', { crossfaderCurve })}
              />
            </div>
            <p className="panel-note">
              Fully anticlockwise is the constant-power blend a long mix wants. Wind it clockwise
              and the channel reaches full level within a sliver of travel, for cutting.
            </p>
          </div>

          <div className="control-cluster">
            <span className="tool-label">Channel sends</span>
            <div className="route-grid">
              <span />
              <span className="tool-label-sm">FX SEND</span>
              <span className="tool-label-sm">PAN</span>
              <span className="tool-label-sm">MUTE</span>
              {DECK_IDS.map((id) => (
                <Row
                  key={id}
                  deck={decks[id]}
                  locked={locked}
                  onSet={(patch) => setDeck(id, patch)}
                  onToggleMute={() => void send('deck:set', { deck: id, muted: !decks[id].muted })}
                />
              ))}
            </div>
            <p className="panel-note">
              Sends are taken post-fader, so pulling a channel down takes its effect tail with it.
              The return level lives on the FX rack.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Row({
  deck,
  locked,
  onSet,
  onToggleMute,
}: {
  deck: DeckState;
  locked: boolean;
  onSet: (patch: Record<string, unknown>) => void;
  onToggleMute: () => void;
}) {
  return (
    <>
      <span className={`route-name strip-${deck.id.toLowerCase()}`}>{deck.id}</span>
      <Knob
        label=""
        name={`Deck ${deck.id} FX send`}
        value={deck.fxSend}
        min={0}
        max={1}
        defaultValue={0}
        size="sm"
        format={formatPercent}
        disabled={locked}
        onChange={(fxSend) => onSet({ fxSend })}
      />
      <Knob
        label=""
        name={`Deck ${deck.id} pan`}
        value={deck.pan}
        min={-1}
        max={1}
        defaultValue={0}
        size="sm"
        format={formatPan}
        disabled={locked}
        onChange={(pan) => onSet({ pan })}
      />
      <button
        type="button"
        className={`btn tiny ${deck.muted ? 'is-muted' : ''}`}
        disabled={locked}
        aria-pressed={deck.muted}
        aria-label={`Mute deck ${deck.id}`}
        onClick={onToggleMute}
      >
        {deck.muted ? 'MUTED' : 'MUTE'}
      </button>
    </>
  );
}

/**
 * How hard the limiter is working, in dB. Driven straight off the meter bus
 * like the peak readouts, so a 15 Hz update costs no re-renders.
 */
function Reduction() {
  const node = useRef<HTMLSpanElement>(null);

  useEffect(
    () =>
      meterBus.subscribe((meters) => {
        if (!node.current) return;
        const db = 20 * Math.log10(Math.max(0.001, meters.reduction));
        node.current.textContent = db > -0.1 ? '0.0' : db.toFixed(1);
        node.current.classList.toggle('is-hot', db < -1);
      }),
    [],
  );

  return <span ref={node} className="peak-readout mono" />;
}
