import { Colophon } from './Colophon';

/**
 * Shared chrome for the public pages — the pitch, the docs and the guide.
 * The console and the sign-in page deliberately do without it.
 */

const LINKS = [
  { href: '/license', label: 'Product' },
  { href: '/setup', label: 'Setup' },
  { href: '/guide', label: 'Guide' },
  { href: '/license#licensing', label: 'Licensing' },
];

export function SiteNav({ current }: { current?: string }) {
  return (
    <nav className="lic-nav">
      <a href="/" className="lic-nav-brand" aria-label="deck">
        <img src="/deckLogo.png" alt="deck" />
      </a>
      <div className="lic-nav-links">
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
      </div>
      <a className="btn tiny lic-nav-cta" href="/login">
        SIGN IN
      </a>
    </nav>
  );
}

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
  children: React.ReactNode;
}) {
  return (
    <div className="lic">
      <SiteNav current={current} />
      <div className="doc">
        <header className="doc-head">
          <h1>{title}</h1>
          <p>{lede}</p>
        </header>
        {children}
        <footer className="lic-foot">
          <Colophon block />
        </footer>
      </div>
    </div>
  );
}

/** A numbered step with a heading, used by the setup walkthrough. */
export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="doc-step">
      <span className="doc-step-index">{n}</span>
      <div className="doc-step-body">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

/** Fenced block for commands and config. */
export function Code({ children }: { children: string }) {
  return <pre className="doc-code">{children}</pre>;
}
