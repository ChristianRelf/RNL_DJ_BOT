import { formatTime } from '../lib/format';
import { playingBpm } from '../lib/beats';
import { DECK_IDS, type DeckState, type MixerState } from '../protocol';

interface NowPlayingProps {
  decks: Record<'A' | 'B', DeckState>;
  mixer: MixerState;
}

const ACCENT = { A: 'var(--deck-a)', B: 'var(--deck-b)' } as const;

/**
 * What the room is actually hearing, in type you can read across a booth.
 *
 * "Loudest" is worked out the same way the engine mixes: the crossfader is
 * constant-power, so a centred fader is not half each — it is cos/sin of a
 * quarter turn. Doing it any other way would name the wrong deck around the
 * middle of a blend.
 */
function contribution(deck: DeckState, crossfader: number): number {
  if (!deck.playing) return 0;
  const theta = ((crossfader + 1) / 2) * (Math.PI / 2);
  const fader = deck.id === 'A' ? Math.cos(theta) : Math.sin(theta);
  return deck.gain * deck.trim * fader;
}

export function NowPlaying({ decks, mixer }: NowPlayingProps) {
  const ranked = DECK_IDS.map((id) => ({
    deck: decks[id],
    level: contribution(decks[id], mixer.crossfader),
  })).sort((a, b) => b.level - a.level);

  const live = ranked[0].level > 0 ? ranked[0].deck : null;
  const next = ranked[1].deck;
  const progress =
    live && live.durationMs > 0 ? Math.min(1, live.positionMs / live.durationMs) : 0;
  const remaining = live ? Math.max(0, live.durationMs - live.positionMs) : 0;
  const bpm = live ? playingBpm(live.bpm, live.rate) : null;

  return (
    <section className="panel nowplaying">
      <header className="panel-head">
        <h2 className="panel-title">On air</h2>
        {live ? (
          <span className="np-badge" style={{ background: ACCENT[live.id] }}>
            {live.id}
          </span>
        ) : (
          <span className="chip">silent</span>
        )}
      </header>

      <div className="np-body">
        <strong className="np-title" title={live?.title ?? undefined}>
          {live?.title ?? 'Nothing on air'}
        </strong>

        <div className="np-times mono">
          <span>{live ? formatTime(live.positionMs) : '0:00'}</span>
          <span className={remaining > 0 && remaining < 30_000 ? 'is-outro' : 'muted'}>
            -{formatTime(remaining)}
          </span>
        </div>

        <div className="np-bar">
          <span
            style={{
              width: `${progress * 100}%`,
              background: live ? ACCENT[live.id] : 'var(--line-strong)',
            }}
          />
        </div>

        <div className="np-meta">
          {bpm ? <span className="chip mono">{bpm.toFixed(1)} bpm</span> : null}
          {next.title && next.id !== live?.id ? (
            <span className="np-next">
              Next on {next.id}: <span className="np-next-title">{next.title}</span>
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
