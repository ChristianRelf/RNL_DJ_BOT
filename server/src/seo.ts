/**
 * Route metadata for the public site.
 *
 * Deck is a client-rendered app, but search crawlers and social link unfurlers
 * need the right metadata in the first HTML response. The server applies this
 * map to the built shell before sending it; private and unknown routes receive
 * an explicit noindex directive.
 */

const ORIGIN = 'https://deck.ronation.live';
const SHARE_IMAGE = `${ORIGIN}/social/deck-og.png`;

interface ArticleMeta {
  title: string;
  description: string;
  published: string;
}

interface SeoMeta {
  title: string;
  description: string;
  canonical: string | null;
  index: boolean;
  type: 'website' | 'article';
  published?: string;
  structuredData?: Record<string, unknown>;
}

const ARTICLES: Record<string, ArticleMeta> = {
  '/blog/what-happens-to-your-audio': {
    title: 'What Actually Happens to Your Audio | Deck',
    description: 'Follow a track from a laptop to a Discord voice channel in twenty-millisecond steps, including mixing, encoding and delivery.',
    published: '2026-08-14',
  },
  '/blog/gain-staging-for-a-voice-channel': {
    title: 'Gain Staging for a Voice Channel | Deck',
    description: 'A practical guide to clean DJ gain staging when the finished mix is delivered through a voice codec.',
    published: '2026-08-07',
  },
  '/blog/beatmatching-by-ear': {
    title: 'Beatmatching by Ear, and Why the Numbers Lie | Deck',
    description: 'Learn to hear tempo drift, choose the right correction and use detected BPM as a starting point rather than an answer.',
    published: '2026-07-29',
  },
  '/blog/your-first-hour-behind-the-decks': {
    title: 'Your First Hour Behind the Decks | Deck',
    description: 'A realistic first DJ session: what to prepare, what to ignore and the smallest set of skills needed to complete an hour.',
    published: '2026-07-18',
  },
  '/blog/running-a-night-with-more-than-one-dj': {
    title: 'Running a Night With More Than One DJ | Deck',
    description: 'Plan handovers, back-to-backs and the shared queue so a multi-DJ night feels like one event rather than a series of interruptions.',
    published: '2026-07-09',
  },
  '/blog/the-isolator-is-not-an-eq': {
    title: 'The Isolator Is Not an EQ | Deck',
    description: 'Understand the low, mid and high isolator bands, hard kills and the performance techniques they make possible.',
    published: '2026-06-27',
  },
};

const PUBLIC_PAGES: Record<string, Pick<SeoMeta, 'title' | 'description'> & { structuredData?: Record<string, unknown> }> = {
  '/home': {
    title: 'Deck — Live DJ Mixing for Discord',
    description: 'Run live DJ sets in Discord with two browser-based decks, a full mixer and a private shared music library.',
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://ronation.live/#organization',
          name: 'RO. Nation LIVE',
          url: 'https://ronation.live',
        },
        {
          '@type': 'WebSite',
          '@id': `${ORIGIN}/#website`,
          name: 'Deck',
          url: `${ORIGIN}/home`,
          publisher: { '@id': 'https://ronation.live/#organization' },
        },
        {
          '@type': 'SoftwareApplication',
          '@id': `${ORIGIN}/home#software`,
          name: 'Deck',
          applicationCategory: 'MultimediaApplication',
          operatingSystem: 'Web browser',
          url: `${ORIGIN}/home`,
          image: SHARE_IMAGE,
          description: 'A managed browser DJ console that broadcasts a live mix into a Discord voice channel.',
          featureList: [
            'Two live audio decks',
            'Three-band mixer and crossfader',
            'Private shared music library',
            'Audience requests and operator handover',
            'Sample pads, effects and MIDI mapping',
          ],
          offers: {
            '@type': 'Offer',
            price: '5.00',
            priceCurrency: 'USD',
            availability: 'https://schema.org/LimitedAvailability',
            url: `${ORIGIN}/home/access`,
          },
          provider: { '@id': 'https://ronation.live/#organization' },
        },
      ],
    },
  },
  '/home/access': {
    title: 'Get Deck for Your Discord Server',
    description: 'Request access to Deck for $5 per rig each month, including managed setup and 2.5 GB of private Deck Cloud storage.',
  },
  '/home/help': {
    title: 'Deck Help Centre',
    description: 'Guides for Deck’s browser DJ console, including decks, mixing, libraries, requests, MIDI and Discord voice setup.',
  },
  '/blog': {
    title: 'Deck Writing — DJ Technique and Live Discord Audio',
    description: 'Practical writing on DJ technique, running multi-DJ nights and the audio engineering behind Deck.',
  },
  '/terms': {
    title: 'Deck Terms of Service',
    description: 'Deck terms covering the $5 monthly plan, recurring billing, cancellation and refunds, cloud storage, hosted rigs and acceptable use.',
  },
  '/privacy': {
    title: 'Deck Privacy Policy',
    description: 'How Deck handles Discord identity, Stripe subscription records, uploaded music, browser storage and service providers.',
  },
  '/cookies': {
    title: 'Deck Cookie Policy',
    description: 'The essential session and sign-in cookies used by Deck, plus the browser storage used by the console.',
  },
  '/accessibility': {
    title: 'Deck Accessibility Statement',
    description: 'Accessibility support, keyboard controls and known limitations for the Deck browser DJ console.',
  },
};

function articleStructuredData(pathname: string, article: ArticleMeta): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title.replace(/ \| Deck$/, ''),
    description: article.description,
    datePublished: article.published,
    dateModified: article.published,
    mainEntityOfPage: `${ORIGIN}${pathname}`,
    author: { '@type': 'Organization', name: 'RO. Nation LIVE', url: 'https://ronation.live' },
    publisher: { '@type': 'Organization', name: 'RO. Nation LIVE', url: 'https://ronation.live' },
    image: SHARE_IMAGE,
  };
}

export function seoForPath(input: string): SeoMeta {
  const pathname = (input.replace(/\/+$/, '') || '/').toLowerCase();
  const article = ARTICLES[pathname];
  if (article) {
    return {
      ...article,
      canonical: `${ORIGIN}${pathname}`,
      index: true,
      type: 'article',
      structuredData: articleStructuredData(pathname, article),
    };
  }

  const page = PUBLIC_PAGES[pathname];
  if (page) {
    return {
      ...page,
      canonical: `${ORIGIN}${pathname}`,
      index: true,
      type: 'website',
    };
  }

  return {
    title: 'Deck',
    description: 'The browser DJ console for Discord.',
    canonical: null,
    index: false,
    type: 'website',
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function beforeHead(html: string, tag: string): string {
  return html.replace('</head>', `    ${tag}\n  </head>`);
}

function upsertMeta(html: string, attribute: 'name' | 'property', key: string, value: string): string {
  const pattern = new RegExp(`<meta\\s+${attribute}=["']${escapeRegExp(key)}["'][^>]*>`, 'i');
  const tag = `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(value)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : beforeHead(html, tag);
}

function removeMeta(html: string, attribute: 'name' | 'property', key: string): string {
  const pattern = new RegExp(`\\s*<meta\\s+${attribute}=["']${escapeRegExp(key)}["'][^>]*>`, 'i');
  return html.replace(pattern, '');
}

function setCanonical(html: string, canonical: string | null): string {
  const pattern = /\s*<link\s+rel=["']canonical["'][^>]*>/i;
  if (!canonical) return html.replace(pattern, '');
  const tag = `<link rel="canonical" href="${escapeHtml(canonical)}" />`;
  return pattern.test(html) ? html.replace(pattern, `\n    ${tag}`) : beforeHead(html, tag);
}

function setStructuredData(html: string, data?: Record<string, unknown>): string {
  const pattern = /\s*<script\s+id=["']route-structured-data["'][^>]*>[\s\S]*?<\/script>/i;
  if (!data) return html.replace(pattern, '');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const tag = `<script id="route-structured-data" type="application/ld+json">${json}</script>`;
  return pattern.test(html) ? html.replace(pattern, `\n    ${tag}`) : beforeHead(html, tag);
}

function setHeroPreload(html: string, enabled: boolean): string {
  const pattern = /\s*<link\s+rel=["']preload["'][^>]*href=["']\/screenshots\/deck-console\.png["'][^>]*>/i;
  return enabled ? html : html.replace(pattern, '');
}

/** Applies route-specific metadata to the already-built Vite HTML shell. */
export function renderSeoShell(shell: string, routePath: string): string {
  const meta = seoForPath(routePath);
  let html = shell.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);

  html = upsertMeta(html, 'name', 'description', meta.description);
  html = upsertMeta(
    html,
    'name',
    'robots',
    meta.index
      ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
      : 'noindex,nofollow',
  );
  html = upsertMeta(html, 'property', 'og:site_name', 'Deck');
  html = upsertMeta(html, 'property', 'og:locale', 'en_GB');
  html = upsertMeta(html, 'property', 'og:type', meta.type);
  html = upsertMeta(html, 'property', 'og:title', meta.title);
  html = upsertMeta(html, 'property', 'og:description', meta.description);
  html = upsertMeta(html, 'property', 'og:url', meta.canonical ?? `${ORIGIN}${routePath}`);
  html = upsertMeta(html, 'property', 'og:image', SHARE_IMAGE);
  html = upsertMeta(html, 'property', 'og:image:type', 'image/png');
  html = upsertMeta(html, 'property', 'og:image:width', '1200');
  html = upsertMeta(html, 'property', 'og:image:height', '630');
  html = upsertMeta(html, 'property', 'og:image:alt', 'Deck live DJ mixing console for Discord');
  html = upsertMeta(html, 'name', 'twitter:card', 'summary_large_image');
  html = upsertMeta(html, 'name', 'twitter:title', meta.title);
  html = upsertMeta(html, 'name', 'twitter:description', meta.description);
  html = upsertMeta(html, 'name', 'twitter:image', SHARE_IMAGE);
  html = setCanonical(html, meta.canonical);
  html = setStructuredData(html, meta.structuredData);
  html = setHeroPreload(html, meta.canonical === `${ORIGIN}/home`);

  if (meta.type === 'article' && meta.published) {
    html = upsertMeta(html, 'property', 'article:published_time', meta.published);
    html = upsertMeta(html, 'property', 'article:author', 'RO. Nation LIVE');
  } else {
    html = removeMeta(html, 'property', 'article:published_time');
    html = removeMeta(html, 'property', 'article:author');
  }

  return html;
}
