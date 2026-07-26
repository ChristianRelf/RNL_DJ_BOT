import { useEffect, useRef } from 'react';
import { ConsolePreview } from './ConsolePreview';
import { SitePage } from './SiteNav';
import { Backdrop } from './landing/Backdrop';
import { Crossfade, type Contrast } from './landing/Crossfade';
import { Cue, Mix } from './landing/Mix';
import { PadPlay } from './landing/PadPlay';
import { BEAT_S, useReducedMotion } from './landing/beat';

/**
 * The product pitch, at /home. The front door is the sign-in page; this is
 * where "find out more" leads. Access and the waitlist live on /home/access.
 *
 * The page is one track. The whole set is drawn as a waveform down the left,
 * the full height of the document; a playhead sits fixed at 40% of the window;
 * and every block of copy is a cue point that goes live as it crosses the head.
 * There are no sections and no cards — thirteen cues with identical anatomy,
 * one transport across the bottom, and one shader behind the lot, all driven by
 * the same scroll position. See landing/Mix.tsx, which is the whole mechanism.
 *
 * Two of the cues are the product rather than a description of it: the
 * difference between a music bot and a booth is made on a crossfader you drag,
 * and the sample pads are eight pads you can hit. Anything the page can hand
 * you, it hands you.
 *
 * Every claim is something the software actually does, and every number is a
 * shipped default — if a feature or a default changes, change it here too. No
 * invented pricing, no invented adoption, nothing that needs a footnote.
 */

const SPECS = [
  { value: '2', label: 'decks' },
  { value: '8', label: 'sample pads' },
  { value: '3', label: 'band kill EQ' },
  { value: '48k', label: 'stereo Opus' },
];

/** The category distinction the whole product rests on. */
const CONTRAST: readonly Contrast[] = [
  {
    them: 'Music bots queue links.',
    us: 'deck mixes records.',
    body: 'Beatmatch, ride the crossfader, kill the bass on the way in, drop a four-beat loop and hold it. Two decks and a real isolator, not a playlist with a skip button.',
  },
  {
    them: 'Music bots take requests.',
    us: 'deck gives your crew a booth.',
    body: 'One person on the decks at a time, with a queue for who plays next and automatic handover when someone goes idle. Everyone else watches the meters move in real time.',
  },
  {
    them: 'Music bots make you their product.',
    us: 'deck is a booth we run for you.',
    body: 'No install, no server to keep alive, no tokens to rotate. Your library stays in your room and is never pooled with anyone else’s, and nothing about your set is recorded or reported.',
  },
];

/** One cue each. Six modules of the booth, in the order you meet them. */
const MODULES = [
  {
    id: 'decks',
    n: '03',
    label: 'The decks',
    statement: 'Mix like you mean it',
    lede: 'Everything you would reach for on a real controller, in a browser tab. Load a track, find the one, and work it.',
    points: [
      'Two decks with waveform scrubbing and cue points',
      'Beat-locked loops, beat jumps and loop rolls',
      'Pitch fader with one-press tempo matching and tap tempo',
      'Three-band EQ that kills properly, plus a sweepable filter',
      'Crossfader that runs from a constant-power blend to a hard cut',
    ],
  },
  {
    id: 'desk',
    n: '04',
    label: 'The desk',
    statement: 'A mixer with the rest of it',
    lede: 'The compact strip is what you reach for mid-mix. The advanced desk is everything behind it, on its own panel.',
    points: [
      'Per-channel pan, mute and a post-fader effects send',
      'Send effects: tape echo, reverb and flanger, timed in beats',
      'Master isolator, left–right balance and a mono fold-down',
      'Brickwall limiter with gain-reduction metering',
      'Map a MIDI controller onto any of it, with fader pickup',
    ],
  },
  {
    id: 'crew',
    n: '05',
    label: 'The crew',
    statement: 'Hand the booth around',
    lede: 'Built for a group from the start, so nobody is passing a laptop or arguing about who is in charge.',
    points: [
      'One operator at a time, with a request queue',
      'Hands over automatically if you idle while someone waits',
      'Live presence — see who is in and who is playing',
      'Access gated on the Discord roles you already use',
      'Everyone else watches the console live, read-only',
    ],
  },
  {
    id: 'library',
    n: '06',
    label: 'The library',
    statement: 'Drop files in and play',
    lede: 'Uploads are decoded once, on the way in. No tagging session before you can start a set.',
    points: [
      'Waveforms and tempo read on upload',
      'Search, tag and rename in place',
      'Pre-listen in your own browser, off air',
      'A shared queue anyone can add to, decks or no decks',
      'Auto-advance picks up the next track when a deck runs out',
    ],
  },
  {
    id: 'console',
    n: '07',
    label: 'The console',
    statement: 'Arrange it how you play',
    lede: 'The booth is a grid of tools you place yourself. Your layout is yours — it never moves anyone else’s.',
    points: [
      'Drag tools in, drag them to size, snapped to a twelve-column grid',
      'Nothing overlaps: what you drop onto gets pushed out of the way',
      'Presets for a full console, a laptop, a booth monitor or a library day',
      'Panels scroll rather than crop, and fit to their contents on request',
      'Saved in your browser, per person, never on the server',
    ],
  },
  {
    id: 'wiring',
    n: '08',
    label: 'The wiring',
    statement: 'Fit it into the rest of the show',
    lede: 'The booth does not have to be an island. Switch on what you need from the tools page.',
    points: [
      'Timecode feed over HTTP for overlays and lighting',
      'OSC output to Pure Data, a lighting desk or a VJ rig',
      'Import straight from a promo-pool download link',
      'Upgrades land without you doing anything',
      'Every tool off by default, and shared across the crew',
    ],
  },
];

const AUDIENCE = [
  {
    title: 'Community servers',
    body: 'Listening parties, movie nights and the Friday set — without one person screen-sharing a browser tab at everyone.',
  },
  {
    title: 'Internet radio',
    body: 'A rotating roster of DJs with scheduled shows, all working the same booth and handing over cleanly between sets.',
  },
  {
    title: 'Events and tournaments',
    body: 'Walk-on music, filler between matches, and a proper fade out of the room when the stream goes live.',
  },
];

const STEPS = [
  {
    title: 'Join the waitlist',
    body: 'Your Discord handle and where it is for. We come back to you when a spot opens.',
  },
  {
    title: 'We bring the bot in',
    body: 'It joins your server and takes the role you nominate. Nothing for you to install.',
  },
  {
    title: 'Sign in and play',
    body: 'No new account. Upload, drag it to a deck, and the voice channel hears it.',
  },
];

const FAQ = [
  {
    q: 'What do I have to set up?',
    a: 'Nothing. We bring the bot into your Discord server, point it at the role you nominate, and send you the booth link. There is no developer portal, no token to paste and nothing to keep running.',
  },
  {
    q: 'Where does the audio go?',
    a: 'It is mixed and encoded on our machines and streamed straight into your voice channel. Sets are not recorded, and the stream is the only thing that leaves the booth.',
  },
  {
    q: 'What can I upload?',
    a: 'MP3, WAV, FLAC, OGG, M4A, AAC and Opus, plus most other formats. Your library is your room’s alone — there is no shared pool, and nobody else can see it.',
  },
  {
    q: 'Can two people mix at once?',
    a: 'No, and that is on purpose. One person holds control while the rest watch live. Control passes when the holder releases it, and automatically if they sit idle for three minutes while somebody is waiting. Nobody gets bumped off an empty queue.',
  },
  {
    q: 'Can people request tracks?',
    a: 'Anyone signed in can add to the shared queue whether or not they hold the decks — lining a track up does not change what the room is hearing. Loading, reordering and clearing need control.',
  },
  {
    q: 'Do you track us?',
    a: 'No. There is no analytics and no third-party scripts anywhere in the booth. We can see that a room is running because we run it — we do not sell that, share it, or watch what you play.',
  },
  {
    q: 'How do we get in?',
    a: 'Join the waitlist. Access opens in batches so every new room is set up properly rather than dropped into a queue, and we come to you on Discord when a spot is ready.',
  },
];

/* --------------------------------------------------------------- pieces */

/**
 * The opening line lands in time: a word on every eighth note, so the first
 * thing the page does is keep the tempo it is about to run at.
 */
function Kinetic({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, index) => (
        <span className="kin" key={`${word}-${index}`}>
          {/* The word gap is the wrapper's margin, not a space — a space inside
              an overflow-hidden inline-block is trimmed away. */}
          <span style={{ animationDelay: `${(index * BEAT_S * 0.5).toFixed(3)}s` }}>{word}</span>
        </span>
      ))}
    </>
  );
}

/**
 * The console illustration. It tilts a little towards the pointer — enough to
 * read as a rig on a desk rather than a screenshot, not enough that anyone has
 * to wait for it to settle.
 */
function Rig() {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const onMove = (event: PointerEvent) => {
      el.style.setProperty('--tilt-x', ((event.clientY / window.innerHeight) * -4 + 2).toFixed(2));
      el.style.setProperty('--tilt-y', ((event.clientX / window.innerWidth) * 6 - 3).toFixed(2));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduced]);

  return (
    <div className="rig" ref={ref}>
      <div className="rig-tilt">
        <ConsolePreview />
      </div>
    </div>
  );
}

/** The one list shape on the page: a lamp, a line, a hairline under it. */
function Rows({ items }: { items: readonly string[] }) {
  return (
    <ul className="rows">
      {items.map((item, index) => (
        <li key={item} style={{ transitionDelay: `${index * 60}ms` }}>
          <span className="rows-lamp" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------------- page */

export function Home() {
  return (
    <SitePage current="/home" bleed>
      <Backdrop />

      <Mix>
        <Cue
          id="intro"
          n="01"
          label="Intro"
          lead
          statement={
            <>
              <Kinetic text="A real DJ booth for" />
              <span className="cue-turn">
                <Kinetic text="your Discord server." />
              </span>
            </>
          }
          lede="Two decks, a proper mixer and eight sample pads — mixed live into a voice channel by you and your crew. Not a queue bot."
        >
          <dl className="readout">
            {SPECS.map((spec) => (
              <div key={spec.label}>
                <dt className="mono">{spec.value}</dt>
                <dd>{spec.label}</dd>
              </div>
            ))}
          </dl>
          <Rig />
        </Cue>

        <Cue
          id="difference"
          n="02"
          label="The difference"
          statement="Not another music bot"
          lede="Take the fader. Everything to the left of it is what a music bot does; everything to the right is what a booth does."
        >
          <Crossfade items={CONTRAST} />
        </Cue>

        {MODULES.map((module) => (
          <Cue
            key={module.id}
            id={module.id}
            n={module.n}
            label={module.label}
            statement={module.statement}
            lede={module.lede}
          >
            <Rows items={module.points} />
          </Cue>
        ))}

        <Cue
          id="pads"
          n="09"
          label="The pads"
          statement="Eight pads. Press one."
          lede="No sign-up and no demo to book. The keys 1 to 8 work here too, exactly as they do on the console."
        >
          <PadPlay />
        </Cue>

        <Cue
          id="rooms"
          n="10"
          label="Who runs it"
          statement="Built for rooms with a schedule"
        >
          <dl className="notes">
            {AUDIENCE.map((item) => (
              <div key={item.title}>
                <dt>{item.title}</dt>
                <dd>{item.body}</dd>
              </div>
            ))}
          </dl>
        </Cue>

        <Cue
          id="getting-in"
          n="11"
          label="Getting in"
          statement="Three steps, none of them yours to build"
          lede="No portal, no container, no tokens. The setup that used to take an afternoon is a conversation and an invite."
        >
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="steps-no mono">{index + 1}</span>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
              </li>
            ))}
          </ol>
          <p className="cue-foot">
            The <a href="/home/help">help centre</a> covers working the decks once you are in.
          </p>
        </Cue>

        <Cue id="questions" n="12" label="Questions" statement="The things people ask first">
          <div className="asks">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </Cue>

        <Cue
          id="end"
          n="13"
          label="End of set"
          statement="Put a booth in your server."
          lede="Access opens in batches, and every room gets set up properly rather than handed a link. Tell us what you are running — a community, a station, an event — and we will come to you."
        >
          <div className="cue-cta">
            <a className="btn is-primary" href="/home/access">
              Join the waitlist
            </a>
            <a className="btn" href="/home/help">
              Browse the help centre
            </a>
            <a className="btn" href="/login">
              Sign in
            </a>
          </div>
        </Cue>
      </Mix>
    </SitePage>
  );
}
