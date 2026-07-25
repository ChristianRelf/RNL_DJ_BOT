import { Colophon } from './Colophon';
import { ConsolePreview } from './ConsolePreview';

/**
 * The shop window. This is what a signed-out visitor gets at `/`, and it stays
 * reachable at `/home` once you are signed in.
 *
 * Everything claimed here is something the software actually does, and the
 * numbers are the shipped defaults — if a feature or a default changes, change
 * it here too. Nothing on this page should need a footnote.
 */

const EMAIL = 'hello@ronation.live';
const LICENCE_SUBJECT = encodeURIComponent('deck — licensing enquiry');
const LICENCE_MAILTO = `mailto:${EMAIL}?subject=${LICENCE_SUBJECT}`;

const SPECS = [
  { value: '2', label: 'decks' },
  { value: '8', label: 'sample pads' },
  { value: '3-band', label: 'kill EQ' },
  { value: '48 kHz', label: 'stereo Opus' },
];

const FEATURES = [
  {
    title: 'Two decks',
    body: 'Waveform scrubbing, cue points, manual and beat-locked loops, beat jumps, pitch control, and one-press tempo matching between decks.',
  },
  {
    title: 'A real isolator',
    body: 'Three-band EQ that kills properly rather than dipping, a sweepable low-pass/high-pass filter, and input trim on every channel.',
  },
  {
    title: 'Eight sample pads',
    body: 'Fire them as one-shots, loops, or hold-to-play. They run on their own bus that ducks the decks underneath by however much you want.',
  },
  {
    title: 'Built for a crew',
    body: 'One person on the decks at a time, with a request queue, live presence, and automatic handover when someone goes idle. Everyone else watches the meters move.',
  },
  {
    title: 'A media pool that does the work',
    body: 'Drag files in and get waveforms and tempo back automatically. Search, tag, rename, and pre-listen in your own browser without touching the live mix.',
  },
  {
    title: 'Controls that behave',
    body: 'Right-click any control to reset it, right-drag or shift-drag for fine adjustment, scroll to trim. Keyboard shortcuts for transport and pads.',
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
    title: 'Drop a track and take control',
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
    a: 'No, and that is on purpose. One person holds control while the rest watch live. Control passes on request, or automatically after three minutes of inactivity.',
  },
  {
    q: 'What do I need to run it?',
    a: 'A machine with Docker, a Discord application, and a domain behind a reverse proxy. ffmpeg and the Opus encoder are already in the image.',
  },
  {
    q: 'Does it phone home?',
    a: 'No. There is no telemetry, no analytics and no third-party scripts anywhere in it. Uploads and settings live in a volume on your server.',
  },
];

export function Home({ error }: { error?: string | null }) {
  return (
    <div className="home">
      <nav className="home-nav">
        <a href="/home" className="home-nav-brand">
          <img className="home-nav-logo" src="/deckLogo.png" alt="deck" />
        </a>
        <div className="home-nav-links">
          <a href="#features">Features</a>
          <a href="#faq">FAQ</a>
          <a href="#licensing">Licensing</a>
        </div>
        <a className="btn tiny home-nav-cta" href="/login">
          SIGN IN
        </a>
      </nav>

      <div className="home-inner">
        <header className="home-hero">
          <span className="home-eyebrow">Discord DJ booth</span>
          <h1>Shared decks for Discord.</h1>
          <p className="home-lede">
            A proper mixing console in the browser, wired straight into a voice channel. Your crew
            takes turns on the decks; everyone else just listens.
          </p>

          {error ? <p className="login-error home-error">{error}</p> : null}

          <div className="home-cta">
            <a className="btn primary home-btn" href="/login">
              SIGN IN WITH DISCORD
            </a>
            <a className="btn home-btn" href="#licensing">
              RUN YOUR OWN
            </a>
          </div>
          <p className="home-consent">
            Signing in means you accept the <a href="/terms">Terms</a> and{' '}
            <a href="/privacy">Privacy Policy</a>.
          </p>
        </header>

        <ConsolePreview />

        <ul className="home-specs">
          {SPECS.map((spec) => (
            <li key={spec.label}>
              <span className="home-spec-value mono">{spec.value}</span>
              <span className="home-spec-label">{spec.label}</span>
            </li>
          ))}
        </ul>

        <section className="home-section" id="features">
          <h2 className="home-section-title">What you get</h2>
          <div className="home-grid">
            {FEATURES.map((feature) => (
              <article className="home-card" key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-section" id="steps">
          <h2 className="home-section-title">Getting on the air</h2>
          <ol className="home-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="home-step-index mono">{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="home-section" id="faq">
          <h2 className="home-section-title">Questions</h2>
          <dl className="home-faq">
            {FAQ.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="home-section home-licence" id="licensing">
          <h2 className="home-section-title">Running it yourself</h2>
          <p className="home-licence-lede">
            deck is self-hosted. It ships as a single container, runs against your own Discord
            application, and keeps every uploaded file and every setting on your server.
          </p>
          <p>
            If you want it for your own community, station or event, get in touch and we will sort
            out a licence.
          </p>
          <a className="btn primary home-btn" href={LICENCE_MAILTO}>
            TALK TO US ABOUT LICENSING
          </a>
        </section>

        <footer className="home-foot">
          <Colophon block />
        </footer>
      </div>
    </div>
  );
}
