import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import type { ClientCommands, EngineState, SessionUser, ToolsState } from '../protocol';
import type { DjClient } from '../socket';

interface ToolsPageProps {
  /** This rig's API prefix. */
  api: string;
  /** This rig's slug, for the link back to its console. */
  slug: string;
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

/* --------------------------------------------------------- channel status */

function ChannelStatus({
  tools,
  locked,
  send,
}: {
  tools: ToolsState;
  locked: boolean;
  send: DjClient['send'];
}) {
  const [text, setText] = useState(tools.channelStatusText);

  // Someone else may reword it while this page is open.
  useEffect(() => setText(tools.channelStatusText), [tools.channelStatusText]);

  const dirty = text !== tools.channelStatusText;
  const apply = () => {
    if (!dirty) return;
    void send('tools:set', { channelStatusText: text.trim() });
  };

  return (
    <>
      <div className="tool-row">
        <label className="tool-field">
          <span>Status text</span>
          <input
            className="tool-input"
            value={text}
            maxLength={120}
            placeholder="deck is in command"
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply();
            }}
          />
        </label>
        <button type="button" className="btn" disabled={locked || !dirty} onClick={apply}>
          APPLY
        </button>
      </div>

      <p className="tool-note">
        Discord shows this under the channel name in the sidebar, so the server can see the decks
        are live without opening anything. Written when the bot joins and cleared when it leaves.
        Leave it blank for the default wording. The bot needs the Set Voice Channel Status
        permission in that channel - without it the caption is skipped and the rig plays on.
      </p>
    </>
  );
}

/* ---------------------------------------------------------- announcements */

// Mirrors the server's check. That one is the one that counts; this is here so
// a typo is caught before it becomes a rejected command.
const WEBHOOK_PATTERN = /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/(v\d{1,2}\/)?webhooks\/\d+\/[\w-]+$/;

function Announce({
  tools,
  locked,
  send,
}: {
  tools: ToolsState;
  locked: boolean;
  send: DjClient['send'];
}) {
  const [url, setUrl] = useState(tools.announceWebhook);

  useEffect(() => setUrl(tools.announceWebhook), [tools.announceWebhook]);

  const trimmed = url.trim();
  const valid = trimmed === '' || WEBHOOK_PATTERN.test(trimmed);
  const dirty = trimmed !== tools.announceWebhook;

  return (
    <>
      <div className="tool-row">
        <label className="tool-field">
          <span>Discord webhook URL</span>
          <input
            className="tool-input mono"
            value={url}
            maxLength={220}
            placeholder="https://discord.com/api/webhooks/…"
            disabled={locked}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={locked || !dirty || !valid}
          onClick={() => void send('tools:set', { announceWebhook: trimmed })}
        >
          APPLY
        </button>
      </div>

      {valid ? null : (
        <p className="tool-result is-bad">
          That is not a Discord webhook URL. Make one in Channel Settings → Integrations.
        </p>
      )}

      <p className="tool-note">
        Posts the title to a text channel each time a track takes over the mix - the deck winning
        the crossfader with its fader up, not simply whatever is loaded. A track has to hold the
        room for six seconds before it counts, so a long blend announces the record that won it
        rather than both in turn. Only Discord webhook URLs are accepted, and mentions in a track
        title are never sent as pings.
      </p>
    </>
  );
}

/* -------------------------------------------------------------- timecode */

function Timecode({ tools, api }: { tools: ToolsState; api: string }) {
  // Never touch window during render - it is not always there.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const url = `${origin}${api}/timecode?key=${tools.timecodeKey}`;
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
        can read it - external systems cannot sign in with Discord - so treat it as a password.
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
        UDP, unicast only - a broadcast or multicast target is refused, since OSC is
        unauthenticated and this sends continuously. Point it at a Pure Data patch, a lighting
        desk, or anything else that speaks OSC.
      </p>
    </>
  );
}

/* -------------------------------------------------------------- requests */

/**
 * The link that goes in the voice channel.
 *
 * Both forms are shown because they are both real: the short one is what gets
 * read out, the long one is what survives being pasted somewhere that another
 * rig might also be linked.
 */
function Requests({ slug }: { slug: string }) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const short = `${origin}/${slug}/request`;

  return (
    <>
      <label className="tool-field">
        <span>Request page</span>
        <div className="tool-row">
          <input
            className="tool-input mono"
            readOnly
            value={short}
            onFocus={(event) => event.target.select()}
          />
          <CopyButton value={short} />
        </div>
      </label>

      <p className="tool-note">
        Anyone in the Discord server can open this and ask for a track - they do not need a DJ
        role, and members who have never seen the console sign in with Discord the same way you
        did. They can search what is in the library and pick a record, or just type what they are
        after; nothing they send touches the decks until somebody accepts it.
      </p>
      <p className="tool-note">
        What comes in shows up on the <strong>Requests</strong> panel. If it is not on your
        console, it is in the tray - hit ARRANGE and drag it out.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ page */

export function ToolsPage({ state, locked, send, api, slug }: ToolsPageProps) {
  const tools = state.tools;
  const set = (patch: ClientCommands['tools:set']) => void send('tools:set', patch);

  return (
    <main className="tools">
      <header className="tools-head">
        <a className="btn tiny" href={`/g/${slug}/deck`}>
          <ArrowLeft size={12} />
          BACK TO THE DECKS
        </a>
        <div>
          <h1>Tools</h1>
          <p>
            Extras for this rig. Anything that opens a port or reaches off the machine is off until
            somebody turns it on, and every setting is shared - everyone on the decks gets the same
            tools.
          </p>
        </div>
      </header>

      {locked ? (
        <p className="tools-locked">
          Take control of the decks to change these. You can still read what is switched on.
        </p>
      ) : null}

      <div className="tools-list">
        <Tool
          name="Timecode feed"
          summary="Publishes deck positions over HTTP for lighting, stream overlays and video."
          on={tools.timecode}
          locked={locked}
          onToggle={(timecode) => set({ timecode })}
        >
          <Timecode tools={tools} api={api} />
        </Tool>

        <Tool
          name="Channel status"
          summary="Captions the voice channel while the rig is in it, so the sidebar says the decks are live."
          on={tools.channelStatus}
          locked={locked}
          onToggle={(channelStatus) => set({ channelStatus })}
        >
          <ChannelStatus tools={tools} locked={locked} send={send} />
        </Tool>

        <Tool
          name="Now playing status"
          summary="Shows the current track as the playback bot's Discord activity."
          on={tools.presence}
          locked={locked}
          onToggle={(presence) => set({ presence })}
        >
          <p className="tool-note">
            The bot reads as “Listening to …” in the member list, following whatever is winning the
            crossfader. It clears when the decks fall silent. Everyone in the server can see it, so
            leave it off if the room would rather the tracklist stayed in the booth.
          </p>
        </Tool>

        <Tool
          name="Track announcements"
          summary="Posts each track to a text channel as it takes over the mix."
          on={tools.announce}
          locked={locked}
          onToggle={(announce) => set({ announce })}
        >
          <Announce tools={tools} locked={locked} send={send} />
        </Tool>

        <Tool
          name="Requests"
          summary="Opens a page where the room can ask for a track, without giving anyone the decks."
          on={tools.requests}
          locked={locked}
          onToggle={(requests) => set({ requests })}
        >
          <Requests slug={slug} />
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
