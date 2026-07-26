import { useMemo, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { SitePage } from './SiteNav';

/**
 * The help centre.
 *
 * Read off the console itself — the gestures come from controls.tsx, the
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
  { id: 'reference', name: 'Reference' },
  { id: 'trouble', name: 'Troubleshooting' },
] as const;

type CategoryId = (typeof CATEGORIES)[number]['id'];

interface Article {
  id: string;
  category: CategoryId;
  title: string;
  /** Everything the search should match beyond the title. */
  keywords: string;
  body: ReactNode;
}

const GESTURES = [
  ['Drag up or down', 'Move any knob or fader.'],
  ['Right-click', 'Reset a control to its default.'],
  ['Right-drag or shift-drag', 'Fine adjustment — a fifth of the normal travel.'],
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
          deck is run for you — there is nothing to install and no server of yours it goes on.
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
        Sign in with Discord. You need to be in the server and hold the DJ role — there is no
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
          Only one person drives at a time. Everyone else watches the same live state — faders
          moving, meters bouncing, tracks loading — so a handover is seamless.
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
            passes automatically. With an empty queue an idle holder keeps the decks — you will
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
          <strong>Loops</strong> — set in and out by hand, or hit a beat division to drop a loop of
          that length from where you are. Halve and double from there.
        </li>
        <li>
          <strong>Jump</strong> moves the playhead by whole beats, so you stay on the grid. On a
          track with no tempo it falls back to seconds.
        </li>
        <li>
          <strong>Pitch</strong> runs from half to double speed, turntable style — the tempo readout
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
            <strong>ONE</strong> — fires and runs to the end.
          </li>
          <li>
            <strong>LOOP</strong> — keeps going until you hit it again.
          </li>
          <li>
            <strong>HOLD</strong> — plays only while you hold it down.
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
          <strong>EQ</strong> is a three-band isolator — a full cut is a real kill, not a dip. Click
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
    keywords: 'pan balance mono limiter master eq isolator routing crossfader curve send',
    body: (
      <>
        <p>
          A second, bigger mixer you can put on the console beside the small one — or instead of it.
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
            <strong>limiter</strong> with a gain-reduction readout. Turning the limiter off leaves
            the soft clipper as the backstop — the output will colour before it stops.
          </li>
          <li>
            <strong>Routing</strong> holds the crossfader curve: fully anticlockwise is the
            constant-power blend a long mix wants, clockwise is a cut you can scratch with.
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
          One send effect at a time — echo, reverb or flanger — on a bus both decks feed through
          their send knobs. The send is taken post-fader, so an echo thrown at the end of a track
          rides the fade out rather than dying with it.
        </p>
        <ul className="doc-list">
          <li>
            <strong>Return</strong> is how much of the wet signal reaches the master. At zero the
            bus is silent no matter where the sends are.
          </li>
          <li>
            <strong>Time</strong> can be set in beats off whichever deck is playing — the sync
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
          If your browser has Web MIDI — Chrome, Edge and Opera do — you can drive the console from
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
    title: 'Loading and uploading tracks',
    keywords: 'upload files mp3 wav flac drag drop pre-listen headphone audition tags bpm rename',
    body: (
      <>
        <p>
          Drag files onto the media pool to upload them. Waveforms and tempo are worked out for you
          while you carry on. From there, drag a track onto a deck or a sample pad.
        </p>
        <p>
          The headphone button pre-listens <strong>in your own browser only</strong>. It never goes
          to air, so you can audition something mid-set.
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
            track up does not change what the room is hearing, so it does not need the lock — which
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
            default — a deck going quiet is sometimes exactly what you meant.
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
    id: 'arranging',
    category: 'console',
    title: 'Arranging the console',
    keywords: 'layout grid arrange drag resize tools presets tidy fit panels move',
    body: (
      <>
        <p>
          The console is a twelve-column grid and every tool sits in a cell of it. Hit{' '}
          <strong>arrange</strong> in the top bar to move things about — the rig keeps playing while
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
          Check the bot is actually in a voice channel — the bar at the top says{' '}
          <strong>on air</strong> and names the channel when it is.
        </li>
        <li>
          Check the channel fader and the crossfader. A deck fully crossfaded away is silent however
          loud it is.
        </li>
        <li>
          Check the channel is not muted, and that no EQ band is killed — a killed band shows in
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
        Somebody else has the decks, so the console is read-only for you — that is the lock doing its
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
        really audio — a video container, or a file that did not finish downloading. Re-export it as
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
          Anything else using the controller exclusively — another DJ application, a DAW — can hold
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
        Open <strong>arrange</strong> and hit <strong>reset</strong> — that puts the default console
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

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ARTICLES.filter((article) => {
      if (category !== 'all' && article.category !== category) return false;
      if (!needle) return true;
      const name = CATEGORIES.find((c) => c.id === article.category)?.name ?? '';
      return `${article.title} ${article.keywords} ${name}`.toLowerCase().includes(needle);
    });
  }, [category, query]);

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
          Everything the booth does, and what to do when it does not. Search it, or pick a heading —
          if the answer is not here, we would rather you asked than guessed.
        </p>
      </header>

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
          <a href={`mailto:${EMAIL}?subject=deck%20—%20help`}>ask us</a> — a question nobody can
          find the answer to is our problem, not yours.
        </p>
      ) : (
        groups.map((group) => (
          <section className="help-group" key={group.id}>
            <h2 className="help-group-title">{group.name}</h2>
            {group.articles.map((article) => (
              <article className="help-article" id={article.id} key={article.id}>
                <h3>{article.title}</h3>
                {article.body}
              </article>
            ))}
          </section>
        ))
      )}

      <section className="doc-next">
        <p>
          Still stuck? <a href={`mailto:${EMAIL}?subject=deck%20—%20help`}>Email us</a> and say what
          you were doing when it went wrong — that is usually enough to spot it.
        </p>
      </section>
    </SitePage>
  );
}
