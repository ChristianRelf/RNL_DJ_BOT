import { useState } from 'react';
import type { ConnectionStatus, DjClient } from '../socket';
import type { SessionUser, VoiceChannelInfo, VoiceState } from '../protocol';

interface TopBarProps {
  user: SessionUser;
  voice: VoiceState;
  channels: VoiceChannelInfo[];
  connection: ConnectionStatus;
  locked: boolean;
  send: DjClient['send'];
}

export function TopBar({ user, voice, channels, connection, locked, send }: TopBarProps) {
  const [selected, setSelected] = useState('');
  const target = selected || voice.channelId || channels[0]?.id || '';

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">RNL</span>
        <span className="brand-text">DJ</span>
      </div>

      <div className="voice-controls">
        <span className={`status-dot status-${voice.status}`} title={`Voice: ${voice.status}`} />
        <select
          className="channel-select"
          value={target}
          disabled={locked || channels.length === 0}
          onChange={(event) => setSelected(event.target.value)}
        >
          {channels.length === 0 ? <option value="">No voice channels</option> : null}
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
              {channel.members > 0 ? ` (${channel.members})` : ''}
            </option>
          ))}
        </select>

        {voice.status === 'ready' || voice.status === 'connecting' ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={locked || !target || target === voice.channelId}
              onClick={() => void send('voice:join', { channelId: target })}
            >
              Move
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={locked}
              onClick={() => void send('voice:leave', {})}
            >
              Leave
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={locked || !target}
            onClick={() => void send('voice:join', { channelId: target })}
          >
            Go live
          </button>
        )}

        <span className="voice-status">
          {voice.status === 'ready'
            ? `on air in ${voice.channelName}, ${voice.listeners} listening`
            : voice.status === 'connecting'
              ? 'connecting'
              : voice.error
                ? voice.error
                : 'off air'}
        </span>
      </div>

      <div className="topbar-right">
        <span className={`conn conn-${connection}`}>{connection}</span>
        {user.avatarUrl ? <img className="avatar" src={user.avatarUrl} alt="" /> : null}
        <span className="me-name">{user.displayName}</span>
        <button type="button" className="btn tiny" onClick={() => void logout()}>
          SIGN OUT
        </button>
      </div>
    </header>
  );
}
