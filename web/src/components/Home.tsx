import { Colophon } from './Colophon';

/**
 * The shop window. This is what a signed-out visitor gets at `/`, and it stays
 * reachable at `/home` once you are signed in.
 *
 * Everything claimed here is something the software actually does — if a
 * feature is cut or changed, cut it here too. Nothing on this page should need
 * a footnote.
 */

const EMAIL = 'hello@ronation.live';
const LICENCE_SUBJECT = encodeURIComponent('deck — licensing enquiry');

const SPECS = [
  { value: '2', label: 'decks' },
  { value: '8', label: 'sample pads' },
  { value: '3-band', label: 'kill EQ' },
  { value: '48 kHz', label: 'stereo Opus' },
];

const FEATURES = [
  {
    title: 'Two decks',
    body: 'Waveform scrubbing, cue points, manual and beat-locked loops, pitch control, and one-press tempo matching between decks.',
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
    title: 'Straight into Discord',
    body: 'Mixed, encoded and streamed live into a voice channel. Access is gated on your Discord server roles, so the booth is only open to the people you choose.',
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

export function Home({ error }: { error?: string | null }) {
  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-hero">
          <img className="home-logo" src="/deckLogo.png" alt="deck" />
          <h1>Shared decks for Discord.</h1>
          <p className="home-lede">
            A proper mixing console in the browser, wired straight into a voice channel. Your crew
            takes turns on the decks; everyone else just listens.
          </p>

          {error ? <p className="login-error home-error">{error}</p> : null}

          <div className="home-cta">
            <a className="btn primary home-btn" href="/api/auth/login">
              SIGN IN WITH DISCORD
            </a>
            <a className="btn home-btn" href={`mailto:${EMAIL}?subject=${LICENCE_SUBJECT}`}>
              LICENCE IT
            </a>
          </div>
          <p className="home-consent">
            Signing in means you accept the <a href="/terms">Terms</a> and{' '}
            <a href="/privacy">Privacy Policy</a>.
          </p>
        </header>

        <ul className="home-specs">
          {SPECS.map((spec) => (
            <li key={spec.label}>
              <span className="home-spec-value mono">{spec.value}</span>
              <span className="home-spec-label">{spec.label}</span>
            </li>
          ))}
        </ul>

        <section className="home-section">
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

        <section className="home-section">
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

        <section className="home-section home-licence">
          <h2 className="home-section-title">Running it yourself</h2>
          <p>
            deck is self-hosted. It ships as a single container, runs against your own Discord
            application, and keeps every uploaded file and every setting on your server. Nothing is
            phoned home, and there is no third-party analytics anywhere in it.
          </p>
          <p>
            If you want it for your own community, station or event, get in touch and we will sort
            out a licence.
          </p>
          <a className="btn primary home-btn" href={`mailto:${EMAIL}?subject=${LICENCE_SUBJECT}`}>
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
