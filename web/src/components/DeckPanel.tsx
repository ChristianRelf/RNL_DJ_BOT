import { useEffect, useMemo, useRef, useState } from 'react';
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
import { BEAT_LOOPS, beatMs, loopBeats, playingBpm, syncRate } from '../lib/beats';
import { formatRate, formatTime, formatTimeMs } from '../lib/format';
import type { DeckState, MediaItem } from '../protocol';
import type { DjClient } from '../socket';

interface DeckPanelProps {
  deck: DeckState;
  /** The opposite deck - the reference the tempo tools match against. */
  other: DeckState;
  media: MediaItem[];
  locked: boolean;
  accent: string;
  send: DjClient['send'];
  throttled: <T extends 'deck:set' | 'deck:seek'>(command: T, payload: any) => void;
}

/** Below this the outro readout goes red - time to have the next one ready. */
const OUTRO_MS = 30_000;
/** Beat-jump distances, and the seconds they stand in for on an untagged track. */
const JUMPS = [-4, -1, 1, 4] as const;
/** A gap longer than this starts a new count-in rather than reading as a very slow tempo. */
const TAP_RESET_MS = 2_000;
/** Taps needed before the average is worth trusting. */
const TAP_MINIMUM = 4;

/**
 * Tap along to set a track's tempo.
 *
 * Sync, beat loops and beat jumps all need a BPM, and detection does not always
 * find one - this is how you give a track its tempo by hand rather than leaving
 * a third of the deck greyed out.
 */
function TapTempo({
  mediaId,
  disabled,
  onBpm,
}: {
  mediaId: string | null;
  disabled: boolean;
  onBpm: (bpm: number) => void;
}) {
  const taps = useRef<number[]>([]);
  const forget = useRef<number | undefined>(undefined);
  const [counting, setCounting] = useState(0);

  const clear = () => {
    taps.current = [];
    setCounting(0);
  };

  // A tap sequence belongs to the track it was counted against.
  useEffect(clear, [mediaId]);
  useEffect(() => () => window.clearTimeout(forget.current), []);

  const tap = () => {
    const now = performance.now();
    const list = taps.current;
    if (list.length && now - list[list.length - 1] > TAP_RESET_MS) list.length = 0;
    list.push(now);
    // A rolling window, so drifting into time corrects rather than averaging
    // the whole struggle.
    if (list.length > 8) list.shift();
    setCounting(list.length);

    window.clearTimeout(forget.current);
    forget.current = window.setTimeout(clear, 3_000);

    if (list.length < TAP_MINIMUM) return;
    const mean = (list[list.length - 1] - list[0]) / (list.length - 1);
    const bpm = Math.round((60_000 / mean) * 10) / 10;
    // The server takes 20–300; anything outside it is a misfire, not a tempo.
    if (bpm >= 20 && bpm <= 300) onBpm(bpm);
  };

  return (
    <button
      type="button"
      className={`btn tiny tap ${counting ? 'is-counting' : ''}`}
      disabled={disabled}
      title={
        disabled
          ? 'Load a track to tap its tempo'
          : 'Tap in time with the track to set its BPM - four taps to lock on'
      }
      onPointerDown={tap}
    >
      {counting > 0 && counting < TAP_MINIMUM ? `TAP ${counting}/${TAP_MINIMUM}` : 'TAP'}
    </button>
  );
}

export function DeckPanel({
  deck,
  other,
  media,
  locked,
  accent,
  send,
  throttled,
}: DeckPanelProps) {
  const [dropActive, setDropActive] = useState(false);

  const item = useMemo(
    () => (deck.mediaId ? media.find((m) => m.id === deck.mediaId) ?? null : null),
    [deck.mediaId, media],
  );
  const peaks = item?.peaks ?? [];
  const remaining = Math.max(0, deck.durationMs - deck.positionMs);
  const loopLength = Math.max(0, deck.loop.endMs - deck.loop.startMs);
  const empty = locked || !deck.mediaId;

  // The pool entry wins over the deck's copy: the deck caches the tempo it was
  // loaded with, so a freshly tapped BPM would not take effect until reload.
  const bpm = item?.bpm ?? deck.bpm ?? null;
  const beat = beatMs(bpm);
  const heard = playingBpm(bpm, deck.rate);
  const target = playingBpm(other.bpm, other.rate);
  const match = syncRate(bpm, target);
  const activeBeats = deck.loop.active ? loopBeats(loopLength, bpm) : null;

  const scaleLoop = (factor: number) => {
    const length = Math.max(50, loopLength || 4000) * factor;
    void send('deck:loop', {
      deck: deck.id,
      active: deck.loop.active,
      startMs: deck.loop.startMs,
      endMs: deck.loop.startMs + length,
    });
  };

  /** Drops a loop of N beats starting where the playhead is now. */
  const beatLoop = (beats: number) => {
    if (!beat) return;
    void send('deck:loop', {
      deck: deck.id,
      active: true,
      startMs: deck.positionMs,
      endMs: deck.positionMs + beats * beat,
    });
  };

  /** Jumps the playhead by whole beats, or by seconds on an untagged track. */
  const jump = (beats: number) => {
    void send('deck:nudge', { deck: deck.id, deltaMs: beats * (beat ?? 1000) });
  };

  return (
    <section
      className={`panel deck deck-${deck.id.toLowerCase()} ${dropActive ? 'is-drop' : ''}`}
      style={{ ['--deck-accent' as string]: accent }}
      onDragOver={(event) => {
        if (locked || !event.dataTransfer.types.includes('application/x-dj-media')) return;
        event.preventDefault();
        // Without an explicit dropEffect some browsers show a "no drop" cursor
        // even though the drop would be accepted.
        event.dataTransfer.dropEffect = 'copy';
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
              deck.playing ? 'playing' : deck.mediaId ? 'stopped' : 'empty',
              deck.rate !== 1 ? formatRate(deck.rate) : null,
              deck.repeat ? 'repeat' : null,
            ]
              .filter(Boolean)
              .join('   ')}
          </span>
        </div>
        <button
          type="button"
          className="ghost"
          disabled={empty}
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
        disabled={empty}
        onSeek={(ms) => throttled('deck:seek', { deck: deck.id, ms })}
      />

      <div className="deck-times">
        <span className="mono deck-elapsed">{formatTimeMs(deck.positionMs)}</span>
        <span
          className={`mono deck-remaining ${
            deck.playing && remaining < OUTRO_MS ? 'is-outro' : ''
          }`}
        >
          -{formatTimeMs(remaining)}
        </span>
      </div>

      <div className="deck-body">
        <div className="deck-transport">
          <div className="transport-row">
            <button
              type="button"
              className="btn cue"
              disabled={empty}
              onClick={() => void send('deck:cue', { deck: deck.id })}
              title="Jump to the cue point and stop"
            >
              CUE
            </button>
            <button
              type="button"
              className={`btn play ${deck.playing ? 'is-active' : ''}`}
              disabled={empty}
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
              disabled={empty}
              onClick={() => void send('deck:setCue', { deck: deck.id, ms: deck.positionMs })}
              title="Set the cue point here"
            >
              <MapPin size={12} />
              SET CUE
            </button>
            <button
              type="button"
              className="btn small"
              disabled={empty}
              onPointerDown={() => void send('deck:nudge', { deck: deck.id, deltaMs: -250 })}
              title="Nudge back 250 ms"
              aria-label="Nudge back"
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              type="button"
              className="btn small"
              disabled={empty}
              onPointerDown={() => void send('deck:nudge', { deck: deck.id, deltaMs: 250 })}
              title="Nudge forward 250 ms"
              aria-label="Nudge forward"
            >
              <ChevronsRight size={14} />
            </button>
          </div>

          <div className="tool-block">
            <span className="tool-label">Loop</span>
            <div className="transport-row loop-row">
              <button
                type="button"
                className="btn small"
                disabled={empty}
                title="Set the loop in point here"
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
                disabled={empty}
                title="Set the loop out point here and start looping"
                onClick={() =>
                  void send('deck:loop', { deck: deck.id, active: true, endMs: deck.positionMs })
                }
              >
                OUT
              </button>
              <button
                type="button"
                className={`btn small ${deck.loop.active ? 'is-loop' : ''}`}
                disabled={empty}
                title="Toggle the loop"
                onClick={() => void send('deck:loop', { deck: deck.id, active: !deck.loop.active })}
              >
                <Repeat size={12} />
                LOOP
              </button>
              <button
                type="button"
                className="btn small"
                disabled={empty}
                onClick={() => scaleLoop(0.5)}
                title="Halve the loop"
              >
                /2
              </button>
              <button
                type="button"
                className="btn small"
                disabled={empty}
                onClick={() => scaleLoop(2)}
                title="Double the loop"
              >
                x2
              </button>
            </div>

            <div className="beat-row">
              {BEAT_LOOPS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`btn tiny ${activeBeats === option.beats ? 'is-loop' : ''}`}
                  disabled={empty || !beat}
                  title={
                    beat
                      ? `Loop ${option.label} beat${option.beats === 1 ? '' : 's'} from here`
                      : 'Set a BPM on this track to use beat loops'
                  }
                  onClick={() => beatLoop(option.beats)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="tool-block">
            <span className="tool-label">{beat ? 'Jump (beats)' : 'Jump (seconds)'}</span>
            <div className="jump-row">
              {JUMPS.map((beats) => (
                <button
                  key={beats}
                  type="button"
                  className="btn tiny"
                  disabled={empty}
                  title={
                    beat
                      ? `Jump ${beats > 0 ? 'forward' : 'back'} ${Math.abs(beats)} beats`
                      : `Jump ${beats > 0 ? 'forward' : 'back'} ${Math.abs(beats)}s`
                  }
                  onClick={() => jump(beats)}
                >
                  {beats > 0 ? `+${beats}` : beats}
                </button>
              ))}
            </div>
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
            {deck.mediaId && deck.cueMs > 0 ? (
              <span className="chip cue-chip mono" title="Cue point">
                CUE {formatTime(deck.cueMs)}
              </span>
            ) : null}
            {deck.loop.active ? (
              <span className="chip loop-chip mono">
                {activeBeats
                  ? `${activeBeats < 1 ? `1/${1 / activeBeats}` : activeBeats} beat loop`
                  : `${(loopLength / 1000).toFixed(2)}s loop`}
              </span>
            ) : null}
          </div>
        </div>

        <div className="deck-pitch">
          <div className="bpm-readout" title="Tempo as the room hears it, pitch fader included">
            <span className="bpm-value mono">{heard ? heard.toFixed(1) : '--.-'}</span>
            <span className="bpm-unit">BPM</span>
          </div>

          <button
            type="button"
            className="btn tiny sync"
            disabled={locked || !match}
            title={
              match
                ? `Match deck ${other.id} at ${target?.toFixed(1)} bpm`
                : `Both decks need a BPM to sync`
            }
            onClick={() => match && void send('deck:set', { deck: deck.id, rate: match })}
          >
            SYNC
          </button>

          <Fader
            label="PITCH"
            value={deck.rate}
            min={0.5}
            max={2}
            defaultValue={1}
            detent
            disabled={locked}
            onChange={(rate) => throttled('deck:set', { deck: deck.id, rate })}
          />

          <span className={`mono tiny-value ${deck.rate !== 1 ? 'is-moved' : ''}`}>
            {formatRate(deck.rate)}
          </span>

          {/* The pitch fader resets on right-click like every other control, so
              a dedicated reset button would just be taking up the space. */}
          <TapTempo
            mediaId={deck.mediaId}
            disabled={empty}
            onBpm={(value) =>
              deck.mediaId && void send('media:update', { id: deck.mediaId, bpm: value })
            }
          />
        </div>
      </div>
    </section>
  );
}
