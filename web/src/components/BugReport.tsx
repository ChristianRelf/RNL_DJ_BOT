import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Bug, CheckCircle2, Send, ShieldCheck } from 'lucide-react';
import { getSiteConfig } from '../lib/analytics';
import { SitePage } from './SiteNav';

type DeliveryState = 'idle' | 'sending' | 'sent';

function initialPage(): string {
  const from = new URLSearchParams(window.location.search).get('from');
  if (from?.startsWith('/') && !from.startsWith('//')) return from.slice(0, 300);
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin === window.location.origin) return referrer.pathname.slice(0, 300);
  } catch {
    // A missing or external referrer is normal.
  }
  return '/home/help/report-a-bug';
}

function diagnostics() {
  let referrer = '';
  try {
    const parsed = new URL(document.referrer);
    if (parsed.origin === window.location.origin) referrer = parsed.pathname;
  } catch {
    // Do not send external referrers.
  }
  return {
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    screen: `${window.screen.width} × ${window.screen.height}`,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency || undefined,
    online: navigator.onLine,
    referrer,
  };
}

export function BugReport() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [delivery, setDelivery] = useState<DeliveryState>('idle');
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const page = useMemo(initialPage, []);

  useEffect(() => {
    void getSiteConfig()
      .then((value) => setConfigured(value.bugReportsConfigured))
      .catch(() => setConfigured(false));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (configured !== true || delivery === 'sending') return;
    setDelivery('sending');
    setError('');

    const form = new FormData(event.currentTarget);
    const includeDiagnostics = form.get('includeDiagnostics') === 'on';
    const payload = {
      category: form.get('category'),
      severity: form.get('severity'),
      summary: form.get('summary'),
      description: form.get('description'),
      steps: form.get('steps'),
      expected: form.get('expected'),
      contact: form.get('contact'),
      page: form.get('page'),
      includeDiagnostics,
      acknowledged: form.get('acknowledged') === 'on',
      website: form.get('website'),
      diagnostics: includeDiagnostics ? diagnostics() : undefined,
    };

    try {
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { error?: string; reference?: string };
      if (!response.ok) throw new Error(body.error || 'The report could not be sent.');
      setReference(body.reference ?? 'received');
      setDelivery('sent');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError((err as Error).message);
      setDelivery('idle');
    }
  };

  return (
    <SitePage current="/home/help">
      <header className="doc-head bug-report-head">
        <span className="site-eyebrow"><Bug size={14} /> Product support</span>
        <h1>Report a bug</h1>
        <p>
          Tell us what broke and how to reproduce it. Reports go straight to the private support
          channel used by the Deck team.
        </p>
      </header>

      {delivery === 'sent' ? (
        <section className="bug-report-success" aria-live="polite">
          <CheckCircle2 size={28} />
          <div>
            <h2>Report sent</h2>
            <p>Thank you. Your reference is <strong>{reference}</strong>. Keep it if you contact us again.</p>
            <a className="site-btn" href="/home/help">Back to the help centre</a>
          </div>
        </section>
      ) : (
        <form className="bug-report-form" onSubmit={submit}>
          {configured === false ? (
            <div className="bug-report-notice is-error" role="alert">
              <AlertTriangle size={18} />
              <p>
                Direct reporting is not configured yet. Email{' '}
                <a href="mailto:hello@ronation.live?subject=Deck%20bug%20report">hello@ronation.live</a>{' '}
                and include the details below.
              </p>
            </div>
          ) : null}

          <fieldset className="bug-report-section">
            <legend>What happened</legend>
            <div className="bug-report-grid">
              <label>
                Area
                <select name="category" defaultValue="playback" required>
                  <option value="playback">Decks or playback</option>
                  <option value="cloud">Deck Cloud or uploads</option>
                  <option value="billing">Billing or setup</option>
                  <option value="account">Sign-in or account</option>
                  <option value="website">Website or help centre</option>
                  <option value="other">Something else</option>
                </select>
              </label>
              <label>
                Impact
                <select name="severity" defaultValue="minor" required>
                  <option value="minor">Something is wrong</option>
                  <option value="blocking">I cannot continue</option>
                  <option value="critical">Live set or data at risk</option>
                </select>
              </label>
            </div>

            <label>
              Short summary
              <input name="summary" minLength={8} maxLength={120} required placeholder="Cloud upload completes, then fails its hash check" />
            </label>
            <label>
              What went wrong?
              <textarea name="description" minLength={20} maxLength={1800} rows={6} required placeholder="Include the exact message you saw and what the deck was doing at the time." />
            </label>
            <label>
              Steps to reproduce <span>optional</span>
              <textarea name="steps" maxLength={1800} rows={5} placeholder={'1. Open…\n2. Choose…\n3. The problem appears…'} />
            </label>
            <label>
              What did you expect? <span>optional</span>
              <textarea name="expected" maxLength={1000} rows={3} />
            </label>
          </fieldset>

          <fieldset className="bug-report-section">
            <legend>Where and how to follow up</legend>
            <label>
              Affected page
              <input name="page" defaultValue={page} maxLength={300} pattern="/.*" required />
              <small>Use a Deck path beginning with / — never paste a private invite or signed media URL.</small>
            </label>
            <label>
              Email or Discord username <span>optional</span>
              <input name="contact" maxLength={160} autoComplete="email" placeholder="Only if you want a reply" />
            </label>
          </fieldset>

          <fieldset className="bug-report-section bug-report-privacy">
            <legend>Diagnostics and privacy</legend>
            <label className="bug-report-check">
              <input type="checkbox" name="includeDiagnostics" defaultChecked />
              <span>
                <strong>Include browser diagnostics</strong>
                <small>Viewport and screen size, language, time zone, platform, online state and user agent.</small>
              </span>
            </label>
            <div className="bug-report-safety">
              <ShieldCheck size={18} />
              <p>We do not attach cookies, local storage, Discord IDs, music, object URLs or files.</p>
            </div>
            <label className="bug-report-check">
              <input type="checkbox" name="acknowledged" required />
              <span>
                I understand this report and any diagnostics I select are delivered to RO. Nation
                LIVE through its private Discord support channel. See the <a href="/privacy">Privacy Policy</a>.
              </span>
            </label>
          </fieldset>

          <label className="bug-report-honeypot" aria-hidden="true">
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>

          {error ? <p className="bug-report-error" role="alert">{error}</p> : null}

          <div className="bug-report-submit">
            <button className="site-btn is-primary" type="submit" disabled={configured !== true || delivery === 'sending'}>
              <Send size={15} />
              {delivery === 'sending' ? 'Sending…' : configured === null ? 'Checking reporting…' : 'Send bug report'}
            </button>
            <small>Limited to three reports per connection each hour.</small>
          </div>
        </form>
      )}
    </SitePage>
  );
}

