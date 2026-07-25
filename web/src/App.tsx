import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDj, useThrottledSend } from './socket';
import { TopBar } from './components/TopBar';
import { MediaPool } from './components/MediaPool';
import { DeckPanel } from './components/DeckPanel';
import { MixerPanel } from './components/MixerPanel';
import { Pads } from './components/Pads';
import { OutputPanel } from './components/OutputPanel';
import { CrewPanel } from './components/CrewPanel';
import { Toasts } from './components/Toasts';
import { Colophon } from './components/Colophon';
import { SignIn } from './components/SignIn';
import type { SessionUser } from './protocol';

const DECK_ACCENT = { A: '#5b9dd9', B: '#d98b4a' } as const;

export default function App() {
  const dj = useDj();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const throttled = useThrottledSend(dj.send);

  // Resolve the session before the socket handshake so the home page does not
  // flash for users who are already signed in. Sign-in failures never land
  // here — the OAuth callback sends those to /login with the reason.
  useEffect(() => {
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
    // Deliberately renders rather than redirecting to /login: the socket can
    // reject a session that /api/me still accepts (a role removed mid-session),
    // and /login bounces valid sessions back here — a redirect would loop.
    return <SignIn error={dj.error} />;
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
          other={state.decks.B}
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
          other={state.decks.A}
          media={dj.media}
          locked={locked}
          accent={DECK_ACCENT.B}
          send={dj.send}
          throttled={throttled}
        />

        <OutputPanel mixer={state.mixer} voice={state.voice} />

        <CrewPanel control={state.control} users={state.users} me={me} send={dj.send} />

        <Pads pads={state.pads} locked={locked} send={dj.send} throttled={throttled} />
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
        <span>right-click a control to reset it</span>
        <span>shift-drag or right-drag for fine control</span>
        <span>scroll over a knob or fader to trim it</span>
        <Colophon />
      </footer>

      <Toasts toasts={dj.toasts} dismiss={dj.dismiss} />
    </div>
  );
}
