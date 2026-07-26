import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDj, useThrottledSend } from './socket';
import { TopBar } from './components/TopBar';
import { MediaPool } from './components/MediaPool';
import { QueuePanel } from './components/QueuePanel';
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
import { LayoutPalette } from './components/LayoutEditor';
import { ConsoleGrid } from './components/ConsoleGrid';
import { MixerAdvanced } from './components/MixerAdvanced';
import { FxRack } from './components/FxRack';
import { MidiPanel } from './components/MidiPanel';
import {
  compact,
  defaultLayout,
  firstFreeRow,
  fromPreset,
  hasStoredLayout,
  loadLayout,
  place,
  saveLayout,
  spec,
  STACK_WIDTH_PX,
  type Layout,
  type WidgetId,
} from './lib/layout';
import { useMidiRuntime } from './lib/useMidi';
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
  // Tools waiting to be sized to their own content: everything on a console
  // that has never been arranged, and anything added from the tray afterwards.
  // The palette's heights are guesses about panels whose height depends on what
  // is in them, so a measurement beats a guess wherever one is available.
  const [fitting, setFitting] = useState<ReadonlySet<WidgetId>>(() =>
    hasStoredLayout()
      ? new Set<WidgetId>()
      : new Set(layout.filter((item) => !item.hidden).map((item) => item.id)),
  );
  const [stacked, setStacked] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < STACK_WIDTH_PX,
  );

  // Below the stacking width the grid stops being a grid, so arranging has to
  // stand down with it — there would be nothing to arrange.
  useEffect(() => {
    const onResize = () => setStacked(window.innerWidth < STACK_WIDTH_PX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (stacked) setArranging(false);
  }, [stacked]);

  const applyLayout = useCallback((next: Layout) => {
    setLayout(next);
    saveLayout(next);
  }, []);

  /** Drops a tool onto the first row with room for it, then fits it. */
  const addWidget = useCallback(
    (id: WidgetId) => {
      const widget = spec(id);
      const y = firstFreeRow(layout, 0, widget.w, widget.h);
      applyLayout(place(layout, id, { x: 0, y, w: widget.w, h: widget.h }));
      setFitting((prev) => new Set(prev).add(id));
    },
    [applyLayout, layout],
  );

  /**
   * Sets one tile's height from what its panel actually measured. Several tiles
   * can report in the same tick, so this builds on the layout as it stands
   * rather than on the one the render started with.
   */
  const fitHeight = useCallback((id: WidgetId, rows: number) => {
    setLayout((prev) => {
      const item = prev.find((entry) => entry.id === id);
      if (!item || item.hidden || item.h === rows) return prev;
      const next = place(prev, id, { ...item, h: rows });
      saveLayout(next);
      return next;
    });
    setFitting((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /** A preset is a fresh start, so its tiles are fitted like a fresh console. */
  const applyPreset = useCallback(
    (next: Layout) => {
      applyLayout(next);
      setFitting(new Set(next.filter((item) => !item.hidden).map((item) => item.id)));
    },
    [applyLayout],
  );

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

  // A controller keeps working whether or not the MIDI panel is on the console,
  // so the runtime hangs here rather than inside the widget. It idles until the
  // socket has delivered a state to act against.
  const midi = useMidiRuntime(
    useMemo(
      () => (state ? { state, send: dj.send, throttled } : null),
      [dj, state, throttled],
    ),
  );

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
    queue: (
      <QueuePanel
        queue={state.queue}
        media={dj.media}
        me={me}
        locked={locked}
        send={dj.send}
      />
    ),
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
    mixerAdvanced: (
      <MixerAdvanced
        decks={state.decks}
        mixer={state.mixer}
        locked={locked}
        send={dj.send}
        throttled={throttled}
      />
    ),
    fx: (
      <FxRack
        decks={state.decks}
        mixer={state.mixer}
        locked={locked}
        send={dj.send}
        throttled={throttled}
      />
    ),
    midi: <MidiPanel midi={midi} />,
  };

  return (
    <div className={`app ${locked ? 'is-locked' : 'is-live'}`}>
      <TopBar
        user={me}
        voice={state.voice}
        bot={state.bot}
        channels={state.channels}
        connection={dj.status}
        locked={locked}
        send={dj.send}
        onArrange={view === 'console' && !stacked ? () => setArranging((on) => !on) : undefined}
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
        <ToolsPage state={state} user={me} locked={locked} send={dj.send} />
      ) : (
      <>
        {arranging ? (
          <LayoutPalette
            layout={layout}
            onAdd={addWidget}
            onPreset={(preset) => applyPreset(fromPreset(preset))}
            onCompact={() => applyLayout(compact(layout))}
            onReset={() => applyPreset(defaultLayout())}
            onDone={() => setArranging(false)}
          />
        ) : null}

        <ConsoleGrid
          layout={layout}
          arranging={arranging}
          stacked={stacked}
          render={(id) => widgets[id]}
          onChange={applyLayout}
          onHide={(id) =>
            applyLayout(layout.map((w) => (w.id === id ? { ...w, hidden: true } : w)))
          }
          fitting={fitting}
          onFitHeight={fitHeight}
        />
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
