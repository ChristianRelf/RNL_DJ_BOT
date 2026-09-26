import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  disableAnalytics,
  enableAnalytics,
  getSiteConfig,
  isAnalyticsPage,
  readAnalyticsConsent,
  saveAnalyticsConsent,
  type AnalyticsConsent,
  type SiteConfig,
} from '../lib/analytics';

export function CookieConsent() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [choice, setChoice] = useState<AnalyticsConsent | null>(() => readAnalyticsConsent());
  const [open, setOpen] = useState(() => isAnalyticsPage() && readAnalyticsConsent() === null);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    if (!isAnalyticsPage()) return;
    void getSiteConfig().then((value) => {
      setConfig(value);
      if (choice === 'granted' && value.analyticsMeasurementId) {
        enableAnalytics(value.analyticsMeasurementId);
      }
    }).catch(() => {
      // Configuration failure means analytics stays off; consent controls still
      // work and the choice is available when the service recovers.
    });
  }, [choice]);

  useEffect(() => {
    const show = () => {
      if (!isAnalyticsPage()) return;
      setManaging(true);
      setOpen(true);
    };
    window.addEventListener('deck:cookie-settings', show);
    return () => window.removeEventListener('deck:cookie-settings', show);
  }, []);

  if (!open || !isAnalyticsPage()) return null;

  const decide = (next: AnalyticsConsent) => {
    saveAnalyticsConsent(next);
    setChoice(next);
    if (next === 'granted' && config?.analyticsMeasurementId) {
      enableAnalytics(config.analyticsMeasurementId);
    } else if (next === 'denied') {
      disableAnalytics(config?.analyticsMeasurementId ?? null);
    }
    setOpen(false);
    setManaging(false);
  };

  return (
    <section className="cookie-banner" aria-label="Cookie choices" aria-live="polite">
      <div className="cookie-banner-copy">
        <strong>{managing ? 'Your cookie settings' : 'A private choice about analytics'}</strong>
        <p>
          Deck uses essential storage to work. With your permission, Google Analytics also measures
          visits to public pages so we can understand what helps. It stays off unless you accept.
          See our <a href="/cookies">Cookie Policy</a>.
        </p>
      </div>
      <div className="cookie-banner-actions">
        <button type="button" className="site-btn" onClick={() => decide('denied')}>
          Reject optional
        </button>
        <button type="button" className="site-btn is-primary" onClick={() => decide('granted')}>
          Accept analytics
        </button>
      </div>
      {managing && choice ? (
        <button type="button" className="cookie-banner-close" aria-label="Close cookie settings" onClick={() => setOpen(false)}>
          <X size={17} />
        </button>
      ) : null}
    </section>
  );
}
