import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConsolePreview } from './ConsolePreview';
import { SitePage } from './SiteNav';
import { Backdrop } from './landing/Backdrop';
import { Chrome, Readout, type Marker } from './landing/Chrome';
import { Crossfade, type Contrast } from './landing/Crossfade';
import { PadPlay } from './landing/PadPlay';
import { Rack, type Module } from './landing/Rack';
import { BEAT_S, useFrame, useReducedMotion, useReveal } from './landing/beat';

/**
 * The product pitch, at /home. The front door is the sign-in page; this is
 * where "find out more" leads. Access and the waitlist live on /home/access.
 *
 * The page is a set. Everything that moves runs off one 124 BPM clock — the
 * light behind it, the meters, the lamps, the readout under the headline —
 * because the product is a booth and a booth that drifts is not one. The
 * difference between a music bot and a booth is made on an actual crossfader
 * you can drag, and the sample pads are eight pads you can actually hit.
 * Nothing here describes an interaction it could have just handed you.
 *
 * Every claim is something the software actually does, and every number is a
 * shipped default — if a feature or a default changes, change it here too. No
 * invented pricing, no invented adoption, nothing that needs a footnote.
 */

const PROOF = ['Run for you', 'Nothing to install', 'No telemetry'];

const TICKER = [
  'Two decks',
  'Three-band kill EQ',
  'Eight sample pads',
  'Beat-locked loops',
  'Tape echo · reverb · flanger',
  'MIDI mapping',
  'Live in a voice channel',
  'No install',
  'No telemetry',
];

const SPECS = [
  { value: '2', label: 'decks', note: 'waveform, cue, loops, pitch' },
  { value: '8', label: 'sample pads', note: 'one-shot, loop or hold' },
  { value: '3', label: 'band kill EQ', note: 'per channel, plus a filter' },
  { value: '48k', label: 'stereo Opus', note: 'straight into the channel' },
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

const PILLARS: readonly Module[] = [
  {
    kicker: 'The decks',
    title: 'Mix like you mean it',
    body: 'Everything you would reach for on a real controller, in a browser tab. Load a track, find the one, and work it.',
    points: [
      'Two decks with waveform scrubbing and cue points',
      'Beat-locked loops, beat jumps and loop rolls',
      'Pitch fader with one-press tempo matching and tap tempo',
      'Three-band EQ that kills properly, plus a sweepable filter',
      'Crossfader that runs from a constant-power blend to a hard cut',
    ],
  },
  {
    kicker: 'The desk',
    title: 'A mixer with the rest of it',
    body: 'The compact strip is what you reach for mid-mix. The advanced desk is everything behind it, on its own panel.',
    points: [
      'Per-channel pan, mute and a post-fader effects send',
      'Send effects: tape echo, reverb and flanger, timed in beats',
      'Master isolator, left–right balance and a mono fold-down',
      'Brickwall limiter with gain-reduction metering',
      'Map a MIDI controller onto any of it, with fader pickup',
    ],
  },
  {
    kicker: 'The crew',
    title: 'Hand the booth around',
    body: 'Built for a group from the start, so nobody is passing a laptop or arguing about who is in charge.',
    points: [
      'One operator at a time, with a request queue',
      'Hands over automatically if you idle while someone waits',
      'Live presence — see who is in and who is playing',
      'Access gated on the Discord roles you already use',
      'Everyone else watches the console live, read-only',
    ],
  },
  {
    kicker: 'The library',
    title: 'Drop files in and play',
    body: 'Uploads are decoded once, on the way in. No tagging session before you can start a set.',
    points: [
      'Waveforms and tempo read on upload',
      'Search, tag and rename in place',
      'Pre-listen in your own browser, off air',
      'A shared queue anyone can add to, decks or no decks',
      'Auto-advance picks up the next track when a deck runs out',
    ],
  },
  {
    kicker: 'The console',
    title: 'Arrange it how you play',
    body: 'The booth is a grid of tools you place yourself. Your layout is yours — it never moves anyone else’s.',
    points: [
      'Drag tools in, drag them to size, snapped to a twelve-column grid',
      'Nothing overlaps: what you drop onto gets pushed out of the way',
      'Presets for a full console, a laptop, a booth monitor or a library day',
      'Panels scroll rather than crop, and fit to their contents on request',
      'Saved in your browser, per person, never on the server',
    ],
  },
  {
    kicker: 'The wiring',
    title: 'Fit it into the rest of the show',
    body: 'The booth does not have to be an island. Switch on what you need from the tools page.',
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

const MARKERS: readonly Marker[] = [
  { id: 'top', label: 'Intro' },
  { id: 'why', label: 'The difference' },
  { id: 'features', label: 'The rack' },
  { id: 'pads', label: 'The pads' },
  { id: 'who', label: 'Who runs it' },
  { id: 'steps', label: 'Getting in' },
  { id: 'faq', label: 'Questions' },
  { id: 'access', label: 'Get access' },
];

/* --------------------------------------------------------------- pieces */

/**
 * A headline that lands in time. Each word rises on the next eighth note, so
 * the first thing the page does is keep time in front of you.
 */
function Kinetic({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {text.split(' ').map((word, index) => (
        <span className="kin" key={`${word}-${index}`}>
          {/* The word spacing is the wrapper's margin, not a space: a space
              inside an overflow-hidden inline-block is trimmed away. */}
          <span style={{ animationDelay: `${((from + index) * BEAT_S * 0.5).toFixed(3)}s` }}>{word}</span>
        </span>
      ))}
    </>
  );
}

/** A section, labelled the way the console labels a panel. */
function Bay({
  id,
  index,
  eyebrow,
  title,
  lede,
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section className={`bay ${shown ? 'is-shown' : ''}`} id={id} ref={ref}>
      <header className="bay-head">
        <span className="bay-tag mono">
          <i>{index}</i>
          {eyebrow}
        </span>
        <h2>{title}</h2>
        {lede ? <p>{lede}</p> : null}
        <span className="bay-rule" aria-hidden="true" />
      </header>
      {children}
    </section>
  );
}

/** One spec, counted up on arrival, with a strip of LEDs that keeps time. */
function Spec({ value, label, note }: { value: string; label: string; note: string }) {
  const [ref, shown] = useReveal<HTMLLIElement>();
  const reduced = useReducedMotion();
  const target = Number.parseInt(value, 10);
  const suffix = value.replace(/^\d+/, '');
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!shown) return;
    if (reduced) {
      setCount(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 900);
      setCount(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [shown, reduced, target]);

  return (
    <li className={shown ? 'is-shown' : ''} ref={ref}>
      <span className="spec-value mono">
        {count}
        {suffix}
      </span>
      <span className="spec-label">{label}</span>
      <span className="spec-note">{note}</span>
      <span className="spec-leds" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${(i * BEAT_S * 0.125).toFixed(3)}s` }} />
        ))}
      </span>
    </li>
  );
}

/**
 * The console illustration, on a plinth. It tilts a little towards the pointer
 * and breathes with the clock — enough that it reads as a running rig rather
 * than a screenshot, not so much that anyone has to wait for it to settle.
 */
function Rig() {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const onMove = (event: PointerEvent) => {
      const x = (event.clientX / window.innerWidth) * 2 - 1;
      const y = (event.clientY / window.innerHeight) * 2 - 1;
      el.style.setProperty('--tilt-x', (y * -2.4).toFixed(2));
      el.style.setProperty('--tilt-y', (x * 3.4).toFixed(2));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduced]);

  return (
    <div className="home-rig" ref={ref}>
      <span className="home-rig-glow" aria-hidden="true" />
      <div className="home-rig-tilt">
        <ConsolePreview />
      </div>
      <span className="home-rig-caption mono">The console, drawn to scale</span>
    </div>
  );
}

/** A room that lights where the pointer is, like a panel under a booth lamp. */
function Room({ title, body }: { title: string; body: string }) {
  const ref = useRef<HTMLElement | null>(null);
  return (
    <article
      className="room"
      ref={ref}
      onPointerMove={(event) => {
        const el = ref.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${event.clientX - box.left}px`);
        el.style.setProperty('--my', `${event.clientY - box.top}px`);
      }}
    >
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

/** The three steps, drawn as a signal path with the light travelling down it. */
function Steps() {
  const [ref, shown] = useReveal<HTMLOListElement>();
  return (
    <ol className={`path ${shown ? 'is-shown' : ''}`} ref={ref}>
      <span className="path-line" aria-hidden="true" />
      {STEPS.map((step, index) => (
        <li key={step.title} style={{ transitionDelay: `${index * 140}ms` }}>
          <span className="path-node mono">{index + 1}</span>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * The closing panel keeps its own gain-reduction lamp running, so the last
 * thing on the page is still moving when you reach it.
 */
function Close() {
  const meterRef = useRef<HTMLSpanElement | null>(null);
  const [ref, shown] = useReveal<HTMLElement>();
  const reduced = useReducedMotion();

  useFrame((frame) => {
    if (reduced || !meterRef.current) return;
    const level = 0.35 + 0.5 * Math.pow(1 - frame.beat, 2) + frame.energy * 0.2;
    meterRef.current.style.transform = `scaleX(${Math.min(1, level).toFixed(3)})`;
  });

  return (
    // The headline here holds its entrance until you arrive: the same
    // animation as the hero's, spent on someone who is looking at it.
    <section className={`home-close ${shown ? 'is-shown' : ''}`} id="access" ref={ref}>
      <span className="home-close-meter" aria-hidden="true">
        <span ref={meterRef} />
      </span>
      <h2>
        <Kinetic text="Put a booth in your server." />
      </h2>
      <p>
        Access opens in batches, and every room gets set up properly rather than handed a link.
        Tell us what you are running — a community, a station, an event — and we will come to you.
      </p>
      <div className="site-cta">
        <a className="site-btn is-primary" href="/home/access">
          Join the waitlist
        </a>
        <a className="site-btn" href="/home/help">
          Browse the help centre
        </a>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- page */

export function Home() {
  return (
    <SitePage current="/home" bleed>
      <Backdrop />
      <Chrome markers={MARKERS} />

      <header className="home-hero" id="top">
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <Readout />
            <h1>
              <Kinetic text="A real DJ booth" />
              <br />
              <span className="home-hero-line2">
                <Kinetic text="for your Discord server." from={3} />
              </span>
            </h1>
            <p className="home-lede">
              Two decks, a proper mixer and eight sample pads — mixed live into a voice channel by
              you and your crew. Not a queue bot.
            </p>
            <div className="site-cta">
              <a className="site-btn is-primary" href="/home/access">
                Join the waitlist
              </a>
              <a className="site-btn" href="/login">
                Sign in
              </a>
            </div>
            <ul className="home-proof">
              {PROOF.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <Rig />
        </div>

        <div className="home-scrollcue" aria-hidden="true">
          <span />
          Ride it down
        </div>
      </header>

      <div className="home-ticker" aria-hidden="true">
        <div className="home-ticker-run">
          {[0, 1].map((copy) => (
            <span key={copy}>
              {TICKER.map((item) => (
                <i key={item}>{item}</i>
              ))}
            </span>
          ))}
        </div>
      </div>

      <div className="home-wrap">
        <ul className="home-specs">
          {SPECS.map((spec) => (
            <Spec key={spec.label} {...spec} />
          ))}
        </ul>

        <Bay
          id="why"
          index="01"
          eyebrow="The difference"
          title="Not another music bot"
          lede="Take the fader. Everything left of it is what a music bot does; everything right of it is what a booth does."
        >
          <Crossfade items={CONTRAST} />
        </Bay>

        <Bay
          id="features"
          index="02"
          eyebrow="What you get"
          title="A booth, not a playlist"
          lede="Six modules, all of them in the box. There is no paid tier holding half of it back."
        >
          <Rack items={PILLARS} />
        </Bay>

        <Bay
          id="pads"
          index="03"
          eyebrow="Try it"
          title="Eight pads. Press one."
          lede="No sign-up, no demo booking. The keys 1 to 8 work too, exactly as they do on the console."
        >
          <PadPlay />
        </Bay>

        <Bay id="who" index="04" eyebrow="Who runs it" title="Built for rooms with a schedule">
          <div className="rooms">
            {AUDIENCE.map((item) => (
              <Room key={item.title} {...item} />
            ))}
          </div>
        </Bay>

        <Bay
          id="steps"
          index="05"
          eyebrow="Getting started"
          title="Three steps, none of them yours to build"
          lede="No portal, no container, no tokens. The setup that used to take an afternoon is a conversation and an invite."
        >
          <Steps />
          <p className="bay-foot">
            The <a href="/home/help">help centre</a> covers working the decks once you are in.
          </p>
        </Bay>

        <Bay id="faq" index="06" eyebrow="Questions" title="The things people ask first">
          <div className="site-faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </Bay>

        <Close />
      </div>
    </SitePage>
  );
}
