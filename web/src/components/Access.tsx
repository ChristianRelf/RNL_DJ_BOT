import { useState } from 'react';
import { DocPage, Section } from './SiteNav';

/**
 * Getting access, at /home/access.
 *
 * deck is run for you - there is nothing to install and nothing to host - so
 * this page is about joining the list rather than about standing anything up.
 *
 * Nothing here states a price, a term, a date or a queue position. Those are
 * decisions for a person, not for this file, and a made-up "you are number 40"
 * is the fastest way to lose someone's trust.
 */

const EMAIL = 'hello@ronation.live';

const HOW = [
  {
    title: 'Ask for a spot',
    body: 'Leave your Discord handle and where it is for. That is the whole form - the rest is a conversation.',
  },
  {
    title: 'We fit you in',
    body: 'Access opens in batches so every new room gets set up properly rather than dropped into a queue behind a hundred others.',
  },
  {
    title: 'The bot joins your server',
    body: 'We invite it, point it at the role you nominate, and hand you the booth link. No developer portal, no tokens, no container.',
  },
  {
    title: 'You play',
    body: 'Everything runs on our machines. Upgrades land while you are asleep, and there is nothing for you to keep an eye on.',
  },
];

const FAQ = [
  {
    q: 'Why is there a waitlist?',
    a: 'Every room on it is a live audio stream running on hardware we pay for, and a booth we would rather set up properly than throw a link at. We open access in batches so that stays true.',
  },
  {
    q: 'What does it cost?',
    a: 'It depends on the size of your room and what you are doing with it - a small community and a ticketed event are not the same thing. We will come back with a number when we come back about a spot.',
  },
  {
    q: 'Can I run it on my own machine?',
    a: 'No. deck is run as a service, not shipped as software, so there is no install and no self-hosted edition. What you get is a booth that is already working.',
  },
  {
    q: 'Who can get into the booth?',
    a: 'Whoever holds the Discord role you nominate. Membership and roles are checked server-side on every connection, so losing the role takes effect immediately and cannot be worked around from a browser.',
  },
  {
    q: 'What happens to my uploads?',
    a: 'They stay in your room’s library and are not shared with anyone else’s - there is no common pool. Ask and we will remove them.',
  },
  {
    q: 'How long is the wait?',
    a: 'It depends on how many rooms are ahead of you and how big they are. We would rather tell you a real date once we have looked than guess one now.',
  },
];

type State = 'idle' | 'sending' | 'done' | 'error';

/**
 * The waitlist form.
 *
 * Four fields and a note, because every extra one costs a percentage of the
 * people who would otherwise have asked. The `website` input is a honeypot: it
 * is hidden from people and irresistible to form-fillers, and anything that
 * arrives with it filled in is dropped server-side.
 */
function WaitlistForm() {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    discord: '',
    email: '',
    community: '',
    size: '',
    note: '',
    website: '',
  });

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    setError(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'That did not go through - try again.');
      setState('done');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <div className="waitlist-done">
        <h3>You are on the list.</h3>
        <p>
          We will get in touch on Discord when a spot opens for your room. If anything changes in
          the meantime - a date, a rough size - reply to us at <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
        </p>
      </div>
    );
  }

  return (
    <form className="waitlist" onSubmit={submit}>
      <div className="waitlist-row">
        <label className="waitlist-field">
          <span>Discord handle</span>
          <input
            className="waitlist-input"
            value={form.discord}
            onChange={set('discord')}
            placeholder="yourname"
            maxLength={60}
            required
          />
        </label>
        <label className="waitlist-field">
          <span>Email</span>
          <input
            className="waitlist-input"
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="you@example.com"
            maxLength={160}
            required
          />
        </label>
      </div>

      <div className="waitlist-row">
        <label className="waitlist-field">
          <span>Where is it for?</span>
          <input
            className="waitlist-input"
            value={form.community}
            onChange={set('community')}
            placeholder="Community, station or event"
            maxLength={120}
            required
          />
        </label>
        <label className="waitlist-field waitlist-field-small">
          <span>Roughly how many people?</span>
          <input
            className="waitlist-input"
            value={form.size}
            onChange={set('size')}
            placeholder="about 400"
            maxLength={40}
          />
        </label>
      </div>

      <label className="waitlist-field">
        <span>Anything else? (optional)</span>
        <textarea
          className="waitlist-input"
          value={form.note}
          onChange={set('note')}
          rows={3}
          maxLength={600}
          placeholder="What you would use it for, when you need it by, anything we should know."
        />
      </label>

      {/* Hidden from people, tempting to scripts. Never rendered to assistive
          tech either, so nobody is asked to fill in a trap. */}
      <input
        className="waitlist-trap"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={form.website}
        onChange={set('website')}
      />

      {error ? <p className="waitlist-error">{error}</p> : null}

      <div className="waitlist-actions">
        <button type="submit" className="site-btn is-primary" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Join the waitlist'}
        </button>
        <span className="waitlist-note">
          Your handle and email, kept until we have spoken. Nothing else, and no list we sell.
        </span>
      </div>
    </form>
  );
}

export function Access() {
  return (
    <DocPage
      current="/home/access"
      title="Get access"
      lede="deck is run for you - there is nothing to install, host or keep running. Access opens in batches, so put your room on the list and we will come to you."
    >
      <Section eyebrow="The list" title="Ask for a spot">
        <WaitlistForm />
      </Section>

      <Section eyebrow="How it goes" title="From the list to the booth">
        <div className="site-cards">
          {HOW.map((item) => (
            <article className="site-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section eyebrow="Questions" title="Before you ask">
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
        <h2>Rather just talk?</h2>
        <p>
          If your room is unusual - a station with a roster, an event with a date, something we
          have not thought of - say so and we will work it out with you directly.
        </p>
        <div className="site-cta">
          <a className="site-btn is-primary" href={`mailto:${EMAIL}?subject=deck%20-%20access`}>
            Email us
          </a>
        </div>
        <span className="site-close-mail">{EMAIL}</span>
      </section>
    </DocPage>
  );
}
