export type AnalyticsConsent = 'granted' | 'denied';

export interface SiteConfig {
  analyticsMeasurementId: string | null;
  bugReportsConfigured: boolean;
}

const CONSENT_KEY = 'deck_analytics_consent_v1';
const CONSENT_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
let configRequest: Promise<SiteConfig> | null = null;
let loadedMeasurementId: string | null = null;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function getSiteConfig(): Promise<SiteConfig> {
  configRequest ??= fetch('/api/site-config', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Site configuration is unavailable.');
      return response.json() as Promise<SiteConfig>;
    })
    .catch((error) => {
      configRequest = null;
      throw error;
    });
  return configRequest;
}

export function readAnalyticsConsent(): AnalyticsConsent | null {
  try {
    const stored = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? 'null') as {
      choice?: AnalyticsConsent;
      at?: number;
    } | null;
    if (!stored?.choice || !stored.at || Date.now() - stored.at > CONSENT_LIFETIME_MS) {
      localStorage.removeItem(CONSENT_KEY);
      return null;
    }
    return stored.choice;
  } catch {
    return null;
  }
}

export function saveAnalyticsConsent(choice: AnalyticsConsent): void {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice, at: Date.now() }));
  } catch {
    // A browser that blocks storage still gets a private, analytics-free visit.
  }
}

/** Analytics is restricted to public editorial and marketing pages. Console,
 * account, request, invite and checkout-return routes are intentionally out. */
export function isAnalyticsPage(pathname = window.location.pathname): boolean {
  const path = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return path === '/home' || path === '/home/access' || path === '/home/help' ||
    path === '/home/help/report-a-bug' || path === '/blog' || path.startsWith('/blog/') ||
    path === '/terms' || path === '/privacy' || path === '/cookies' || path === '/accessibility';
}

function gtag(...args: unknown[]): void {
  window.dataLayer ??= [];
  window.dataLayer.push(args);
}

export function enableAnalytics(measurementId: string): void {
  if (!measurementId || !isAnalyticsPage()) return;
  const flags = window as unknown as Record<string, unknown>;
  flags[`ga-disable-${measurementId}`] = false;

  window.dataLayer ??= [];
  window.gtag = gtag;
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });
  gtag('consent', 'update', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });

  if (loadedMeasurementId === measurementId) return;
  loadedMeasurementId = measurementId;
  const script = document.createElement('script');
  script.async = true;
  script.id = 'deck-google-analytics';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);

  gtag('js', new Date());
  gtag('config', measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  // Never send query strings: checkout status, invite hints and search terms do
  // not belong in a marketing analytics property.
  gtag('event', 'page_view', {
    page_location: `${window.location.origin}${window.location.pathname}`,
    page_path: window.location.pathname,
    page_title: document.title,
  });
}

export function disableAnalytics(measurementId: string | null): void {
  if (measurementId) {
    const flags = window as unknown as Record<string, unknown>;
    flags[`ga-disable-${measurementId}`] = true;
  }
  window.gtag?.('consent', 'update', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });

  // Withdrawing consent should also remove first-party GA identifiers where
  // the browser lets this page do so.
  for (const name of document.cookie.split(';').map((part) => part.trim().split('=')[0])) {
    if (name !== '_ga' && !name.startsWith('_ga_')) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.ronation.live; SameSite=Lax`;
  }
}

export function openCookieSettings(): void {
  window.dispatchEvent(new CustomEvent('deck:cookie-settings'));
}

