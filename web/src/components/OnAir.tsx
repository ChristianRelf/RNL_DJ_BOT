import { PhoneOff, Users } from 'lucide-react';
import type { VoiceState } from '../protocol';
import type { DjClient } from '../socket';

interface OnAirProps {
  voice: VoiceState;
  locked: boolean;
  send: DjClient['send'];
}

const LABEL: Record<VoiceState['status'], string> = {
  ready: 'ON AIR',
  connecting: 'CONNECTING',
  error: 'ERROR',
  disconnected: 'OFF AIR',
};

/**
 * Broadcast status, big enough to read from across a room.
 *
 * Joining a channel stays in the top bar - this is the at-a-glance answer to
 * "are we live, and is anyone listening", for a booth screen.
 */
export function OnAir({ voice, locked, send }: OnAirProps) {
  const live = voice.status === 'ready';

  return (
    <section className={`panel onair ${live ? 'is-live' : ''}`}>
      <header className="panel-head">
        <h2 className="panel-title">Broadcast</h2>
        <span className={`status-dot status-${voice.status}`} />
      </header>

      <div className={`onair-state ${live ? 'is-live' : ''}`}>{LABEL[voice.status]}</div>

      <div className="onair-channel" title={voice.channelName ?? undefined}>
        {voice.channelName ?? 'no channel'}
      </div>

      <div className="onair-foot">
        <span className="onair-listeners">
          <Users size={12} />
          <strong className="mono">{live ? voice.listeners : '--'}</strong>
          listening
        </span>
        {live ? (
          <button
            type="button"
            className="btn tiny"
            disabled={locked}
            title="Disconnect from the voice channel"
            onClick={() => void send('voice:leave', {})}
          >
            <PhoneOff size={11} />
            LEAVE
          </button>
        ) : null}
      </div>

      {voice.error ? <p className="onair-error">{voice.error}</p> : null}
    </section>
  );
}
