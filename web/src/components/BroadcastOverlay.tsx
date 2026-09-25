import { useEffect, useMemo, useState } from 'react';

interface TimecodeDeck {
  deck: 'A' | 'B';
  title: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  remainingMs: number;
  bpm: number | null;
}

interface TimecodeState {
  decks: TimecodeDeck[];
  mixer: { crossfader: number; master: number };
  voice: { status: string; channelName: string | null };
}

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function BroadcastOverlay() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const rigApi = params.get('rig') ?? '';
  const key = params.get('key') ?? '';
  const valid = /^\/api\/g\/\d{15,25}$/.test(rigApi) && /^[a-f0-9]{32}$/i.test(key);
  const [state, setState] = useState<TimecodeState | null>(null);
  const [error, setError] = useState<string | null>(valid ? null : 'This overlay URL is invalid.');

  useEffect(() => {
    document.documentElement.classList.add('is-broadcast-overlay');
    return () => document.documentElement.classList.remove('is-broadcast-overlay');
  }, []);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let running = false;
    const read = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`${rigApi}/timecode?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error ?? `Feed unavailable (${response.status})`);
        if (!cancelled) { setState(body); setError(null); }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        running = false;
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [key, rigApi, valid]);

  const deck = state
    ? state.decks.find((item) => item.deck === (state.mixer.crossfader > 0 ? 'B' : 'A')) ?? state.decks[0]
    : null;
  const progress = deck?.durationMs ? Math.min(100, Math.max(0, deck.positionMs / deck.durationMs * 100)) : 0;

  return (
    <main className="broadcast-overlay-shell">
      <section className={`broadcast-overlay${deck?.playing ? ' is-playing' : ''}`}>
        <div className="broadcast-overlay-signal"><span /> ON AIR</div>
        <div className="broadcast-overlay-copy">
          <span className="broadcast-overlay-label">NOW PLAYING / DECK {deck?.deck ?? '-'}</span>
          <strong>{deck?.title || (error ? 'Deck feed unavailable' : 'Waiting for the next track')}</strong>
          <div className="broadcast-overlay-meta">
            <span>{deck?.bpm ? `${deck.bpm.toFixed(1)} BPM` : '- BPM'}</span>
            <span>{deck ? `-${clock(deck.remainingMs)}` : '--:--'}</span>
            <span>{state?.voice.channelName ?? state?.voice.status ?? 'offline'}</span>
          </div>
        </div>
        <div className="broadcast-overlay-progress"><span style={{ width: `${progress}%` }} /></div>
      </section>
    </main>
  );
}
