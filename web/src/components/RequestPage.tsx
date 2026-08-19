import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Disc3, Radio, Search, Send } from 'lucide-react';
import { formatTime } from '../lib/format';
import type { RequestItem, RequestPageInfo, RequestRigSummary, RequestTrack } from '../protocol';

/**
 * Asking for a track.
 *
 * The one page in the app written for the room rather than for the booth. It
 * assumes a phone, one hand, and a voice channel it was read out into — so it
 * is one screen with one field on it, and it never opens a socket: a hundred
 * people in a channel are a hundred sockets the rig would carry for the sake of
 * a page that has nothing to stream.
 *
 * Two ways to ask, in the order they are worth trying. Searching the rig's
 * library gets a track the DJ can accept with one press, because the record is
 * already in the box. Failing that, typing what you want is still worth doing —
 * it just becomes a note the DJ reads rather than something they can queue.
 */

interface Sent {
  ok: boolean;
  message: string;
}

/** Signed in, but not to a rig that is taking requests. */
function Boot({ children }: { children: React.ReactNode }) {
  return <div className="boot">{children}</div>;
}

export function RequestPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<RequestPageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/requests/${encodeURIComponent(slug)}`, {
      credentials: 'include',
    });
    if (res.status === 401) {
      setNeedsSignIn(true);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as Partial<RequestPageInfo> & {
      error?: string;
    };
    if (!res.ok) {
      setError(body.error ?? 'That did not load.');
      return;
    }
    setInfo(body as RequestPageInfo);
  }, [slug]);

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, [load]);

  if (needsSignIn) return <SignInPrompt slug={slug} />;

  if (error) {
    return (
      <Boot>
        <AlertTriangle size={18} />
        <p>{error}</p>
      </Boot>
    );
  }

  if (!info) {
    return (
      <Boot>
        <p>loading</p>
      </Boot>
    );
  }

  return <RequestForm info={info} reload={load} />;
}

/**
 * Sign-in, for somebody who has probably never seen this app before.
 *
 * Deliberately not the ordinary front door: that one talks about DJ roles and
 * getting access, neither of which applies to a person who just wants to hear a
 * record. `next` brings them back here rather than to a console they cannot
 * open.
 */
function SignInPrompt({ slug }: { slug: string }) {
  const next = `/g/${slug}/request`;
  return (
    <div className="request-page">
      <main className="request-card is-narrow">
        <img className="request-logo" src="/deckLogo.png" alt="deck" />
        <h1>Ask for a track</h1>
        <p className="request-lede">
          Sign in with Discord so the booth knows who is asking. You need to be in the server the
          decks are playing to — nothing else.
        </p>
        <a
          className="site-btn is-primary request-signin"
          href={`/api/auth/login?next=${encodeURIComponent(next)}`}
        >
          Sign in with Discord
        </a>
        <p className="request-note">
          Sign-in happens at Discord. We never see your password, and this gets you the request page
          and nothing else.
        </p>
      </main>
    </div>
  );
}

function RigHead({ rig, nowPlaying }: { rig: RequestRigSummary; nowPlaying: string | null }) {
  return (
    <header className="request-head">
      <img className="request-logo" src="/deckLogo.png" alt="deck" />
      <h1>{rig.name}</h1>
      <p className={`request-live ${rig.live ? 'is-live' : ''}`}>
        {rig.live ? (
          <>
            <Radio size={12} /> on air
          </>
        ) : (
          <>
            <Disc3 size={12} /> off air
          </>
        )}
        {nowPlaying ? <span className="request-np"> · {nowPlaying}</span> : null}
      </p>
    </header>
  );
}

function RequestForm({ info, reload }: { info: RequestPageInfo; reload: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<RequestTrack | null>(null);
  const [hits, setHits] = useState<RequestTrack[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [remaining, setRemaining] = useState(info.remaining);

  const slug = info.rig.slug;
  // Bumped on every keystroke so a slow search that lands after a newer one
  // cannot overwrite it with stale hits.
  const searchSeq = useRef(0);

  // Typing is what searches — there is no search button, because on a phone that
  // is one more thing to reach for. Debounced so a five-letter title is one
  // request rather than five.
  useEffect(() => {
    const query = text.trim();
    if (picked || query.length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/requests/${encodeURIComponent(slug)}/search?q=${encodeURIComponent(query)}`, {
        credentials: 'include',
      })
        .then((res) => (res.ok ? res.json() : { tracks: [] }))
        .then((body: { tracks?: RequestTrack[] }) => {
          if (seq !== searchSeq.current) return;
          setHits(body.tracks ?? []);
          setSearching(false);
        })
        .catch(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [text, picked, slug]);

  const submit = async () => {
    if (busy) return;
    const asking = picked ? picked.title : text.trim();
    if (asking.length < 2) return;
    setBusy(true);
    setSent(null);
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(slug)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mediaId: picked?.mediaId ?? null, text: asking, note: note.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        remaining?: number;
      };
      if (res.ok) {
        setSent({ ok: true, message: `Asked for "${asking}". The booth can see it.` });
        setText('');
        setNote('');
        setPicked(null);
        setHits(null);
        if (typeof body.remaining === 'number') setRemaining(body.remaining);
        await reload();
      } else {
        setSent({ ok: false, message: body.error ?? 'That did not go through.' });
      }
    } catch (err) {
      setSent({ ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!info.rig.open) {
    return (
      <div className="request-page">
        <main className="request-card">
          <RigHead rig={info.rig} nowPlaying={info.nowPlaying} />
          <p className="request-closed">
            {info.rig.name} is not taking requests at the moment. Whoever runs the decks can open
            them from the rig's tools page.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="request-page">
      <main className="request-card">
        <RigHead rig={info.rig} nowPlaying={info.nowPlaying} />

        <p className="request-lede">
          Asking as <strong>{info.user.displayName}</strong>. Search what they have, or just say
          what you are after.
        </p>

        <div className="request-field">
          <Search size={14} className="request-field-icon" />
          <input
            className="request-input"
            placeholder="A track, or an artist"
            value={picked ? picked.title : text}
            maxLength={120}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => {
              setPicked(null);
              setText(event.target.value);
            }}
          />
          {picked ? (
            <button
              type="button"
              className="btn tiny"
              onClick={() => {
                setPicked(null);
                setText('');
              }}
            >
              CHANGE
            </button>
          ) : null}
        </div>

        {picked ? (
          <p className="request-picked">
            <Check size={12} /> In their library — the DJ can queue this with one press.
          </p>
        ) : hits && hits.length > 0 ? (
          <ul className="request-hits">
            {hits.map((track) => (
              <li key={track.mediaId}>
                <button type="button" onClick={() => setPicked(track)}>
                  <strong>{track.title}</strong>
                  <em>
                    {formatTime(track.durationMs)}
                    {track.bpm ? ` · ${track.bpm.toFixed(0)} bpm` : ''}
                  </em>
                </button>
              </li>
            ))}
          </ul>
        ) : hits && hits.length === 0 && !searching ? (
          <p className="request-none">
            Nothing in their library by that name — ask for it anyway and the DJ will see it.
          </p>
        ) : null}

        <label className="request-field-plain">
          <span>Anything to say with it?</span>
          <input
            className="request-input"
            placeholder="Optional — a dedication, or when you are hoping to hear it"
            value={note}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="site-btn is-primary request-send"
          disabled={busy || remaining <= 0 || (picked ? false : text.trim().length < 2)}
          onClick={() => void submit()}
        >
          <Send size={14} />
          {busy ? 'SENDING' : 'SEND REQUEST'}
        </button>

        {sent ? (
          <p className={`request-result ${sent.ok ? 'is-ok' : 'is-bad'}`}>{sent.message}</p>
        ) : null}

        <p className="request-note">
          {remaining > 0
            ? `${remaining} more request${remaining === 1 ? '' : 's'} before you have to wait a bit.`
            : 'That is enough for now — give the booth a chance to get through them.'}
        </p>

        {info.mine.length > 0 ? <Mine mine={info.mine} /> : null}
      </main>
    </div>
  );
}

/** What this person has already asked for, and what became of it. */
function Mine({ mine }: { mine: RequestItem[] }) {
  const said = (entry: RequestItem) => {
    if (entry.status === 'accepted') return 'queued';
    if (entry.status === 'declined') return 'not this time';
    return 'waiting';
  };

  return (
    <section className="request-mine">
      <h2>Your requests</h2>
      <ul>
        {mine.map((entry) => (
          <li key={entry.id} className={`is-${entry.status}`}>
            <span className="request-mine-track">{entry.text}</span>
            <span className="request-mine-status mono">{said(entry)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * `/request` with no rig named.
 *
 * Passes straight through when only one rig is taking requests, which is the
 * common case — somebody in one Discord server, following one link. The chooser
 * only appears for people who are in several.
 */
export function RequestRigPicker() {
  const [rigs, setRigs] = useState<RequestRigSummary[] | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/requests', { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) {
          setNeedsSignIn(true);
          return;
        }
        const body = (await res.json()) as { rigs?: RequestRigSummary[]; error?: string };
        if (!res.ok) {
          setError(body.error ?? 'Could not work out which rigs you can ask on.');
          return;
        }
        const found = body.rigs ?? [];
        if (found.length === 1) {
          window.location.replace(`/g/${found[0].slug}/request`);
          return;
        }
        setRigs(found);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  // No slug to come back to, so sign-in returns to this page and picks up where
  // it left off.
  if (needsSignIn) {
    return (
      <div className="request-page">
        <main className="request-card is-narrow">
          <img className="request-logo" src="/deckLogo.png" alt="deck" />
          <h1>Ask for a track</h1>
          <p className="request-lede">
            Sign in with Discord and you will see the decks you can ask on.
          </p>
          <a
            className="site-btn is-primary request-signin"
            href="/api/auth/login?next=%2Frequest"
          >
            Sign in with Discord
          </a>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <Boot>
        <AlertTriangle size={18} />
        <p>{error}</p>
      </Boot>
    );
  }

  if (!rigs) {
    return (
      <Boot>
        <p>loading</p>
      </Boot>
    );
  }

  return (
    <div className="request-page">
      <main className="request-card">
        <img className="request-logo" src="/deckLogo.png" alt="deck" />
        <h1>Ask for a track</h1>
        {rigs.length === 0 ? (
          <p className="request-closed">
            None of the servers you are in have a rig taking requests right now.
          </p>
        ) : (
          <ul className="request-rigs">
            {rigs.map((rig) => (
              <li key={rig.id}>
                <a href={`/g/${rig.slug}/request`}>
                  <strong>{rig.name}</strong>
                  <em className="mono">{rig.live ? 'on air' : 'off air'}</em>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
