import { Knob, Meter } from './controls';
import { formatPercent } from '../lib/format';
import { beatMs } from '../lib/beats';
import { DECK_IDS, FX_TYPES, type DeckId, type DeckState, type FxType, type MixerState } from '../protocol';
import type { DjClient } from '../socket';

/**
 * The send effects rack.
 *
 * One unit at a time on a bus both decks feed post-fader, which is how the
 * hardware this imitates works and why an echo thrown at the end of a track
 * survives the fade out of it. The time knob can be set in beats off whichever
 * deck is playing, since "a dotted eighth" is what a DJ actually wants and
 * "372 milliseconds" is what that happens to be.
 */

interface Props {
  decks: Record<DeckId, DeckState>;
  mixer: MixerState;
  locked: boolean;
  send: DjClient['send'];
  throttled: (command: 'deck:set' | 'mixer:set', payload: any) => void;
}

const LABELS: Record<FxType, { name: string; time: string; feedback: string; blurb: string }> = {
  echo: {
    name: 'ECHO',
    time: 'TIME',
    feedback: 'REPEATS',
    blurb: 'Tape-style delay. The repeats darken as they decay, and a time sweep pitches.',
  },
  reverb: {
    name: 'REVERB',
    time: 'SIZE',
    feedback: 'DECAY',
    blurb: 'A room around the send. Small and short reads as a booth, long as a hall.',
  },
  flanger: {
    name: 'FLANGER',
    time: 'RATE',
    feedback: 'DEPTH',
    blurb: 'Swept comb filter, offset between the channels so it moves across the image.',
  },
};

/** Divisions offered by the beat-sync buttons. */
const DIVISIONS = [
  { beats: 0.25, label: '1/16' },
  { beats: 0.5, label: '1/8' },
  { beats: 0.75, label: '3/16' },
  { beats: 1, label: '1/4' },
  { beats: 1.5, label: '3/8' },
  { beats: 2, label: '1/2' },
];

export function FxRack({ decks, mixer, locked, send, throttled }: Props) {
  const fx = mixer.fx;
  const labels = LABELS[fx.type];

  // The tempo to sync to: a playing deck that knows its own tempo, and when
  // both do, whichever one the crossfader is favouring.
  const candidates = DECK_IDS.map((id) => decks[id]).filter((deck) => deck.playing && deck.bpm);
  const favoured = mixer.crossfader <= 0 ? 'A' : 'B';
  const reference =
    candidates.length > 1
      ? candidates.find((deck) => deck.id === favoured) ?? candidates[0]
      : candidates[0];
  const beat = reference ? beatMs(reference.bpm) : null;
  // A beat in the room, not in the file: the pitch fader moves the tempo.
  const roomBeat = beat && reference ? beat / reference.rate : null;

  return (
    <section className="panel fx-rack">
      <header className="panel-head">
        <h2 className="panel-title">FX</h2>
        <span className="hint">{fx.mix > 0.001 ? 'on the bus' : 'return closed'}</span>
      </header>

      <div className="seg is-full">
        {FX_TYPES.map((type) => (
          <button
            type="button"
            key={type}
            className={`seg-btn ${fx.type === type ? 'is-on' : ''}`}
            disabled={locked}
            aria-pressed={fx.type === type}
            onClick={() => void send('mixer:set', { fx: { type } })}
          >
            {LABELS[type].name}
          </button>
        ))}
      </div>

      <div className="knob-row is-spread">
        <Knob
          label="RETURN"
          value={fx.mix}
          min={0}
          max={1}
          defaultValue={0}
          format={formatPercent}
          disabled={locked}
          onChange={(mix) => throttled('mixer:set', { fx: { mix } })}
        />
        <Knob
          label={labels.time}
          value={fx.timeMs}
          min={20}
          max={2000}
          defaultValue={375}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v.toFixed(0)}ms`)}
          disabled={locked}
          onChange={(timeMs) => throttled('mixer:set', { fx: { timeMs } })}
        />
        <Knob
          label={labels.feedback}
          value={fx.feedback}
          min={0}
          max={0.95}
          defaultValue={0.35}
          format={formatPercent}
          disabled={locked}
          onChange={(feedback) => throttled('mixer:set', { fx: { feedback } })}
        />
        <Knob
          label="TONE"
          value={fx.tone}
          min={0}
          max={1}
          defaultValue={0.6}
          format={(v) => (v < 0.2 ? 'dark' : v > 0.8 ? 'bright' : formatPercent(v))}
          disabled={locked}
          onChange={(tone) => throttled('mixer:set', { fx: { tone } })}
        />
      </div>

      <div className="fx-sync">
        <span className="tool-label-sm">
          {roomBeat
            ? `SYNC TO DECK ${reference?.id} · ${(60000 / roomBeat).toFixed(1)} BPM`
            : 'SYNC - NO TEMPO ON A PLAYING DECK'}
        </span>
        <div className="btn-row">
          {DIVISIONS.map((division) => {
            const ms = roomBeat ? roomBeat * division.beats : null;
            return (
              <button
                type="button"
                key={division.label}
                className="btn tiny"
                disabled={locked || !ms || ms < 20 || ms > 2000}
                title={ms ? `${ms.toFixed(0)} ms` : 'Needs a playing deck with a tempo'}
                onClick={() => ms && void send('mixer:set', { fx: { timeMs: ms } })}
              >
                {division.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="fx-sends">
        <span className="tool-label-sm">SENDS</span>
        {DECK_IDS.map((id) => (
          <div className={`fx-send strip-${id.toLowerCase()}`} key={id}>
            <span className="fx-send-label">{id}</span>
            <Knob
              label=""
              name={`Deck ${id} FX send`}
              value={decks[id].fxSend}
              min={0}
              max={1}
              defaultValue={0}
              size="sm"
              format={formatPercent}
              disabled={locked}
              onChange={(fxSend) => throttled('deck:set', { deck: id, fxSend })}
            />
          </div>
        ))}
        <div className="fx-meter">
          <span className="tool-label-sm">RETURN</span>
          <Meter channel="fx" vertical={false} className="is-slim" />
        </div>
      </div>

      <p className="panel-note">{labels.blurb}</p>
    </section>
  );
}
