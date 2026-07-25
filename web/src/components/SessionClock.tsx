import { useEffect, useState } from 'react';
import type { ControlState, SessionUser } from '../protocol';

interface SessionClockProps {
  control: ControlState;
  me: SessionUser;
}

function elapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Wall clock and time on the decks.
 *
 * A booth loses track of the hour, and a set that was meant to be forty minutes
 * has a habit of being ninety.
 */
export function SessionClock({ control, me }: SessionClockProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Lined up to the next whole second so the display does not visibly lag it.
    let timer: number;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => window.clearTimeout(timer);
  }, []);

  const clock = new Date(now).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const mine = control.holderId === me.id;

  return (
    <section className="panel clock">
      <h2 className="panel-title">Session</h2>

      <div className="clock-time mono">{clock}</div>

      <dl className="clock-stats">
        <div>
          <dt>On the decks</dt>
          <dd className="mono">
            {control.heldSince ? elapsed(control.heldSince, now) : '--:--'}
          </dd>
        </div>
        <div>
          <dt>Who</dt>
          <dd className={mine ? 'is-mine' : ''}>
            {control.holderName ?? 'nobody'}
            {mine ? ' (you)' : ''}
          </dd>
        </div>
        {control.queue.length > 0 ? (
          <div>
            <dt>Waiting</dt>
            <dd>{control.queue.length}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
