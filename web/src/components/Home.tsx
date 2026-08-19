import { useEffect, useRef } from 'react';
import { ConsolePreview } from './ConsolePreview';
import { SitePage } from './SiteNav';
import { Backdrop } from './landing/Backdrop';
import { Crossfade, type Contrast } from './landing/Crossfade';
import { Cue, Mix } from './landing/Mix';
import { PadPlay } from './landing/PadPlay';
import { useReducedMotion } from './landing/beat';

/**
 * The product pitch, at /home. The front door is the sign-in page; this is
 * where "find out more" leads. Access and the waitlist live on /home/access.
 *
 * The page is one track. The whole set is drawn as a waveform down the left,
 * the full height of the document; a playhead sits fixed at 40% of the window;
 * and every block of copy is a cue point that goes live as it crosses the head.
 * There are no sections and no cards - thirteen cues with identical anatomy,
 * one transport across the bottom, and one shader behind the lot, all driven by
 * the same scroll position. See landing/Mix.tsx, which is the whole mechanism.
 *
 * Two of the cues are the product rather than a description of it: the
 * difference between a music bot and a booth is made on a crossfader you drag,
 * and the sample pads are eight pads you can hit. Anything the page can hand
 * you, it hands you.
 *
 * Every claim is something the software actually does, and every number is a
 * shipped default - if a feature or a default changes, change it here too. No
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
    them: 'A music bot plays a queue.',
    us: 'deck provides a live mixing console.',
    body: 'Two decks, waveforms, cue points, loops, EQ, effects and a configurable crossfader-all operated live from the browser.',
  },
  {
    them: 'A music bot has shared playback controls.',
    us: 'deck has clear operator control.',
    body: 'One DJ holds the controls while everyone else follows the console in real time. Handover is explicit, with an orderly queue for the next operator.',
  },
  {
    them: 'A self-hosted bot needs ongoing maintenance.',
    us: 'deck is managed for your server.',
    body: 'There is no bot token, container or audio stack for your team to maintain. Each server has its own private library and access policy.',
  },
];

/** One cue each. Six modules of the booth, in the order you meet them. */
const MODULES = [
  {
    id: 'decks',
    n: '03',
    label: 'The decks',
    statement: 'A complete browser mixing console',
    lede: 'The controls needed for a live set, presented in a focused two-deck workspace.',
    points: [
      'Two decks with waveform scrubbing and cue points',
      'Beat-locked loops, beat jumps and loop rolls',
      'Pitch control, tempo matching and tap tempo',
      'Three-band isolator EQ and sweepable filters',
      'Adjustable crossfader curve, from smooth blends to hard cuts',
    ],
  },
  {
    id: 'desk',
    n: '04',
    label: 'The desk',
    statement: 'Detailed control when you need it',
    lede: 'Core controls stay close at hand. Routing, effects and master processing remain available in the advanced mixer.',
    points: [
      'Per-channel pan, mute and a post-fader effects send',
      'Send effects: tape echo, reverb and flanger, timed in beats',
      'Master isolator, left–right balance and a mono fold-down',
      'Brickwall limiter with gain-reduction metering',
      'MIDI mapping with fader pickup',
    ],
  },
  {
    id: 'crew',
    n: '05',
    label: 'The crew',
    statement: 'Designed for shared operation',
    lede: 'A defined control model keeps multi-DJ sessions predictable without preventing the rest of the room from participating.',
    points: [
      'One operator at a time, with a request queue',
      'Automatic handover when an operator is idle and someone is waiting',
      'Live presence for viewers and operators',
      'Access gated on the Discord roles you already use',
      'Everyone else watches the console live, read-only',
    ],
  },
  {
    id: 'library',
    n: '06',
    label: 'The library',
    statement: 'A private library for each server',
    lede: 'Upload music, organise it in place and prepare the next track without interrupting the live output.',
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
    statement: 'A workspace that fits the operator',
    lede: 'Arrange and resize the console panels for the screen and workflow in front of you. Layouts are saved per browser.',
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
    statement: 'Connect it to the wider production',
    lede: 'Optional outputs and integrations connect the booth to broadcast, lighting and visual systems.',
    points: [
      'Timecode feed over HTTP for overlays and lighting',
      'OSC output to Pure Data, a lighting desk or a VJ rig',
      'Import straight from a promo-pool download link',
      'Managed updates with no client deployment',
      'Optional tools remain disabled until an operator enables them',
    ],
  },
];

const AUDIENCE = [
  {
    title: 'Community servers',
    body: 'Listening parties, regular DJ sets and community events with a console the whole room can follow.',
  },
  {
    title: 'Internet radio',
    body: 'A rotating roster of presenters working from the same library and handing over cleanly between programmes.',
  },
  {
    title: 'Events and tournaments',
    body: 'Walk-on music, interval programming and controlled transitions into or out of a live stream.',
  },
];

const STEPS = [
  {
    title: 'Request access',
    body: 'Tell us which Discord community you operate and how you plan to use the booth.',
  },
  {
    title: 'Configure the server',
    body: 'We add the playback bot and connect access to the Discord roles you nominate.',
  },
  {
    title: 'Open the console',
    body: 'Sign in with Discord, upload your library and start mixing into the voice channel.',
  },
];

const FAQ = [
  {
    q: 'What do I have to set up?',
    a: 'We add the playback bot, configure the nominated Discord roles and provide the console URL. Your team does not need to host an application or manage a bot token.',
  },
  {
    q: 'Where does the audio go?',
    a: 'Audio is mixed and encoded by the service, then streamed directly into your Discord voice channel. Sets are not recorded.',
  },
  {
    q: 'What can I upload?',
    a: 'MP3, WAV, FLAC, OGG, M4A, AAC and Opus are supported. Libraries are isolated by server and are not pooled across customers.',
  },
  {
    q: 'Can two people mix at once?',
    a: 'One person operates the console at a time while others watch live. Control can be released or handed over, and automatically passes after three minutes of inactivity when another operator is waiting.',
  },
  {
    q: 'Can people request tracks?',
    a: 'Yes. Signed-in members can submit requests or add to the shared queue without taking control of the live decks. An operator decides what is loaded and played.',
  },
  {
    q: 'Do you track us?',
    a: 'The console does not use third-party analytics. Operational status is visible to platform administrators, but sets are not recorded and listening activity is not sold or shared.',
  },
  {
    q: 'How do we get in?',
    a: 'Submit an access request with your Discord details. New servers are onboarded in batches so roles, permissions and playback are configured correctly.',
  },
];

/* --------------------------------------------------------------- pieces */

/**
 * The console illustration. It tilts a little towards the pointer - enough to
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
              Live DJ mixing,
              <span className="cue-turn"> built for Discord.</span>
            </>
          }
          lede="A managed, browser-based DJ console with two decks, a full mixer and shared operation-streamed directly into your Discord voice channel."
        >
          <div className="cue-cta cue-cta-hero">
            <a className="btn is-primary" href="/home/access">Request access</a>
            <a className="btn" href="/login">Sign in</a>
          </div>
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
          label="Product model"
          statement="More than queued playback"
          lede="Use the crossfader to compare a conventional music bot with a live, operated booth."
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
          statement="Try the sample pads"
          lede="The console includes eight assignable pads with one-shot, loop and gate modes. Use keys 1–8 to test the interaction."
        >
          <PadPlay />
        </Cue>

        <Cue
          id="rooms"
          n="10"
          label="Use cases"
          statement="For teams that programme live audio"
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
          label="Onboarding"
          statement="A managed setup in three steps"
          lede="We handle the playback bot and role configuration. Your team signs in with Discord and works from the browser."
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

        <Cue id="questions" n="12" label="Questions" statement="Frequently asked questions">
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
          label="Get access"
          statement="Bring live mixing to your server."
          lede="Tell us about your community, station or event. We onboard new servers in batches and configure each deployment with you."
        >
          <div className="cue-cta">
            <a className="btn is-primary" href="/home/access">
              Request access
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
