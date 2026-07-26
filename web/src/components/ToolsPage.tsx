import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Download } from 'lucide-react';
import { BotsPanel } from './BotsPanel';
import { WaitlistPanel } from './WaitlistPanel';
import type { ClientCommands, EngineState, SessionUser, ToolsState } from '../protocol';
import type { DjClient } from '../socket';

interface ToolsPageProps {
  state: EngineState;
  user: SessionUser;
  locked: boolean;
  send: DjClient['send'];
}

/** Switch for a whole tool. Reads as a switch rather than a checkbox on purpose. */
function Toggle({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? 'is-on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-track">
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="btn tiny"
      title="Copy to clipboard"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}

function Tool({
  name,
  summary,
  on,
  locked,
  onToggle,
  children,
}: {
  name: string;
  summary: string;
  on: boolean;
  locked: boolean;
  onToggle: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className={`tool ${on ? 'is-on' : ''}`}>
      <header className="tool-head">
        <div className="tool-heading">
          <h2>{name}</h2>
          <p>{summary}</p>
        </div>
        <Toggle on={on} disabled={locked} label={name} onChange={onToggle} />
      </header>
      {on && children ? <div className="tool-body">{children}</div> : null}
    </section>
  );
}

/* ------------------------------------------------------------ url import */

function UrlImport({ enabled }: { enabled: boolean }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = async () => {
    const link = url.trim();
    if (!link || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/media/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: link }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult({ ok: true, message: `Added "${body.media?.title ?? 'the file'}" to the pool.` });
        setUrl('');
      } else {
        setResult({ ok: false, message: body.error ?? `Import failed (${res.status}).` });
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tool-row">
        <input
          className="tool-input"
          placeholder="https://example.com/promo/track.wav"
          value={url}
          disabled={!enabled || busy}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!enabled || busy || !url.trim()}
          onClick={() => void submit()}
        >
          <Download size={13} />
          {busy ? 'FETCHING' : 'IMPORT'}
        </button>
      </div>

      {result ? (
        <p className={`tool-result ${result.ok ? 'is-ok' : 'is-bad'}`}>{result.message}</p>
      ) : null}

      <p className="tool-note">
        Fetches a direct link to an audio file — a promo pool download, your own storage, a
        royalty-free library. It is not a media-site extractor: links that serve a web page rather
        than a file will be refused, as will anything pointing back at your own network.
      </p>
    </>
  );
}

/* -------------------------------------------------------------- timecode */

function Timecode({ tools }: { tools: ToolsState }) {
  // Never touch window during render — it is not always there.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const url = `${origin}/api/timecode?key=${tools.timecodeKey}`;
  return (
    <>
      <label className="tool-field">
        <span>Feed URL</span>
        <div className="tool-row">
          <input className="tool-input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
          <CopyButton value={url} />
        </div>
      </label>
      <p className="tool-note">
        Poll this for deck positions, titles, tempo and crossfader position. Whoever holds the URL
        can read it — external systems cannot sign in with Discord — so treat it as a password.
        Switching the tool off and on again issues a new key and kills the old one.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------- osc */

const OSC_ADDRESSES = [
  '/deck/{a,b}/position',
  '/deck/{a,b}/duration',
  '/deck/{a,b}/playing',
  '/deck/{a,b}/bpm',
  '/deck/{a,b}/gain',
  '/deck/{a,b}/title',
  '/mixer/crossfader',
  '/mixer/master',
];

function Osc({
  tools,
  locked,
  send,
}: {
  tools: ToolsState;
  locked: boolean;
  send: DjClient['send'];
}) {
  const [host, setHost] = useState(tools.oscHost);
  const [port, setPort] = useState(String(tools.oscPort));

  // Someone else may repoint it while this page is open.
  useEffect(() => setHost(tools.oscHost), [tools.oscHost]);
  useEffect(() => setPort(String(tools.oscPort)), [tools.oscPort]);

  const dirty = host !== tools.oscHost || port !== String(tools.oscPort);

  const apply = () => {
    const parsed = Number(port);
    if (!host.trim() || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return;
    void send('tools:set', { oscHost: host.trim(), oscPort: parsed });
  };

  return (
    <>
      <div className="tool-row">
        <label className="tool-field">
          <span>Host</span>
          <input
            className="tool-input mono"
            value={host}
            disabled={locked}
            onChange={(event) => setHost(event.target.value)}
          />
        </label>
        <label className="tool-field tool-field-port">
          <span>Port</span>
          <input
            className="tool-input mono"
            value={port}
            inputMode="numeric"
            disabled={locked}
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
        <button type="button" className="btn" disabled={locked || !dirty} onClick={apply}>
          APPLY
        </button>
      </div>

      <div className="osc-addresses">
        <span className="tool-label-sm">Sent 10× a second</span>
        <ul>
          {OSC_ADDRESSES.map((address) => (
            <li key={address} className="mono">
              {address}
            </li>
          ))}
        </ul>
      </div>

      <p className="tool-note">
        UDP, unicast only — a broadcast or multicast target is refused, since OSC is
        unauthenticated and this sends continuously. Point it at a Pure Data patch, a lighting
        desk, or anything else that speaks OSC.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ page */

export function ToolsPage({ state, user, locked, send }: ToolsPageProps) {
  const tools = state.tools;
  const set = (patch: ClientCommands['tools:set']) => void send('tools:set', patch);

  return (
    <main className="tools">
      <header className="tools-head">
        <a className="btn tiny" href="/deck">
          <ArrowLeft size={12} />
          BACK TO THE DECKS
        </a>
        <div>
          <h1>Tools</h1>
          <p>
            Extras for this rig. Each one is off until somebody turns it on, and the setting is
            shared — everyone on the decks gets the same tools.
          </p>
        </div>
      </header>

      {locked ? (
        <p className="tools-locked">
          Take control of the decks to change these. You can still read what is switched on.
        </p>
      ) : null}

      <div className="tools-list">
        {user.isOwner ? (
          <>
            <BotsPanel user={user} live={state.bot} voiceLive={state.voice.status === 'ready'} />
            <WaitlistPanel />
          </>
        ) : null}

        <Tool
          name="Timecode feed"
          summary="Publishes deck positions over HTTP for lighting, stream overlays and video."
          on={tools.timecode}
          locked={locked}
          onToggle={(timecode) => set({ timecode })}
        >
          <Timecode tools={tools} />
        </Tool>

        <Tool
          name="Import from URL"
          summary="Pulls a direct audio link straight into the media pool."
          on={tools.urlImport}
          locked={locked}
          onToggle={(urlImport) => set({ urlImport })}
        >
          <UrlImport enabled={tools.urlImport} />
        </Tool>

        <Tool
          name="OSC output"
          summary="Streams deck and mixer state over UDP to Pure Data, a lighting desk, or any OSC listener."
          on={tools.osc}
          locked={locked}
          onToggle={(osc) => set({ osc })}
        >
          <Osc tools={tools} locked={locked} send={send} />
        </Tool>
      </div>
    </main>
  );
}
