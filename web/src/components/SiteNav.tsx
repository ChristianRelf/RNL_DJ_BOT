import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';

/**
 * Shared chrome for the public pages - the pitch, the docs, the guide and the
 * legal pages. The console and the sign-in door deliberately do without it.
 *
 * Everything front-of-house is built from the four pieces here: the nav, the
 * page shell, a section with a label above its heading, and the footer. Pages
 * supply content and nothing else, so they stay consistent with each other by
 * construction rather than by everyone remembering to.
 */

const LINKS = [
  { href: '/home', label: 'Product' },
  { href: '/home/help', label: 'Help centre' },
  { href: '/home/access', label: 'Get access' },
];

export function SiteNav({ current }: { current?: string }) {
  const [open, setOpen] = useState(false);
  const [lifted, setLifted] = useState(false);

  // The bar is transparent over the hero and takes on a surface once the page
  // has moved under it, so it never sits as a hard band across the artwork.
  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // A menu left open behind a resize into the desktop layout would keep the
  // page scroll-locked with nothing on screen to close it.
  useEffect(() => {
    if (!open) return;
    const onResize = () => window.innerWidth > 760 && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav className={`site-nav ${lifted ? 'is-lifted' : ''} ${open ? 'is-open' : ''}`}>
      <div className="site-nav-inner">
        {/* The mark goes to the product page, not to `/` - `/` is the sign-in
            door, which is not where someone browsing wants to land. */}
        <a href="/home" className="site-nav-brand" aria-label="deck">
          <img src="/deckLogo.png" alt="deck" />
        </a>

        <div className="site-nav-links" id="site-nav-links">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={current === link.href ? 'is-current' : ''}
              aria-current={current === link.href ? 'page' : undefined}
            >
              {link.label}
            </a>
          ))}
          <a className="site-nav-signin" href="/login">
            Sign in
          </a>
        </div>

        <button
          type="button"
          className="site-nav-toggle"
          aria-expanded={open}
          aria-controls="site-nav-links"
          aria-label={open ? 'Close menu' : 'Menu'}
          onClick={() => setOpen((on) => !on)}
        >
          {open ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>
    </nav>
  );
}

/* --------------------------------------------------------------- shell */

/** Wraps every public page: nav, a measured column, and the footer. */
export function SitePage({
  current,
  children,
  wide,
  bleed,
}: {
  current?: string;
  children: ReactNode;
  /** The wider pages drop the text measure; the long-form pages keep it. */
  wide?: boolean;
  /**
   * The landing page runs to the edges of the window and holds its own
   * measure per section, because its hero and its closing panel are artwork
   * rather than paragraphs. Nothing else needs this.
   */
  bleed?: boolean;
}) {
  return (
    <div className={`site ${bleed ? 'is-bleed' : ''}`}>
      <SiteNav current={current} />
      <main className={`site-main ${wide ? 'is-wide' : ''} ${bleed ? 'is-bleed' : ''}`}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

const FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/home', label: 'Overview' },
      { href: '/home/access', label: 'Get access' },
      { href: '/login', label: 'Sign in' },
    ],
  },
  {
    title: 'Documentation',
    links: [
      { href: '/home/help', label: 'Help centre' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="site-foot-inner">
        <div className="site-foot-brand">
          <img src="/deckLogo.png" alt="deck" />
          <p>Two decks, a mixer and your crew - live in a Discord voice channel.</p>
        </div>

        <div className="site-foot-cols">
          {FOOTER.map((column) => (
            <div className="site-foot-col" key={column.title}>
              <span className="site-eyebrow">{column.title}</span>
              {column.links.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="site-foot-base">
        <a href="https://ronation.live">Powered by RO Nation Live</a>
        <span>Run for you · no telemetry</span>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------ sections */

/** A section with a small label above its heading, and an optional lede. */
export function Section({
  eyebrow,
  title,
  lede,
  id,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="site-section" id={id}>
      <header className="site-section-head">
        <span className="site-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {lede ? <p>{lede}</p> : null}
      </header>
      {children}
    </section>
  );
}

/* --------------------------------------------------------- doc pages */

/**
 * Page shell for the long-form pages. Gives them the same measure, rhythm and
 * footer as each other without each one rebuilding it.
 */
export function DocPage({
  title,
  lede,
  current,
  children,
}: {
  title: string;
  lede: string;
  current?: string;
  children: ReactNode;
}) {
  return (
    <SitePage current={current}>
      <header className="doc-head">
        <h1>{title}</h1>
        <p>{lede}</p>
      </header>
      {children}
    </SitePage>
  );
}
