import { useEffect, useState } from 'react';
import { countdown } from '../lib/format';
import type { ControlState, PresenceUser, SessionUser } from '../protocol';
import type { DjClient } from '../socket';

interface CrewPanelProps {
  control: ControlState;
  users: PresenceUser[];
  me: SessionUser;
  send: DjClient['send'];
}

export function CrewPanel({ control, users, me, send }: CrewPanelProps) {
  const hasControl = control.holderId === me.id;
  const queued = control.queue.some((q) => q.userId === me.id);
  const [, forceTick] = useState(0);

  // The idle countdown is derived from a timestamp, so re-render it once a
  // second rather than pushing state from the server every tick.
  useEffect(() => {
    if (!control.expiresAt) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [control.expiresAt]);

  const expiry = countdown(control.expiresAt);

  return (
    <section className="panel crew">
      <h2 className="panel-title">On the decks</h2>

      <div className={`control-card ${hasControl ? 'is-mine' : control.holderId ? 'is-theirs' : 'is-free'}`}>
        <span className="control-label">Control</span>
        <strong className="control-holder">
          {hasControl ? 'You' : (control.holderName ?? 'Nobody')}
        </strong>
        {expiry ? <span className="control-expiry">idle handover in {expiry}</span> : null}

        <div className="control-actions">
          {hasControl ? (
            <button type="button" className="btn" onClick={() => void send('control:release', {})}>
              Release
            </button>
          ) : queued ? (
            <button type="button" className="btn" onClick={() => void send('control:cancel', {})}>
              Leave queue ({control.queue.findIndex((q) => q.userId === me.id) + 1})
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void send('control:request', {})}
            >
              {control.holderId ? 'Request control' : 'Take control'}
            </button>
          )}

          {me.isAdmin && !hasControl && control.holderId ? (
            <button
              type="button"
              className="btn danger"
              title="Admin override"
              onClick={() => void send('control:take', {})}
            >
              Force take
            </button>
          ) : null}
        </div>
      </div>

      {control.queue.length > 0 ? (
        <ol className="queue">
          {control.queue.map((entry, index) => (
            <li key={entry.userId}>
              <span className="queue-pos mono">{index + 1}</span>
              <span className="queue-name">{entry.name}</span>
              {hasControl || me.isAdmin ? (
                <button
                  type="button"
                  className="btn tiny"
                  title="Hand over control"
                  onClick={() => void send('control:grant', { userId: entry.userId })}
                >
                  HAND OVER
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      <ul className="crew-list">
        {users.map((user) => (
          <li key={user.id} className={control.holderId === user.id ? 'is-holder' : ''}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="avatar" />
            ) : (
              <span className="avatar avatar-fallback">{user.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="crew-name">
              {user.name}
              {user.id === me.id ? ' (you)' : ''}
            </span>
            {user.isAdmin ? <span className="chip">admin</span> : null}
            {control.holderId === user.id ? <span className="chip live">control</span> : null}
            {(hasControl || me.isAdmin) && control.holderId !== user.id ? (
              <button
                type="button"
                className="btn tiny"
                title="Give this DJ control"
                onClick={() => void send('control:grant', { userId: user.id })}
              >
                GIVE
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
