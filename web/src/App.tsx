import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { ToolsPage } from './components/ToolsPage';
import { NowPlaying } from './components/NowPlaying';
import { Transport } from './components/Transport';
import { Crossfader } from './components/Crossfader';
import { OnAir } from './components/OnAir';
import { SessionClock } from './components/SessionClock';
import { ShortcutsPanel } from './components/ShortcutsPanel';
import { LayoutPalette, WidgetChrome } from './components/LayoutEditor';
import {
  clampSpan,
  columnsFor,
  defaultLayout,
  fromPreset,
  GRID_COLUMNS,
  loadLayout,
  reorder,
  saveLayout,
  type Layout,
  type WidgetId,
} from './lib/layout';
import type { SessionUser } from './protocol';

const DECK_ACCENT = { A: '#5b9dd9', B: '#d98b4a' } as const;

/** Both views share the socket and the session gate, so they share a component. */
export default function App({ view = 'console' }: { view?: 'console' | 'tools' }) {
  const dj = useDj();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const throttled = useThrottledSend(dj.send);

  // ------------------------------------------------------------- layout ---

  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [arranging, setArranging] = useState(false);
  const [columns, setColumns] = useState(GRID_COLUMNS);
  const dragFrom = useRef<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  // A callback ref rather than an effect: the grid only exists once the socket
  // has delivered a state, so there is nothing to observe on first render.
  const gridRef = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const next = new ResizeObserver(([entry]) => setColumns(columnsFor(entry.contentRect.width)));
    next.observe(node);
    observer.current = next;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  const applyLayout = useCallback((next: Layout) => {
    setLayout(next);
    saveLayout(next);
  }, []);

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

  /** Every widget the console can show, built once and placed by the layout. */
  const widgets: Record<WidgetId, ReactNode> = {
    pool: <MediaPool media={dj.media} user={me} locked={locked} send={dj.send} />,
    deckA: (
      <DeckPanel
        deck={state.decks.A}
        other={state.decks.B}
        media={dj.media}
        locked={locked}
        accent={DECK_ACCENT.A}
        send={dj.send}
        throttled={throttled}
      />
    ),
    mixer: (
      <MixerPanel
        decks={state.decks}
        mixer={state.mixer}
        locked={locked}
        send={dj.send}
        throttled={throttled}
      />
    ),
    deckB: (
      <DeckPanel
        deck={state.decks.B}
        other={state.decks.A}
        media={dj.media}
        locked={locked}
        accent={DECK_ACCENT.B}
        send={dj.send}
        throttled={throttled}
      />
    ),
    output: <OutputPanel mixer={state.mixer} voice={state.voice} />,
    crew: <CrewPanel control={state.control} users={state.users} me={me} send={dj.send} />,
    pads: <Pads pads={state.pads} locked={locked} send={dj.send} throttled={throttled} />,
    nowPlaying: <NowPlaying decks={state.decks} mixer={state.mixer} />,
    transport: <Transport decks={state.decks} locked={locked} send={dj.send} />,
    crossfader: (
      <Crossfader
        value={state.mixer.crossfader}
        locked={locked}
        send={dj.send}
        throttled={throttled}
        standalone
      />
    ),
    onAir: <OnAir voice={state.voice} locked={locked} send={dj.send} />,
    clock: <SessionClock control={state.control} me={me} />,
    shortcuts: <ShortcutsPanel />,
  };

  // Positions of the widgets actually on the console. The move buttons step
  // through these rather than raw indices, so a hidden widget in between never
  // makes an arrow look broken.
  const visible = layout.reduce<number[]>((acc, placed, index) => {
    if (!placed.hidden) acc.push(index);
    return acc;
  }, []);

  const shift = (index: number, delta: number) => {
    const target = visible[visible.indexOf(index) + delta];
    if (target === undefined) return;
    applyLayout(reorder(layout, index, target));
  };

  return (
    <div className={`app ${locked ? 'is-locked' : 'is-live'}`}>
      <TopBar
        user={me}
        voice={state.voice}
        channels={state.channels}
        connection={dj.status}
        locked={locked}
        send={dj.send}
        onArrange={view === 'console' ? () => setArranging((on) => !on) : undefined}
        arranging={arranging}
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

      {view === 'tools' ? (
        <ToolsPage state={state} locked={locked} send={dj.send} />
      ) : (
      <>
        {arranging ? (
          <LayoutPalette
            layout={layout}
            columns={columns}
            onShow={(id) =>
              applyLayout(layout.map((w) => (w.id === id ? { ...w, hidden: false } : w)))
            }
            onPreset={(preset) => applyLayout(fromPreset(preset))}
            onReset={() => applyLayout(defaultLayout())}
            onDone={() => setArranging(false)}
          />
        ) : null}

        <main
          className={`console ${arranging ? 'is-arranging' : ''}`}
          ref={gridRef}
          style={{ ['--cols' as string]: columns }}
        >
          {layout.map((placed, index) => {
            if (placed.hidden) return null;
            const position = visible.indexOf(index);
            return (
              <div
                key={placed.id}
                className="widget"
                style={{ gridColumn: `span ${Math.min(placed.span, columns)}` }}
                onDragOver={(event) => {
                  if (!arranging || dragFrom.current === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  if (!arranging || dragFrom.current === null) return;
                  event.preventDefault();
                  applyLayout(reorder(layout, dragFrom.current, index));
                  dragFrom.current = null;
                }}
              >
                {arranging ? (
                  <WidgetChrome
                    index={index}
                    id={placed.id}
                    span={placed.span}
                    columns={columns}
                    isFirst={position === 0}
                    isLast={position === visible.length - 1}
                    onMove={(delta) => shift(index, delta)}
                    onResize={(span) =>
                      applyLayout(
                        layout.map((w) =>
                          w.id === placed.id ? { ...w, span: clampSpan(w.id, span) } : w,
                        ),
                      )
                    }
                    onHide={() =>
                      applyLayout(
                        layout.map((w) => (w.id === placed.id ? { ...w, hidden: true } : w)),
                      )
                    }
                    onDragStart={() => {
                      dragFrom.current = index;
                    }}
                    onDragEnd={() => {
                      dragFrom.current = null;
                    }}
                  />
                ) : null}
                {widgets[placed.id]}
              </div>
            );
          })}
        </main>
      </>
      )}

      <footer className="shortcuts">
        {view === 'console' ? (
          <>
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
          </>
        ) : null}
        <Colophon />
      </footer>

      <Toasts toasts={dj.toasts} dismiss={dj.dismiss} />
    </div>
  );
}
