import { useState } from 'react';
import { X } from 'lucide-react';
import { Meter, Slider } from './controls';
import type { PadMode, PadState } from '../protocol';
import type { DjClient } from '../socket';

interface PadsProps {
  pads: PadState[];
  locked: boolean;
  send: DjClient['send'];
  throttled: (command: 'pad:set', payload: any) => void;
}

const MODES: PadMode[] = ['oneshot', 'loop', 'gate'];
const MODE_LABEL: Record<PadMode, string> = { oneshot: 'ONE', loop: 'LOOP', gate: 'HOLD' };
const MODE_HINT: Record<PadMode, string> = {
  oneshot: 'One shot - fires and runs to the end',
  loop: 'Loop - fires until you hit it again',
  gate: 'Hold - plays only while held',
};
/** Pad gain default, matching the engine. */
const PAD_GAIN = 0.9;

export function Pads({ pads, locked, send, throttled }: PadsProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const trigger = (pad: PadState) => {
    if (locked || !pad.mediaId) return;
    if (pad.playing && pad.mode !== 'oneshot') void send('pad:stop', { index: pad.index });
    else void send('pad:trigger', { index: pad.index });
  };

  return (
    <section className="panel pads">
      <header className="panel-head">
        <h2 className="panel-title">Sample pads</h2>
        <span className="hint">drop a track on a pad · keys 1-8 fire them</span>
        <Meter channel="pads" vertical={false} />
      </header>

      <div className="pad-grid">
        {pads.map((pad) => (
          <div
            key={pad.index}
            className={[
              'pad',
              pad.playing ? 'is-playing' : '',
              pad.mediaId ? 'is-loaded' : 'is-empty',
              dropIndex === pad.index ? 'is-drop' : '',
            ].join(' ')}
            onDragOver={(event) => {
              if (locked || !event.dataTransfer.types.includes('application/x-dj-media')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setDropIndex(pad.index);
            }}
            onDragLeave={() => setDropIndex((i) => (i === pad.index ? null : i))}
            onDrop={(event) => {
              event.preventDefault();
              setDropIndex(null);
              if (locked) return;
              const mediaId = event.dataTransfer.getData('application/x-dj-media');
              if (mediaId) void send('pad:assign', { index: pad.index, mediaId });
            }}
          >
            <button
              type="button"
              className="pad-hit"
              disabled={locked || !pad.mediaId}
              onPointerDown={() => {
                if (pad.mode === 'gate') {
                  if (!locked && pad.mediaId) void send('pad:trigger', { index: pad.index });
                } else {
                  trigger(pad);
                }
              }}
              onPointerUp={() => {
                if (pad.mode === 'gate' && !locked) void send('pad:stop', { index: pad.index });
              }}
              onPointerLeave={() => {
                if (pad.mode === 'gate' && pad.playing && !locked) {
                  void send('pad:stop', { index: pad.index });
                }
              }}
            >
              <span className="pad-index">{pad.index + 1}</span>
              <span className="pad-title">{pad.title ?? 'empty'}</span>
              {/* Playback position, so a long sample tells you how far it has
                  left to run without opening anything. */}
              <span className="pad-progress" aria-hidden="true">
                <span
                  style={{
                    width:
                      pad.playing && pad.durationMs > 0
                        ? `${Math.min(100, (pad.positionMs / pad.durationMs) * 100)}%`
                        : '0%',
                  }}
                />
              </span>
            </button>

            <div className="pad-tools">
              <button
                type="button"
                className={`pad-mode is-${pad.mode}`}
                disabled={locked || !pad.mediaId}
                title={`${MODE_HINT[pad.mode]} - click to cycle`}
                onClick={() => {
                  const next = MODES[(MODES.indexOf(pad.mode) + 1) % MODES.length];
                  void send('pad:set', { index: pad.index, mode: next });
                }}
              >
                {MODE_LABEL[pad.mode]}
              </button>
              <Slider
                label={`Pad ${pad.index + 1} level`}
                value={pad.gain}
                min={0}
                max={1.5}
                defaultValue={PAD_GAIN}
                compact
                disabled={locked || !pad.mediaId}
                onChange={(gain) => throttled('pad:set', { index: pad.index, gain })}
              />
              <button
                type="button"
                className="pad-clear"
                disabled={locked || !pad.mediaId}
                title="Clear pad"
                aria-label={`Clear pad ${pad.index + 1}`}
                onClick={() => void send('pad:assign', { index: pad.index, mediaId: null })}
              >
                <X size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
