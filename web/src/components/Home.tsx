import {
  ArrowRight,
  Check,
  Cloud,
  Headphones,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { SitePage } from './SiteNav';

const BENEFITS = [
  {
    icon: SlidersHorizontal,
    title: 'Mix, don’t just queue',
    body: 'Two full decks, waveforms, cue points, loops, three-band EQ, effects and a configurable crossfader.',
  },
  {
    icon: Cloud,
    title: 'One private music library',
    body: 'Upload once to Deck Cloud, then search, tag, preview and queue tracks from any authorised browser.',
  },
  {
    icon: Users,
    title: 'Made for a crew',
    body: 'One DJ operates while the room follows live. Control requests and handovers keep shared sets orderly.',
  },
] as const;

const FAQ = [
  {
    q: 'What do we need to install?',
    a: 'Nothing on your DJs’ computers. Deck runs in the browser, and we handle the Discord playback bot, hosting and updates.',
  },
  {
    q: 'Does it play directly into Discord?',
    a: 'Yes. Deck mixes and encodes the output, then sends it into the voice channel selected from the console.',
  },
  {
    q: 'Can more than one person use the console?',
    a: 'Yes. Everyone can watch the console live, add to the queue and request control. One person operates at a time so the set stays predictable.',
  },
  {
    q: 'What audio formats can we upload?',
    a: 'MP3, WAV, FLAC, OGG, M4A, AAC and Opus are supported. Each Discord server has its own isolated library.',
  },
  {
    q: 'How much does it cost?',
    a: '$5 USD per rig, per month. That includes the hosted console, managed playback bot, integrations and 2.5 GB of private Deck Cloud storage.',
  },
] as const;

function ProductShot({
  src,
  alt,
  eager = false,
}: {
  src: string;
  alt: string;
  eager?: boolean;
}) {
  return (
    <figure className="market-shot">
      <div className="market-shot-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <b>deck.ronation.live</b>
      </div>
      <img
        src={src}
        alt={alt}
        width="1600"
        height="720"
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
      />
      <figcaption>Deck interface · representative demo content</figcaption>
    </figure>
  );
}

function TickList({ children }: { children: string[] }) {
  return (
    <ul className="market-ticks">
      {children.map((item) => (
        <li key={item}>
          <Check size={16} aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Home() {
  return (
    <SitePage current="/home" bleed>
      <div className="marketing-home">
        <section className="market-hero">
          <div className="market-hero-copy">
            <span className="site-eyebrow">The DJ booth for Discord</span>
            <h1>Run a real DJ set in your Discord server.</h1>
            <p>
              Deck gives your team two decks, a full mixer and a shared music library in the
              browser—then broadcasts the finished mix straight into your voice channel.
            </p>

            <div className="market-actions">
              <a className="site-btn is-primary" href="/home/access">
                Request access
                <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a className="site-btn" href="#console">See the console</a>
            </div>

            <div className="market-hero-note">
              <ShieldCheck size={16} aria-hidden="true" />
              Managed setup · no bot token or hosting to maintain
            </div>
          </div>

          <div className="market-hero-facts" aria-label="Product facts">
            <div><strong>2</strong><span>full decks</span></div>
            <div><strong>48k</strong><span>stereo Opus</span></div>
            <div><strong>2.5 GB</strong><span>private cloud</span></div>
            <div><strong>$5</strong><span>per rig / month</span></div>
          </div>

          <div className="market-hero-shot" id="console">
            <ProductShot
              src="/screenshots/deck-console.png"
              alt="Deck’s live browser console showing two waveforms, transport controls, cue points, loops and the central mixer"
              eager
            />
          </div>
        </section>

        <section className="market-trust" aria-label="Designed for live Discord audio">
          <span><Radio size={16} />Plays into Discord voice</span>
          <span><Headphones size={16} />Browser-based DJ workflow</span>
          <span><Users size={16} />Role-based crew access</span>
          <span><ShieldCheck size={16} />Private per-server library</span>
        </section>

        <section className="market-section market-intro">
          <div className="market-section-heading">
            <span className="site-eyebrow">More than a music bot</span>
            <h2>Everything your DJs need to perform live.</h2>
            <p>
              A queue can play songs. Deck gives an operator the controls to shape the set,
              while the rest of the team can follow, contribute and take over cleanly.
            </p>
          </div>

          <div className="market-benefits">
            {BENEFITS.map(({ icon: Icon, title, body }) => (
              <article key={title}>
                <Icon size={20} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="market-section market-feature">
          <div className="market-feature-copy">
            <span className="site-eyebrow">Deck Cloud</span>
            <h2>Your music, ready for the whole crew.</h2>
            <p>
              Keep each server’s library organised and available without passing folders or
              download links between DJs.
            </p>
            <TickList>
              {[
                'Search by title, tag or uploader',
                'Automatic waveform and tempo analysis',
                'Private pre-listen that never goes on air',
                'Shared queue and audience requests',
              ]}
            </TickList>
          </div>
          <ProductShot
            src="/screenshots/deck-cloud.png"
            alt="Deck Cloud library with searchable tracks, a shared queue and incoming audience requests"
          />
        </section>

        <section className="market-section market-feature is-reversed">
          <div className="market-feature-copy">
            <span className="site-eyebrow">Live performance</span>
            <h2>Controls that stay out of the set’s way.</h2>
            <p>
              Keep the mixer, pads and next tracks visible together. Every operator can save a
              layout that suits their screen and workflow.
            </p>
            <TickList>
              {[
                'Three-band isolator EQ and sweepable filters',
                'Eight assignable sample pads',
                'Tempo-synced echo, reverb and flanger',
                'MIDI mapping and independent second screens',
              ]}
            </TickList>
          </div>
          <ProductShot
            src="/screenshots/deck-performance.png"
            alt="Deck performance workspace showing the mixer, eight sample pads and the shared track queue"
          />
        </section>

        <section className="market-section market-steps">
          <div className="market-section-heading">
            <span className="site-eyebrow">From server to set</span>
            <h2>We handle the setup. Your crew handles the music.</h2>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Tell us about your server</h3>
                <p>Request access and share how your community, station or event will use Deck.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>We connect the booth</h3>
                <p>We add the playback bot and map access to the Discord roles you nominate.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Sign in and go live</h3>
                <p>Your DJs open the console with Discord, build the library and join a voice channel.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="market-section market-offer">
          <div>
            <span className="site-eyebrow">Simple monthly plan</span>
            <h2>A managed DJ booth for <strong>$5</strong> per rig, per month.</h2>
            <p>No server to run, bot token to protect or audio stack to keep patched.</p>
          </div>
          <div className="market-offer-card">
            <span className="market-price"><strong>$5</strong><small>USD / month</small></span>
            <TickList>
              {[
                'Hosted browser console',
                'Managed Discord playback bot',
                '2.5 GB private Deck Cloud storage',
                'Audience requests and integrations',
                'Guided setup and managed updates',
              ]}
            </TickList>
            <a className="site-btn is-primary" href="/home/access">
              Request access
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="market-section market-faq">
          <div className="market-section-heading">
            <span className="site-eyebrow">Questions</span>
            <h2>What teams ask before going live.</h2>
          </div>
          <div className="site-faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="market-final">
          <span className="site-eyebrow">Ready when your server is</span>
          <h2>Turn your next Discord event into a live set.</h2>
          <p>Tell us about the room. We’ll help you get the booth on air.</p>
          <div className="market-actions">
            <a className="site-btn is-primary" href="/home/access">
              Request access
              <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a className="site-btn" href="/login">Sign in</a>
          </div>
        </section>
      </div>
    </SitePage>
  );
}
