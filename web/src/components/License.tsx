import { Colophon } from './Colophon';
import { SiteNav } from './SiteNav';

/**
 * Licensing, at /home/license. The product pitch lives on /home; this page is
 * only about what running your own instance involves and how to arrange it.
 *
 * Nothing here states a price, a term, or a support commitment — those are
 * decisions for a person, not for this file. What it does state about the
 * software is read off the repository.
 */

const EMAIL = 'hello@ronation.live';
const LICENCE_SUBJECT = encodeURIComponent('deck — licensing enquiry');
const LICENCE_MAILTO = `mailto:${EMAIL}?subject=${LICENCE_SUBJECT}`;

const MODEL = [
  {
    title: 'It runs on your machine',
    body: 'One container, started with a single compose command. Uploads, decoded audio and the track database live in a volume on your disk. If you stop using it, your library is still sitting there.',
  },
  {
    title: 'It runs as your bot',
    body: 'You create the Discord application, so deck appears in your server under your name and your avatar. Sign-in goes through your own OAuth client — your members never touch ours.',
  },
  {
    title: 'Nothing reports back',
    body: 'No telemetry, no analytics, no third-party scripts, no phone-home licence check. Once it is running, it needs nothing from us to keep working.',
  },
  {
    title: 'Licensed per server',
    body: 'A licence covers the Discord server you are running it for. Several communities, or a station and its events? Say so and we will work it out in one go.',
  },
];

const REQUIREMENTS = [
  ['A machine with Docker', 'Any small VPS will do — the mix is CPU-light and compose caps it at two cores.'],
  ['A Discord application', 'Free, and takes about ten minutes in the developer portal.'],
  ['A domain and a reverse proxy', 'Only for anything public. There is a Caddyfile in the repo to start from.'],
  ['ffmpeg', 'Already inside the image, along with the Opus encoder. Nothing to install.'],
];

const FAQ = [
  {
    q: 'What does a licence cost?',
    a: 'It depends on the size of your server and what you are using it for — a small community and a ticketed event are not the same thing. Tell us a bit about both and we will come back with a number.',
  },
  {
    q: 'How long does setup take?',
    a: 'About fifteen minutes, most of it in the Discord developer portal. The setup guide walks through every step, and there is nothing to compile.',
  },
  {
    q: 'Who can get into the booth?',
    a: 'Whoever holds the Discord role you nominate. Membership and roles are checked server-side against the bot’s own token on every connection, so losing the role takes effect immediately and cannot be worked around from a browser.',
  },
  {
    q: 'What happens to my uploads?',
    a: 'They stay on your server, in a Docker volume, and rebuilding the image does not touch them. Nobody else can see your library — there is no shared pool and no upstream service.',
  },
  {
    q: 'Can I try it before committing?',
    a: 'Get in touch and we will sort something out. It is easier to talk about once we know what you are running.',
  },
];

export function License() {
  return (
    <div className="lic">
      <SiteNav current="/home/license" />

      <div className="doc">
        <header className="doc-head">
          <h1>Licensing</h1>
          <p>
            deck is self-hosted and licensed per Discord server. This is what that means in
            practice, and how to arrange one.
          </p>
        </header>

        <section className="lic-section">
          <h2 className="lic-section-title">How it works</h2>
          <div className="lic-audience">
            {MODEL.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lic-section">
          <h2 className="lic-section-title">What you need</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <tbody>
                {REQUIREMENTS.map(([what, note]) => (
                  <tr key={what}>
                    <td className="doc-key">{what}</td>
                    <td>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="doc-note">
            The <a href="/home/setup">setup guide</a> covers all of it step by step, and the{' '}
            <a href="/home/guides">booth guide</a> covers using it once it is up.
          </p>
        </section>

        <section className="lic-section">
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

        <section className="lic-close">
          <h2>Tell us what you are running.</h2>
          <p>
            A community, a station, an event — whatever it is, send a line about it and we will
            come back with a licence that fits.
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
