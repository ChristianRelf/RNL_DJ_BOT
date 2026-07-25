import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDj, useThrottledSend } from './socket';
import { TopBar } from './components/TopBar';
import { MediaPool } from './components/MediaPool';
import { DeckPanel } from './components/DeckPanel';
import { MixerPanel } from './components/MixerPanel';
import { Pads } from './components/Pads';
import { CrewPanel } from './components/CrewPanel';
import { Toasts } from './components/Toasts';
import { Login } from './components/Login';
import type { SessionUser } from './protocol';

const DECK_ACCENT = { A: '#5b9dd9', B: '#d98b4a' } as const;

export default function App() {
  const dj = useDj();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const throttled = useThrottledSend(dj.send);

  // Resolve the session before the socket handshake so the login screen does
  // not flash for users who are already signed in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      setLoginError(error);
      window.history.replaceState({}, '', window.location.pathname);
    }
    fetch('/api/me', { credentials: 'include' })
      .then((res) => setSignedIn(res.ok))
      .catch(() => setSignedIn(false));
  }, []);

  const state = dj.state;
  const me: SessionUser | null = dj.user;
  const hasControl = Boolean(state && me && state.control.holderId === me.id);
  const locked = !hasControl;

  // Keep the lock alive while the controller is actually driving the rig.
  // Depend on `send` (stable) rather than the whole client, which changes on
  // every state broadcast and would reset the interval before it ever fired.
  const send = dj.send;
  useEffect(() => {
    if (!hasControl) return;
    const timer = setInterval(() => void send('control:heartbeat', {}), 45_000);
    return () => clearInterval(timer);
  }, [hasControl, send]);

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (!state || locked) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 8) {
        event.preventDefault();
        void dj.send('pad:trigger', { index: digit - 1 });
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'q':
          event.preventDefault();
          void dj.send(state.decks.A.playing ? 'deck:pause' : 'deck:play', { deck: 'A' });
          break;
        case 'p':
          event.preventDefault();
          void dj.send(state.decks.B.playing ? 'deck:pause' : 'deck:play', { deck: 'B' });
          break;
        case '[':
          event.preventDefault();
          void dj.send('mixer:set', { crossfader: Math.max(-1, state.mixer.crossfader - 0.1) });
          break;
        case ']':
          event.preventDefault();
          void dj.send('mixer:set', { crossfader: Math.min(1, state.mixer.crossfader + 0.1) });
          break;
        default:
          break;
      }
    },
    [dj, locked, state],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const banner = useMemo(() => {
    if (dj.status === 'offline') return 'Disconnected from the rig.';
    if (dj.status === 'connecting' && state) return 'Reconnecting...';
    return null;
  }, [dj.status, state]);

  if (signedIn === false || dj.status === 'unauthorised') {
    // The callback's ?error= says *why* sign-in was refused (wrong role, state
    // mismatch, ...). The socket only ever reports the generic "Not signed in",
    // so the specific reason must win or the useful message is lost.
    return <Login error={loginError ?? dj.error} />;
  }

  if (!state || !me) {
    return (
      <div className="boot">
        <div className="boot-spinner" />
        <p>{dj.error ?? 'connecting'}</p>
      </div>
    );
  }

  return (
    <div className={`app ${locked ? 'is-locked' : 'is-live'}`}>
      <TopBar
        user={me}
        voice={state.voice}
        channels={state.channels}
        connection={dj.status}
        locked={locked}
        send={dj.send}
      />

      {banner ? <div className="banner">{banner}</div> : null}

      {locked ? (
        <div className="lock-strip">
          <strong>View only</strong>
          {state.control.holderName
            ? `${state.control.holderName} is on the decks. Request control to take over.`
            : 'Nobody has control. Take it to start mixing.'}
        </div>
      ) : null}

      <main className="console">
        <MediaPool media={dj.media} user={me} locked={locked} send={dj.send} />

        <DeckPanel
          deck={state.decks.A}
          media={dj.media}
          locked={locked}
          accent={DECK_ACCENT.A}
          send={dj.send}
          throttled={throttled}
        />

        <MixerPanel
          decks={state.decks}
          mixer={state.mixer}
          locked={locked}
          send={dj.send}
          throttled={throttled}
        />

        <DeckPanel
          deck={state.decks.B}
          media={dj.media}
          locked={locked}
          accent={DECK_ACCENT.B}
          send={dj.send}
          throttled={throttled}
        />

        <CrewPanel control={state.control} users={state.users} me={me} send={dj.send} />

        <Pads pads={state.pads} locked={locked} send={dj.send} />
      </main>

      <footer className="shortcuts">
        <span>
          <kbd>Q</kbd> <kbd>P</kbd> play deck A/B
        </span>
        <span>
          <kbd>1</kbd>-<kbd>8</kbd> pads
        </span>
        <span>
          <kbd>[</kbd> <kbd>]</kbd> crossfade
        </span>
        <span>double-click a knob to reset it, shift-drag for fine control</span>
      </footer>

      <Toasts toasts={dj.toasts} dismiss={dj.dismiss} />
    </div>
  );
}
