import { Headphones, Users } from 'lucide-react';
import { ClipLamp, Meter, PeakReadout } from './controls';
import { formatDb } from '../lib/format';
import type { MixerState, VoiceState } from '../protocol';

interface OutputPanelProps {
  mixer: MixerState;
  voice: VoiceState;
}

const LANES = [
  { channel: 'A', label: 'A' },
  { channel: 'B', label: 'B' },
  { channel: 'pads', label: 'PAD' },
] as const;

/**
 * Scale marks for the master meter. meterScale() maps dBFS linearly onto the
 * bar between a -48 dB floor and 0, so each mark sits at its own fraction of
 * the width rather than being evenly spaced.
 */
const FLOOR_DB = -48;
const SCALE_DB = [-48, -24, -12, -6, 0];

/**
 * The meter bridge. Everything here is read-only — it answers "what is actually
 * going out to the room" without making you read it off the mixer strips.
 */
export function OutputPanel({ mixer, voice }: OutputPanelProps) {
  return (
    <section className="panel output">
      <header className="panel-head">
        <h2 className="panel-title">Booth output</h2>
        <ClipLamp />
      </header>

      <div className="bridge-master">
        <div className="bridge-head">
          <span className="tool-label">MASTER</span>
          <span className="bridge-peak">
            <PeakReadout channel="master" />
            <span className="bridge-unit">dBFS</span>
          </span>
        </div>
        <Meter channel="master" vertical={false} className="is-tall" />
        <div className="bridge-scale mono" aria-hidden="true">
          {SCALE_DB.map((db) => (
            <span key={db} style={{ left: `${((db - FLOOR_DB) / -FLOOR_DB) * 100}%` }}>
              {db}
            </span>
          ))}
        </div>
      </div>

      <div className="bridge-lanes">
        {LANES.map((lane) => (
          <div className="bridge-lane" key={lane.channel}>
            <span className="tool-label">{lane.label}</span>
            <Meter channel={lane.channel} vertical={false} className="is-slim" />
            <PeakReadout channel={lane.channel} />
          </div>
        ))}
      </div>

      <dl className="bridge-stats">
        <div>
          <dt>
            <Headphones size={11} /> Master
          </dt>
          <dd className="mono">{formatDb(mixer.master)} dB</dd>
        </div>
        <div>
          <dt>
            <Users size={11} /> Listening
          </dt>
          <dd className="mono">{voice.status === 'ready' ? voice.listeners : '--'}</dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd className="bridge-channel">{voice.channelName ?? 'not connected'}</dd>
        </div>
      </dl>
    </section>
  );
}
