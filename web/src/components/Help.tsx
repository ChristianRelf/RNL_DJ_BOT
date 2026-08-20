import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Search, X } from 'lucide-react';
import { SitePage } from './SiteNav';

/**
 * The help centre.
 *
 * Read off the console itself - the gestures come from controls.tsx, the
 * shortcuts from App.tsx, the handover rules from control.ts, and the slash
 * commands from discord/commands.ts. Keep it in step with those.
 *
 * It is one page rather than a page per article on purpose: the whole thing is
 * a few thousand words, and a reader who can search all of it at once finds
 * their answer faster than one clicking through a tree of stubs. The filter is
 * the navigation.
 */

const EMAIL = 'hello@ronation.live';

const CATEGORIES = [
  { id: 'start', name: 'Getting started' },
  { id: 'decks', name: 'The decks' },
  { id: 'mixing', name: 'Mixing' },
  { id: 'library', name: 'Library and queue' },
  { id: 'console', name: 'Your console' },
  { id: 'tools', name: 'Tools and integrations' },
  { id: 'reference', name: 'Reference' },
  { id: 'trouble', name: 'Troubleshooting' },
] as const;

type CategoryId = (typeof CATEGORIES)[number]['id'];

interface Article {
  id: string;
  category: CategoryId;
  title: string;
  summary?: string;
  /** Everything the search should match beyond the title. */
  keywords: string;
  body: ReactNode;
}

const GESTURES = [
  ['Drag up or down', 'Move any knob or fader.'],
  ['Right-click', 'Reset a control to its default.'],
  ['Right-drag or shift-drag', 'Fine adjustment - a fifth of the normal travel.'],
  ['Scroll over a control', 'Nudge it a step at a time. Hold shift for finer steps.'],
  ['Double-click', 'Also resets, if you would rather.'],
  ['Arrow keys', 'Step a focused control. Home resets it.'],
];

const SHORTCUTS = [
  ['Q', 'Play or pause deck A'],
  ['P', 'Play or pause deck B'],
  ['1 – 8', 'Fire the sample pads'],
  ['[  ]', 'Nudge the crossfader'],
];

const COMMANDS = [
  ['/dj panel', 'Get a link to the control surface.'],
  ['/dj now', 'Show what is playing right now.'],
  ['/dj summon [channel]', 'Bring the bot into a voice channel.'],
  ['/dj leave', 'Disconnect the bot from voice.'],
];

function Table({ rows, mono }: { rows: string[][]; mono?: 'kbd' | 'code' }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <tbody>
          {rows.map(([key, what]) => (
            <tr key={key}>
              <td className="doc-key">
                {mono === 'kbd' ? <kbd>{key}</kbd> : mono === 'code' ? <code>{key}</code> : key}
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ARTICLES: Article[] = [
  {
    id: 'access',
    category: 'start',
    title: 'Getting access',
    keywords: 'waitlist access invite join sign up bot server role permission',
    body: (
      <>
        <p>
          deck is run for you - there is nothing to install and no server of yours it goes on.
          Access opens in batches, so a room joins the <a href="/home/access">waitlist</a> and we
          come back on Discord when a spot is ready.
        </p>
        <p>
          When it is, we bring the bot into your Discord server and point it at the role you
          nominate. From then on, anyone holding that role can open the booth.
        </p>
      </>
    ),
  },
  {
    id: 'signing-in',
    category: 'start',
    title: 'Signing in',
    keywords: 'login discord oauth account password role denied cannot sign in',
    body: (
      <p>
        Sign in with Discord. You need to be in the server and hold the DJ role - there is no
        separate account and no password. Once you are in you can see the whole console straight
        away, but everything is read-only until you take control.
      </p>
    ),
  },
  {
    id: 'control',
    category: 'start',
    title: 'Taking and handing over control',
    keywords: 'control lock queue handover idle timeout release take request admin force',
    body: (
      <>
        <p>
          Only one person drives at a time. Everyone else watches the same live state - faders
          moving, meters bouncing, tracks loading - so a handover is seamless.
        </p>
        <ul className="doc-list">
          <li>
            <strong>Take control</strong> when nobody has it, and you are on.
          </li>
          <li>
            <strong>Request control</strong> when somebody does. You join a queue, and they can see
            you waiting.
          </li>
          <li>
            <strong>Release</strong> when you are done, or hand it to a specific person.
          </li>
          <li>
            If the holder goes idle for three minutes <em>while somebody is waiting</em>, control
            passes automatically. With an empty queue an idle holder keeps the decks - you will
            never get bumped just for letting a long track run.
          </li>
          <li>
            Close every tab and control is held for another twenty seconds, so a refresh does not
            cost you your set.
          </li>
          <li>Admins can force-take, for when something has gone wrong.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'on-air',
    category: 'start',
    title: 'Getting on air',
    keywords: 'voice channel join go live summon listeners broadcast',
    body: (
      <p>
        Pick a voice channel from the bar at the top and the bot joins it. Everything you play from
        that point is live to whoever is in there. <code>/dj summon</code> in Discord does the same
        thing from the other side.
      </p>
    ),
  },
  {
    id: 'decks',
    category: 'decks',
    title: 'Working a deck',
    keywords: 'cue loop beat jump pitch sync tempo waveform seek scrub play pause',
    body: (
      <ul className="doc-list">
        <li>
          <strong>Cue</strong> jumps to the cue point and stops. <strong>Set cue</strong> drops it
          where the playhead is.
        </li>
        <li>
          <strong>Loops</strong> - set in and out by hand, or hit a beat division to drop a loop of
          that length from where you are. Halve and double from there.
        </li>
        <li>
          <strong>Jump</strong> moves the playhead by whole beats, so you stay on the grid. On a
          track with no tempo it falls back to seconds.
        </li>
        <li>
          <strong>Pitch</strong> runs from half to double speed, turntable style - the tempo readout
          shows what the room actually hears.
        </li>
        <li>
          <strong>Sync</strong> matches the other deck, halving or doubling if it needs to, so a
          drum track can ride alongside something half its tempo.
        </li>
      </ul>
    ),
  },
  {
    id: 'pads',
    category: 'decks',
    title: 'Sample pads',
    keywords: 'pads samples stings drops one shot loop hold gate duck pad bus',
    body: (
      <>
        <p>
          Eight slots, on their own bus, with an auto-duck that pulls the decks down underneath a
          hit. Click a pad's mode to cycle it:
        </p>
        <ul className="doc-list">
          <li>
            <strong>ONE</strong> - fires and runs to the end.
          </li>
          <li>
            <strong>LOOP</strong> - keeps going until you hit it again.
          </li>
          <li>
            <strong>HOLD</strong> - plays only while you hold it down.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'mixer',
    category: 'mixing',
    title: 'The mixer',
    keywords: 'trim mute eq isolator kill filter crossfader fader gain level',
    body: (
      <ul className="doc-list">
        <li>
          <strong>Trim</strong> sets the input level. <strong>Mute</strong> takes the channel off
          the master without moving the fader, and it survives a reconnect.
        </li>
        <li>
          <strong>EQ</strong> is a three-band isolator - a full cut is a real kill, not a dip. Click
          a band's label to kill it outright and click again to bring it back.
        </li>
        <li>
          <strong>Filter</strong> is one knob: low-pass to the left, high-pass to the right,
          bypassed in the middle.
        </li>
        <li>
          <strong>Crossfader</strong> is constant power, so the middle does not dip. The A, CTR and
          B buttons slam it.
        </li>
        <li>
          Anything moved off its default shows in orange, so you can spot a knob you left somewhere
          at a glance.
        </li>
      </ul>
    ),
  },
  {
    id: 'advanced-mixer',
    category: 'mixing',
    title: 'The advanced mixer',
    keywords:
      'pan balance mono limiter master mute width filter pad mute fx bypass master eq isolator routing crossfader curve send',
    body: (
      <>
        <p>
          A second, bigger mixer you can put on the console beside the small one - or instead of it.
          It is the same desk, with the rest of the channel exposed: three pages, so a tile holding
          it does not have to be the size of a wall.
        </p>
        <ul className="doc-list">
          <li>
            <strong>Channels</strong> adds pan and an FX send to each strip, and the master strip
            gains the effect return, the balance and a meter for both buses.
          </li>
          <li>
            <strong>Master</strong> has a three-band isolator across the whole output, a{' '}
            <strong>mono</strong> switch for club rigs and phone speakers, and a{' '}
            <strong>limiter</strong> with a gain-reduction readout. The output stage also has a
            master filter, adjustable stereo width and a master mute. Turning the limiter off
            leaves the soft clipper as the backstop - the output will colour before it stops.
          </li>
          <li>
            <strong>Routing</strong> holds the crossfader curve: fully anticlockwise is the
            constant-power blend a long mix wants, clockwise is a cut you can scratch with. The
            bus controls provide pad level and ducking, FX return, pad mute and full FX bypass.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'fx',
    category: 'mixing',
    title: 'The FX rack',
    keywords: 'echo delay reverb flanger send return wet dry beat sync tempo effects',
    body: (
      <>
        <p>
          One send effect at a time - echo, reverb or flanger - on a bus both decks feed through
          their send knobs. The send is taken post-fader, so an echo thrown at the end of a track
          rides the fade out rather than dying with it.
        </p>
        <ul className="doc-list">
          <li>
            <strong>Return</strong> is how much of the wet signal reaches the master. At zero the
            bus is silent no matter where the sends are.
          </li>
          <li>
            <strong>Time</strong> can be set in beats off whichever deck is playing - the sync
            buttons read the deck's tempo and its pitch fader, so a dotted eighth stays a dotted
            eighth after you pitch the track.
          </li>
          <li>Sweeping the time knob pitches the repeats, the way tape does. That is deliberate.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'midi',
    category: 'mixing',
    title: 'Using a MIDI controller',
    keywords: 'midi controller mapping learn pickup jump encoder web midi chrome hardware',
    body: (
      <>
        <p>
          If your browser has Web MIDI - Chrome, Edge and Opera do - you can drive the console from
          a controller. Put the MIDI tool on the console, switch it on, pick a control and move the
          thing on your hardware.
        </p>
        <ul className="doc-list">
          <li>
            <strong>Pickup</strong> waits until the hardware passes where the console already is
            before it takes over, so a fader that is not where the software is will not slam.
            <strong> Jump</strong> follows immediately, and <strong>encoder</strong> is for endless
            knobs that send steps rather than positions.
          </li>
          <li>
            A mapped control sends exactly what the on-screen one sends, so the control lock still
            applies: no control, no MIDI.
          </li>
          <li>
            Mappings live in this browser, the same as your layout. They keep working whether or not
            the MIDI tool is on the console.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'uploads',
    category: 'library',
    title: 'Uploading and loading cloud tracks',
    keywords: 'files mp3 wav flac cloud cdn cache tags bpm rename',
    body: (
      <>
        <p>
          Upload files from the Deck Cloud panel. They go directly to object storage rather than
          through the Deck server, and a playback copy is cached in the browser automatically.
          Use Deck Cloud tracks to search, queue or drag a track onto a deck or sample pad.
        </p>
        <p>
          The Droplet does not retain audio files. Keep the hosting tab open while the room is using
          its playback cache; another operator can cache the same track from Deck Cloud later.
        </p>
      </>
    ),
  },
  {
    id: 'queue',
    category: 'library',
    title: 'The queue',
    keywords: 'queue requests auto advance next track load order shared playlist',
    body: (
      <>
        <p>
          Put the <strong>Queue</strong> tool on the console and you have a shared list of what is
          coming. Drag tracks into it from the pool, or hit the queue button on any row.
        </p>
        <ul className="doc-list">
          <li>
            <strong>Anyone signed in can add to it</strong>, with or without the decks. Lining a
            track up does not change what the room is hearing, so it does not need the lock - which
            is the point of a shared queue.
          </li>
          <li>
            Your own entries are yours to pull back off. Reordering, clearing, or removing somebody
            else's needs control.
          </li>
          <li>
            <strong>Load A</strong> and <strong>Load B</strong> take the track at the top and put it
            on that deck, ready to mix in.
          </li>
          <li>
            <strong>Auto</strong> loads and plays the next one whenever a deck runs out. Off by
            default - a deck going quiet is sometimes exactly what you meant.
          </li>
          <li>
            An entry whose track has been deleted from the pool is skipped rather than jamming the
            queue behind it.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'hosting-library',
    category: 'library',
    title: 'Hosting the Deck Cloud playback cache',
    summary: 'How cloud tracks reach the live mixer without being stored on the Droplet.',
    keywords: 'host cloud cdn browser cache opfs source offline missing tracks',
    body: (
      <>
        <p>
          Deck Cloud is the shared source library. When an operator uploads or caches a track, the
          browser prepares a private playback copy and serves only the short pieces the live mixer
          requests. The Droplet mixes those pieces but does not retain the source file.
        </p>
        <h4>Start hosting</h4>
        <ol className="doc-steps">
          <li>Open <strong>Deck Cloud</strong> and upload music, or cache an existing cloud track.</li>
          <li>Wait for the browser to prepare the playback cache.</li>
          <li>Drag the track from <strong>Deck Cloud tracks</strong> onto a deck.</li>
          <li>Leave the console tab open while this browser is hosting playback.</li>
        </ol>
        <div className="doc-callout">
          <strong>Important:</strong> the host is part of the audio path. If the host closes every
          console tab or loses connectivity, the mixer can no longer request new audio. Buffered
          audio plays briefly, then the decks pause rather than skipping through the track.
        </div>
        <p>Cached tracks remain in private browser storage until the browser clears site data.</p>
      </>
    ),
  },
  {
    id: 'requests',
    category: 'library',
    title: 'Opening and managing track requests',
    summary: 'Give members a request page without giving them control of the booth.',
    keywords: 'requests request page accept decline room member public link queue tools rate limit duplicate',
    body: (
      <>
        <p>
          Requests are separate from the operator queue. A member can ask for a track, but the
          request cannot load a deck or change what the room hears. An operator must accept it
          before it enters the queue.
        </p>
        <h4>Open requests</h4>
        <ol className="doc-steps">
          <li>Open the rig&rsquo;s <strong>Tools</strong> page while you hold control.</li>
          <li>Switch on <strong>Requests</strong>.</li>
          <li>Copy the request-page URL and share it with members of the Discord server.</li>
          <li>Add the <strong>Requests</strong> panel from the arrange tray if it is not already visible.</li>
        </ol>
        <h4>Handle an incoming request</h4>
        <ul className="doc-list">
          <li><strong>Accept</strong> adds the track to the shared queue and credits the requester.</li>
          <li><strong>Play next</strong> accepts it at the front of the queue.</li>
          <li><strong>Decline</strong> marks it handled without changing the queue.</li>
          <li><strong>Clear handled</strong> removes old accepted and declined entries; pending requests remain.</li>
        </ul>
        <p>
          Requesters sign in with Discord and must belong to the rig&rsquo;s server, but they do not
          need the DJ role. The service limits repeated submissions and refuses duplicates so the
          panel remains usable during busy events.
        </p>
      </>
    ),
  },
  {
    id: 'prepare-a-set',
    category: 'library',
    title: 'Preparing a set before going live',
    summary: 'A practical pre-flight workflow for checking tracks, cue points and output levels.',
    keywords: 'prepare set workflow soundcheck preflight cue bpm analyse levels gain staging queue',
    body: (
      <>
        <p>Prepare the booth before the bot joins voice. Deck positions and library work remain available while off air.</p>
        <ol className="doc-steps">
          <li>Connect or upload the library and wait for the tracks you need to finish analysing.</li>
          <li>Use pre-listen to verify each file and confirm its title, tempo and tags.</li>
          <li>Load an opening track on deck A and set its first cue point.</li>
          <li>Load a second track on deck B, check the beat grid and practise the transition.</li>
          <li>Reset EQ, filters, effects sends and trims; controls away from default are highlighted.</li>
          <li>Build the first part of the queue and confirm auto-advance is in the state you expect.</li>
          <li>Join the voice channel, play a short soundcheck and watch the master meter for clipping.</li>
        </ol>
        <div className="doc-callout">
          Keep the limiter enabled for ordinary operation, but do not use it to compensate for
          consistently excessive trim or master gain. A limiter protects peaks; it is not a gain-staging strategy.
        </div>
      </>
    ),
  },
  {
    id: 'arranging',
    category: 'console',
    title: 'Arranging the console',
    keywords: 'layout grid arrange drag resize tools presets tidy fit panels move',
    body: (
      <>
        <p>
          The console is a twelve-column grid and every tool sits in a cell of it. Hit{' '}
          <strong>arrange</strong> in the top bar to move things about - the rig keeps playing while
          you do.
        </p>
        <ul className="doc-list">
          <li>
            Drag a tool by the handle in its header to move it; drag its right or bottom edge, or
            the corner, to size it. Everything snaps to the grid, and a guide line appears wherever
            an edge lines up with a neighbour.
          </li>
          <li>
            Nothing can sit on top of anything else: whatever you drop onto gets pushed down.{' '}
            <strong>Tidy</strong> pulls everything back up into the gaps afterwards.
          </li>
          <li>
            Tools not on the console wait in the tray at the top. Drag one onto a cell, or click it
            to drop it in the first space that fits.
          </li>
          <li>
            A panel taller than its tile scrolls rather than being cut off, and the fit button in
            its header sizes the tile to it exactly.
          </li>
          <li>
            Your arrangement is yours: it lives in this browser and never reaches the rig, so tidying
            up mid-set does not move anyone else's furniture.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'timecode',
    category: 'tools',
    title: 'Using the timecode feed',
    summary: 'Read deck positions and mixer state from an authenticated HTTP endpoint.',
    keywords: 'timecode http feed overlay lighting video key url security poll tools',
    body: (
      <>
        <p>
          The timecode tool publishes a small HTTP response for overlays, lighting controllers and
          other systems that need to follow the booth. It includes deck position, title, tempo and
          crossfader state.
        </p>
        <ol className="doc-steps">
          <li>Take control and open the rig&rsquo;s <strong>Tools</strong> page.</li>
          <li>Enable <strong>Timecode feed</strong> and copy the generated URL.</li>
          <li>Configure the receiving system to poll that URL at a sensible interval.</li>
          <li>Test deck A, deck B and the crossfader before using the data in a live production.</li>
        </ol>
        <div className="doc-callout">
          The key in the URL is the credential. Do not publish it in a public repository or browser
          overlay template. Switching the tool off and on issues a new key and invalidates the old URL.
        </div>
      </>
    ),
  },
  {
    id: 'osc-output',
    category: 'tools',
    title: 'Connecting OSC output',
    summary: 'Send live deck and mixer values to lighting, visuals or a Pure Data patch.',
    keywords: 'osc udp output host port pure data lighting vj multicast broadcast firewall tools',
    body: (
      <>
        <p>
          OSC output sends deck and mixer state ten times per second over UDP. It is intended for a
          known unicast destination such as a lighting computer, VJ workstation or Pure Data patch.
        </p>
        <ol className="doc-steps">
          <li>Start the OSC receiver and note its IP address or hostname and UDP port.</li>
          <li>Enter those values under <strong>OSC output</strong> on the Tools page.</li>
          <li>Apply the destination, then enable the tool.</li>
          <li>Move a fader and confirm the receiver sees addresses such as <code>/mixer/crossfader</code>.</li>
        </ol>
        <p>
          Broadcast and multicast destinations are refused. OSC has no built-in authentication, so
          the sender only accepts an ordinary unicast target. If no packets arrive, check the
          receiver is bound to the configured port and that its firewall permits inbound UDP.
        </p>
      </>
    ),
  },
  {
    id: 'now-playing',
    category: 'tools',
    title: 'Publishing now-playing information',
    summary: 'Show the active track in Discord presence, a voice-channel caption or a webhook post.',
    keywords: 'now playing presence channel status webhook announcements discord track title tools',
    body: (
      <>
        <p>deck can publish the current programme in three different places. Each option is independent.</p>
        <ul className="doc-list">
          <li><strong>Channel status</strong> adds a short caption beneath the Discord voice channel while the bot is connected.</li>
          <li><strong>Now playing status</strong> uses the playback bot&rsquo;s Discord activity.</li>
          <li><strong>Track announcements</strong> posts through a Discord webhook when a track takes over the mix.</li>
        </ul>
        <p>
          The active track is based on the audible mix, not simply the most recently loaded deck. A
          track must hold the room for several seconds before an announcement is sent, which avoids
          duplicate posts during a blend. Track titles are sent without allowing Discord mentions.
        </p>
      </>
    ),
  },
  {
    id: 'gestures',
    category: 'reference',
    title: 'Every control works the same way',
    keywords: 'gestures drag scroll reset fine shift right click double click arrow keys',
    body: <Table rows={GESTURES} />,
  },
  {
    id: 'keyboard',
    category: 'reference',
    title: 'Keyboard shortcuts',
    keywords: 'keyboard shortcuts keys hotkeys play pause pads crossfade',
    body: <Table rows={SHORTCUTS} mono="kbd" />,
  },
  {
    id: 'discord',
    category: 'reference',
    title: 'Slash commands',
    keywords: 'discord slash commands dj panel now summon leave',
    body: <Table rows={COMMANDS} mono="code" />,
  },
  {
    id: 'no-sound',
    category: 'trouble',
    title: 'Nobody can hear anything',
    keywords: 'no sound silent nothing playing quiet cannot hear muted troubleshooting',
    body: (
      <ul className="doc-list">
        <li>
          Check the bot is actually in a voice channel - the bar at the top says{' '}
          <strong>on air</strong> and names the channel when it is.
        </li>
        <li>
          Check the channel fader and the crossfader. A deck fully crossfaded away is silent however
          loud it is.
        </li>
        <li>
          Check the channel is not muted, and that no EQ band is killed - a killed band shows in
          orange with its label lit.
        </li>
        <li>
          Check Discord itself: the bot can be server-muted, or your own client can have it muted in
          the user list.
        </li>
      </ul>
    ),
  },
  {
    id: 'no-control',
    category: 'trouble',
    title: 'Everything is greyed out',
    keywords: 'read only locked cannot touch greyed disabled view only control',
    body: (
      <p>
        Somebody else has the decks, so the console is read-only for you - that is the lock doing its
        job. <strong>Request control</strong> and they will see you waiting; if they go idle for
        three minutes it passes to you automatically. Queueing tracks still works while you wait.
      </p>
    ),
  },
  {
    id: 'upload-failed',
    category: 'trouble',
    title: 'An upload failed or is stuck decoding',
    keywords: 'upload failed error decoding processing stuck format size limit',
    body: (
      <p>
        Every upload is decoded once on the way in, and a file that will not decode shows as{' '}
        <strong>failed</strong> in the pool with the reason. Most often it is a format that is not
        really audio - a video container, or a file that did not finish downloading. Re-export it as
        MP3, WAV or FLAC and try again. If it says <strong>decoding</strong> for more than a minute
        or two on a normal-length track, tell us.
      </p>
    ),
  },
  {
    id: 'midi-missing',
    category: 'trouble',
    title: 'My controller does not show up',
    keywords: 'midi not working controller missing browser safari firefox permission',
    body: (
      <ul className="doc-list">
        <li>
          Web MIDI only exists in Chrome, Edge and Opera. Safari and Firefox will not list a
          controller at all, and the MIDI tool says so rather than pretending to look.
        </li>
        <li>
          The browser asks permission the first time. If you refused it, you will need to allow MIDI
          for this site in your browser's site settings.
        </li>
        <li>
          Anything else using the controller exclusively - another DJ application, a DAW - can hold
          the port open. Close it and hit refresh in the MIDI tool.
        </li>
      </ul>
    ),
  },
  {
    id: 'layout-broken',
    category: 'trouble',
    title: 'My console layout looks wrong',
    keywords: 'layout broken reset default arrangement grid narrow phone stacked',
    body: (
      <p>
        Open <strong>arrange</strong> and hit <strong>reset</strong> - that puts the default console
        back without touching anything anyone else sees. On a narrow screen the grid stacks into one
        column on purpose and arranging is switched off, because a twelve-column arrangement on a
        phone would be a lie.
      </p>
    ),
  },
];

export function Help() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [selectedId, setSelectedId] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('article');
  });

  useEffect(() => {
    const onPopState = () => setSelectedId(new URLSearchParams(window.location.search).get('article'));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openArticle = (id: string | null) => {
    const url = id ? `/home/help?article=${encodeURIComponent(id)}` : '/home/help';
    window.history.pushState({}, '', url);
    setSelectedId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selected = ARTICLES.find((article) => article.id === selectedId) ?? null;
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ARTICLES.filter((article) => {
      if (category !== 'all' && article.category !== category) return false;
      if (!needle) return true;
      const name = CATEGORIES.find((c) => c.id === article.category)?.name ?? '';
      return `${article.title} ${article.keywords} ${article.summary ?? ''} ${name}`.toLowerCase().includes(needle);
    });
  }, [category, query]);

  if (selected) {
    const categoryName = CATEGORIES.find((entry) => entry.id === selected.category)?.name ?? 'Help centre';
    const related = ARTICLES.filter(
      (article) => article.category === selected.category && article.id !== selected.id,
    ).slice(0, 4);

    return (
      <SitePage current="/home/help">
        <button type="button" className="help-back" onClick={() => openArticle(null)}>
          <ArrowLeft size={14} /> All articles
        </button>
        <article className="help-reader">
          <header className="help-reader-head">
            <span className="site-eyebrow">{categoryName}</span>
            <h1>{selected.title}</h1>
            {selected.summary ? <p>{selected.summary}</p> : null}
          </header>
          <div className="help-reader-body">{selected.body}</div>
        </article>

        {related.length > 0 ? (
          <aside className="help-related" aria-label="Related articles">
            <h2>Related articles</h2>
            <div className="help-related-grid">
              {related.map((article) => (
                <button type="button" key={article.id} onClick={() => openArticle(article.id)}>
                  <span>{article.title}</span><ArrowRight size={13} />
                </button>
              ))}
            </div>
          </aside>
        ) : null}

        <section className="doc-next">
          <p>
            Still stuck? <a href={`mailto:${EMAIL}?subject=deck%20-%20help`}>Email us</a> with the
            rig name, browser and what happened immediately before the problem.
          </p>
        </section>
      </SitePage>
    );
  }

  // Only the categories with something in them, so the filter never offers a
  // heading that leads to an empty page.
  const groups = CATEGORIES.map((entry) => ({
    ...entry,
    articles: results.filter((article) => article.category === entry.id),
  })).filter((group) => group.articles.length > 0);

  return (
    <SitePage current="/home/help">
      <header className="doc-head">
        <h1>Help centre</h1>
        <p>
          Guides for setting up the booth, running a set and solving common problems. Search the
          library or browse by topic.
        </p>
      </header>

      <div className="help-overview">
        <span><BookOpen size={14} /><strong>{ARTICLES.length}</strong> articles</span>
        <span><strong>{CATEGORIES.length}</strong> topics</span>
      </div>

      <div className="help-search">
        <Search size={15} />
        <input
          className="help-input"
          value={query}
          placeholder="Search the help centre"
          aria-label="Search the help centre"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button type="button" className="help-clear" aria-label="Clear search" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className="help-filters" role="group" aria-label="Filter by topic">
        <button
          type="button"
          className={`help-chip ${category === 'all' ? 'is-on' : ''}`}
          aria-pressed={category === 'all'}
          onClick={() => setCategory('all')}
        >
          Everything
        </button>
        {CATEGORIES.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={`help-chip ${category === entry.id ? 'is-on' : ''}`}
            aria-pressed={category === entry.id}
            onClick={() => setCategory(entry.id)}
          >
            {entry.name}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <p className="help-empty">
          Nothing here matches “{query}”. Try a different word, or{' '}
          <a href={`mailto:${EMAIL}?subject=deck%20-%20help`}>ask us</a> - a question nobody can
          find the answer to is our problem, not yours.
        </p>
      ) : (
        groups.map((group) => (
          <section className="help-group" key={group.id}>
            <h2 className="help-group-title">{group.name}</h2>
            <div className="help-article-grid">
              {group.articles.map((article) => (
                <button className="help-article-card" type="button" id={article.id} key={article.id} onClick={() => openArticle(article.id)}>
                  <span>
                    <strong>{article.title}</strong>
                    <small>{article.summary ?? 'Open the complete guide and operating notes.'}</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      <section className="doc-next">
        <p>
          Still stuck? <a href={`mailto:${EMAIL}?subject=deck%20-%20help`}>Email us</a> and say what
          you were doing when it went wrong - that is usually enough to spot it.
        </p>
      </section>
    </SitePage>
  );
}
