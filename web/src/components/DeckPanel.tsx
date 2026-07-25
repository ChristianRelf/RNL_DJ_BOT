import { useMemo, useState } from 'react';
import {
  ArrowUpFromLine,
  ChevronsLeft,
  ChevronsRight,
  MapPin,
  Pause,
  Play,
  Repeat,
} from 'lucide-react';
import { Waveform } from './Waveform';
import { Fader } from './controls';
import { formatRate, formatTimeMs } from '../lib/format';
import type { DeckState, MediaItem } from '../protocol';
import type { DjClient } from '../socket';

interface DeckPanelProps {
  deck: DeckState;
  media: MediaItem[];
  locked: boolean;
  accent: string;
  send: DjClient['send'];
  throttled: <T extends 'deck:set' | 'deck:seek'>(command: T, payload: any) => void;
}

export function DeckPanel({ deck, media, locked, accent, send, throttled }: DeckPanelProps) {
  const [dropActive, setDropActive] = useState(false);

  const item = useMemo(
    () => (deck.mediaId ? media.find((m) => m.id === deck.mediaId) ?? null : null),
    [deck.mediaId, media],
  );
  const peaks = item?.peaks ?? [];
  const remaining = Math.max(0, deck.durationMs - deck.positionMs);
  const loopLength = Math.max(0, deck.loop.endMs - deck.loop.startMs);

  const scaleLoop = (factor: number) => {
    const length = Math.max(50, loopLength || 4000) * factor;
    void send('deck:loop', {
      deck: deck.id,
      active: deck.loop.active,
      startMs: deck.loop.startMs,
      endMs: deck.loop.startMs + length,
    });
  };

  return (
    <section
      className={`panel deck deck-${deck.id.toLowerCase()} ${dropActive ? 'is-drop' : ''}`}
      onDragOver={(event) => {
        if (locked) return;
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        if (locked) return;
        const mediaId = event.dataTransfer.getData('application/x-dj-media');
        if (mediaId) void send('deck:load', { deck: deck.id, mediaId });
      }}
    >
      <header className="deck-head">
        <span className="deck-badge" style={{ background: accent }}>
          {deck.id}
        </span>
        <div className="deck-title">
          <strong title={deck.title ?? undefined}>{deck.title ?? 'Drop a track here'}</strong>
          <span className="deck-sub">
            {[
              item?.bpm ? `${item.bpm} bpm` : null,
              deck.playing ? 'playing' : deck.mediaId ? 'stopped' : 'empty',
              deck.rate !== 1 ? formatRate(deck.rate) : null,
            ]
              .filter(Boolean)
              .join('   ')}
          </span>
        </div>
        <button
          type="button"
          className="ghost"
          disabled={locked || !deck.mediaId}
          onClick={() => void send('deck:eject', { deck: deck.id })}
          title="Eject the loaded track"
          aria-label="Eject the loaded track"
        >
          <ArrowUpFromLine size={13} />
        </button>
      </header>

      <Waveform
        peaks={peaks}
        durationMs={deck.durationMs}
        positionMs={deck.positionMs}
        cueMs={deck.cueMs}
        loop={deck.loop}
        accent={accent}
        disabled={locked || !deck.mediaId}
        onSeek={(ms) => throttled('deck:seek', { deck: deck.id, ms })}
      />

      <div className="deck-times">
        <span className="mono">{formatTimeMs(deck.positionMs)}</span>
        <span className="mono muted">-{formatTimeMs(remaining)}</span>
      </div>

      <div className="deck-body">
        <div className="deck-transport">
          <div className="transport-row">
            <button
              type="button"
              className="btn cue"
              disabled={locked || !deck.mediaId}
              onClick={() => void send('deck:cue', { deck: deck.id })}
              title="Jump to cue point and stop"
            >
              CUE
            </button>
            <button
              type="button"
              className={`btn play ${deck.playing ? 'is-active' : ''}`}
              disabled={locked || !deck.mediaId}
              onClick={() =>
                void send(deck.playing ? 'deck:pause' : 'deck:play', { deck: deck.id })
              }
            >
              {deck.playing ? <Pause size={16} /> : <Play size={16} />}
              {deck.playing ? 'PAUSE' : 'PLAY'}
            </button>
          </div>

          <div className="transport-row">
            <button
              type="button"
              className="btn small"
              disabled={locked || !deck.mediaId}
              onClick={() => void send('deck:setCue', { deck: deck.id, ms: deck.positionMs })}
              title="Set the cue point here"
            >
              <MapPin size={12} />
              SET CUE
            </button>
            <button
              type="button"
              className="btn small"
              disabled={locked || !deck.mediaId}
              onMouseDown={() => void send('deck:nudge', { deck: deck.id, deltaMs: -250 })}
              title="Nudge back 250 ms"
              aria-label="Nudge back"
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              type="button"
              className="btn small"
              disabled={locked || !deck.mediaId}
              onMouseDown={() => void send('deck:nudge', { deck: deck.id, deltaMs: 250 })}
              title="Nudge forward 250 ms"
              aria-label="Nudge forward"
            >
              <ChevronsRight size={14} />
            </button>
          </div>

          <div className="transport-row loop-row">
            <button
              type="button"
              className="btn small"
              disabled={locked || !deck.mediaId}
              onClick={() =>
                void send('deck:loop', {
                  deck: deck.id,
                  active: deck.loop.active,
                  startMs: deck.positionMs,
                })
              }
            >
              IN
            </button>
            <button
              type="button"
              className="btn small"
              disabled={locked || !deck.mediaId}
              onClick={() =>
                void send('deck:loop', { deck: deck.id, active: true, endMs: deck.positionMs })
              }
            >
              OUT
            </button>
            <button
              type="button"
              className={`btn small ${deck.loop.active ? 'is-loop' : ''}`}
              disabled={locked || !deck.mediaId}
              onClick={() => void send('deck:loop', { deck: deck.id, active: !deck.loop.active })}
            >
              <Repeat size={12} />
              LOOP
            </button>
            <button
              type="button"
              className="btn small"
              disabled={locked || !deck.mediaId}
              onClick={() => scaleLoop(0.5)}
              title="Halve the loop"
            >
              /2
            </button>
            <button
              type="button"
              className="btn small"
              disabled={locked || !deck.mediaId}
              onClick={() => scaleLoop(2)}
              title="Double the loop"
            >
              x2
            </button>
          </div>

          <div className="deck-flags">
            <label className="check">
              <input
                type="checkbox"
                checked={deck.repeat}
                disabled={locked}
                onChange={(event) =>
                  void send('deck:set', { deck: deck.id, repeat: event.target.checked })
                }
              />
              repeat
            </label>
            {deck.loop.active ? (
              <span className="chip loop-chip mono">{(loopLength / 1000).toFixed(2)}s loop</span>
            ) : null}
          </div>
        </div>

        <div className="deck-pitch">
          <Fader
            label="PITCH"
            value={deck.rate}
            min={0.5}
            max={2}
            disabled={locked}
            onChange={(rate) => throttled('deck:set', { deck: deck.id, rate })}
          />
          <button
            type="button"
            className="btn tiny"
            disabled={locked}
            onClick={() => void send('deck:set', { deck: deck.id, rate: 1 })}
          >
            RESET
          </button>
          <span className="mono tiny-value">{formatRate(deck.rate)}</span>
        </div>
      </div>
    </section>
  );
}
