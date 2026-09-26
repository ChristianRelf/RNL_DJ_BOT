import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { DocPage, Section } from './SiteNav';

const EMAIL = 'hello@ronation.live';
const START = '/api/auth/login?next=/onboard';

const HOW = [
  {
    title: 'Sign in with Discord',
    body: 'Use your existing Discord account. There is no application form, approval queue or separate Deck password.',
  },
  {
    title: 'Connect your server',
    body: 'Discord shows its own server picker and adds Deck with only view, connect and speak permissions.',
  },
  {
    title: 'Start the Deck plan',
    body: '$5 USD a month covers one hosted rig and 2.5 GB of private Deck Cloud storage. Stripe handles checkout.',
  },
  {
    title: 'Choose roles and play',
    body: 'Pick who can DJ and who can take over, run the readiness check, then open the console.',
  },
] as const;

const FAQ = [
  {
    q: 'Can I start straight away?',
    a: 'Yes. If you can add apps to the Discord server, you can connect it, subscribe and open the console in one setup flow.',
  },
  {
    q: 'What does it cost?',
    a: '$5 USD per rig each month, including the hosted console, managed playback bot and 2.5 GB of Deck Cloud storage. A second rig needs its own subscription.',
  },
  {
    q: 'What happens if I cancel?',
    a: 'Cancellation normally stops the next monthly renewal and keeps the rig available through the period already paid for. The Terms explain cooling-off and refund rights in full.',
  },
  {
    q: 'What Discord permissions does Deck need?',
    a: 'View Channels, Connect and Speak. Discord also requires you to have permission to add the bot to the server you choose.',
  },
  {
    q: 'Can I run it on my own machine?',
    a: 'No. Deck is run as a service, not shipped as software, so there is no install and no self-hosted edition.',
  },
  {
    q: 'Who can get into the booth?',
    a: 'Whoever holds the Discord role you nominate. Membership and roles are checked server-side whenever someone connects.',
  },
  {
    q: 'What happens to my uploads?',
    a: 'They stay in that server\'s private library and are never pooled with another rig. You can remove tracks, and you should keep your own originals.',
  },
] as const;

export function Access() {
  return (
    <DocPage
      current="/home/access"
      title="Start your Deck"
      lede="Connect a Discord server, subscribe for $5 a month and open the booth. No waitlist, approval form or hosting setup."
    >
      <Section
        eyebrow="Available now"
        title="One rig. One straightforward monthly plan."
        lede="Discord verifies the server you can manage, Stripe handles payment, and Deck guides you through the rest."
      >
        <div className="access-plan">
          <div className="access-plan-copy">
            <span className="site-eyebrow">Deck monthly</span>
            <span className="market-price"><strong>$5</strong><small>USD / month</small></span>
            <p>Billed monthly per Discord rig. Cancel online through Stripe.</p>
          </div>
          <ul className="access-includes">
            {[
              'Hosted browser DJ console',
              'Managed Discord playback bot',
              '2.5 GB private Deck Cloud storage',
              'Audience requests and integrations',
              'Updates and guided setup',
            ].map((item) => (
              <li key={item}><Check size={15} aria-hidden="true" /> {item}</li>
            ))}
          </ul>
          <div className="access-plan-action">
            <a className="site-btn is-primary" href={START}>
              Start setup <ArrowRight size={16} aria-hidden="true" />
            </a>
            <span><ShieldCheck size={14} aria-hidden="true" /> Secure checkout hosted by Stripe</span>
          </div>
        </div>
      </Section>

      <Section eyebrow="How it works" title="From Discord sign-in to a live booth">
        <div className="site-cards">
          {HOW.map((item) => (
            <article className="site-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section eyebrow="Questions" title="Before you subscribe">
        <div className="site-faq">
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <section className="site-close">
        <h2>Ready to put your server on air?</h2>
        <p>Sign in, choose the server and follow the setup. You will see the full recurring price and terms before paying.</p>
        <div className="site-cta">
          <a className="site-btn is-primary" href={START}>Start setup</a>
          <a className="site-btn" href={`mailto:${EMAIL}?subject=Deck%20question`}>Ask a question</a>
        </div>
        <p className="site-close-legal">
          Before purchasing, read the <a href="/terms">Deck Terms</a> and{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </section>
    </DocPage>
  );
}
