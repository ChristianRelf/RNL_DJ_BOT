import { Colophon } from './Colophon';
import { ConsolePreview } from './ConsolePreview';
import { SiteNav } from './SiteNav';

/**
 * The pitch, at /license. The front door is the sign-in page; this is where
 * "find out more" leads, and what you send someone who asks about running it
 * themselves.
 *
 * Every claim here is something the software actually does, and every number is
 * a shipped default — if a feature or a default changes, change it here too.
 * No invented pricing, no invented adoption, nothing that needs a footnote.
 */

const EMAIL = 'hello@ronation.live';
const LICENCE_SUBJECT = encodeURIComponent('deck — licensing enquiry');
const LICENCE_MAILTO = `mailto:${EMAIL}?subject=${LICENCE_SUBJECT}`;

const PROOF = ['Self-hosted', 'Your own Discord app', 'No telemetry'];

const SPECS = [
  { value: '2', label: 'decks' },
  { value: '8', label: 'sample pads' },
  { value: '3', label: 'band kill EQ' },
  { value: '48k', label: 'stereo Opus' },
];

/** The category distinction the whole product rests on. */
const CONTRAST = [
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
    them: 'Music bots run on someone else’s server.',
    us: 'deck runs on yours.',
    body: 'One container, your own Discord application, your files on your disk. Nothing is recorded, nothing is reported, and no third party sees your library.',
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

const PILLARS = [
  {
    title: 'Mix like you mean it',
    body: 'Everything you would reach for on a real controller, in a browser tab. Load a track, find the one, and work it.',
    points: [
      'Two decks with waveform scrubbing and cue points',
      'Beat-locked loops, beat jumps and loop rolls',
      'Pitch fader with one-press tempo matching',
      'Three-band EQ that kills properly, plus a sweepable filter',
      'Equal-power crossfader with slam buttons',
    ],
  },
  {
    title: 'Hand the booth around',
    body: 'Built for a crew from the start, so nobody is passing a laptop or fighting over who is in charge.',
    points: [
      'One operator at a time, with a request queue',
      'Hands over automatically if you idle while someone waits',
      'Live presence — see who is in and who is playing',
      'Access gated on the Discord roles you already use',
      'Everyone else watches the console live, read-only',
    ],
  },
  {
    title: 'A library that keeps up',
    body: 'Drop files in and they are ready to play. No tagging session before you can start a set.',
    points: [
      'Waveforms and tempo detected on upload',
      'Search, tag and rename in place',
      'Pre-listen in your own browser, off air',
      'Drag straight onto a deck or a sample pad',
      'Eight pads with one-shot, loop and hold modes',
    ],
  },
];

const STEPS = [
  {
    title: 'Invite the bot',
    body: 'Point it at your Discord server and pick the role that grants booth access.',
  },
  {
    title: 'Sign in with Discord',
    body: 'No new accounts and no passwords. If you hold the role, you are in.',
  },
  {
    title: 'Take control',
    body: 'Upload, drag it to a deck, and play. Everyone in the voice channel hears it.',
  },
];

const FAQ = [
  {
    q: 'Do I need my own Discord bot?',
    a: 'Yes. You create a Discord application, and deck runs as your bot under your name. Sign-in uses your own OAuth client, so your members never see ours.',
  },
  {
    q: 'Where does the audio go?',
    a: 'It is mixed and encoded on your server and streamed live into a voice channel. Nothing is recorded, and nothing leaves your machine except the stream itself.',
  },
  {
    q: 'What can I upload?',
    a: 'MP3, WAV, FLAC, OGG, M4A, AAC and Opus, plus anything else ffmpeg can decode. Files are capped at 100 MB by default, which you can raise.',
  },
  {
    q: 'Can two people mix at once?',
    a: 'No, and that is on purpose. One person holds control while the rest watch live. Control passes when the holder releases it, and automatically if they sit idle for three minutes while somebody is waiting. Nobody gets bumped off an empty queue.',
  },
  {
    q: 'What do I need to run it?',
    a: 'A machine with Docker, a Discord application, and a domain behind a reverse proxy. ffmpeg and the Opus encoder are already in the image.',
  },
  {
    q: 'What does a licence cost?',
    a: 'It depends on the size of your server and what you are using it for. Tell us a bit about both and we will come back with a number.',
  },
];

export function License() {
  return (
    <div className="lic">
      <SiteNav current="/license" />

      <div className="lic-inner">
        <header className="lic-hero">
          <h1>
            A real DJ booth
            <br />
            for your Discord server.
          </h1>
          <p className="lic-lede">
            Two decks, a proper mixer and eight sample pads — mixed live into a voice channel by
            you and your crew. Not a queue bot.
          </p>
          <div className="lic-cta">
            <a className="btn primary lic-btn" href={LICENCE_MAILTO}>
              Licence it for your server
            </a>
            <a className="btn lic-btn lic-btn-ghost" href="/login">
              Sign in
            </a>
          </div>
          <ul className="lic-proof">
            {PROOF.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </header>

        <ConsolePreview />

        <ul className="lic-specs">
          {SPECS.map((spec) => (
            <li key={spec.label}>
              <span className="lic-spec-value">{spec.value}</span>
              <span className="lic-spec-label">{spec.label}</span>
            </li>
          ))}
        </ul>

        <section className="lic-section" id="why">
          <h2 className="lic-section-title">Not another music bot</h2>
          <div className="lic-contrast">
            {CONTRAST.map((item) => (
              <article key={item.us}>
                <p className="lic-contrast-them">{item.them}</p>
                <h3>{item.us}</h3>
                <p className="lic-contrast-body">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lic-section" id="features">
          <h2 className="lic-section-title">What you get</h2>
          <div className="lic-pillars">
            {PILLARS.map((pillar) => (
              <article className="lic-pillar" key={pillar.title}>
                <div className="lic-pillar-copy">
                  <h3>{pillar.title}</h3>
                  <p>{pillar.body}</p>
                </div>
                <ul className="lic-pillar-list">
                  {pillar.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="lic-section" id="who">
          <h2 className="lic-section-title">Who runs it</h2>
          <div className="lic-audience">
            {AUDIENCE.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lic-section" id="steps">
          <h2 className="lic-section-title">Getting on the air</h2>
          <ol className="lic-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="lic-step-index">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lic-section" id="faq">
          <h2 className="lic-section-title">Questions</h2>
          <dl className="lic-faq">
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="lic-close" id="licensing">
          <h2>Put a booth in your server.</h2>
          <p>
            deck is self-hosted and licensed per server. Tell us what you are running — a community,
            a station, an event — and we will sort out a licence that fits.
          </p>
          <a className="btn primary lic-btn" href={LICENCE_MAILTO}>
            Talk to us about licensing
          </a>
          <span className="lic-close-mail">
            or email <a href={LICENCE_MAILTO}>{EMAIL}</a>
          </span>
        </section>

        <footer className="lic-foot">
          <Colophon block />
        </footer>
      </div>
    </div>
  );
}
