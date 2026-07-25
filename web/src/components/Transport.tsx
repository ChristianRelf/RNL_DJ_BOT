import { Pause, Play } from 'lucide-react';
import { formatTime } from '../lib/format';
import { playingBpm, syncRate } from '../lib/beats';
import { DECK_IDS, type DeckId, type DeckState } from '../protocol';
import type { DjClient } from '../socket';

interface TransportProps {
  decks: Record<'A' | 'B', DeckState>;
  locked: boolean;
  send: DjClient['send'];
}

const ACCENT: Record<DeckId, string> = { A: 'var(--deck-a)', B: 'var(--deck-b)' };

/**
 * Both decks' transport in one strip.
 *
 * For layouts that hide the full deck panels — a performance screen, or a
 * second operator who only needs to start and stop things.
 */
export function Transport({ decks, locked, send }: TransportProps) {
  return (
    <section className="panel transport-widget">
      <h2 className="panel-title">Transport</h2>

      {DECK_IDS.map((id) => {
        const deck = decks[id];
        const other = decks[id === 'A' ? 'B' : 'A'];
        const empty = locked || !deck.mediaId;
        const remaining = Math.max(0, deck.durationMs - deck.positionMs);
        const match = syncRate(deck.bpm, playingBpm(other.bpm, other.rate));

        return (
          <div className="tw-deck" key={id}>
            <div className="tw-head">
              <span className="tw-badge" style={{ background: ACCENT[id] }}>
                {id}
              </span>
              <span className="tw-title" title={deck.title ?? undefined}>
                {deck.title ?? 'empty'}
              </span>
              <span className={`tw-time mono ${remaining < 30_000 && deck.playing ? 'is-outro' : ''}`}>
                -{formatTime(remaining)}
              </span>
            </div>

            <div className="tw-buttons">
              <button
                type="button"
                className="btn cue"
                disabled={empty}
                title="Jump to the cue point and stop"
                onClick={() => void send('deck:cue', { deck: id })}
              >
                CUE
              </button>
              <button
                type="button"
                className={`btn play ${deck.playing ? 'is-active' : ''}`}
                disabled={empty}
                onClick={() => void send(deck.playing ? 'deck:pause' : 'deck:play', { deck: id })}
              >
                {deck.playing ? <Pause size={14} /> : <Play size={14} />}
                {deck.playing ? 'PAUSE' : 'PLAY'}
              </button>
              <button
                type="button"
                className="btn small sync"
                disabled={locked || !match}
                title={match ? `Match deck ${other.id}` : 'Both decks need a BPM to sync'}
                onClick={() => match && void send('deck:set', { deck: id, rate: match })}
              >
                SYNC
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
