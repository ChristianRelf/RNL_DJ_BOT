import { useEffect, useRef, useState } from 'react';

/**
 * The feature list, as a rack of modules.
 *
 * Six panels of specification is a lot to put in front of someone, so it is
 * built the way the console is: a channel list on the left that tells you where
 * you are, and one module lit at a time on the right. Scrolling racks through
 * them; clicking a name jumps to it. The lit row is whichever module is
 * crossing the middle of the screen, which is the one you are reading.
 */

export type Module = {
  kicker: string;
  title: string;
  body: string;
  points: readonly string[];
};

export function Rack({ items }: { items: readonly Module[] }) {
  const panels = useRef<Array<HTMLElement | null>>([]);
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    const nodes = panels.current.filter(Boolean) as HTMLElement[];
    if (!nodes.length || typeof IntersectionObserver === 'undefined') {
      setSeen(new Set(items.map((_, index) => index)));
      return;
    }

    // Two jobs, two observers: one lights the rows as they arrive and never
    // takes the light back, the other tracks the narrow band across the middle
    // of the screen that decides which module is the current one.
    const arrive = new IntersectionObserver(
      (entries) => {
        const fresh = entries.filter((entry) => entry.isIntersecting);
        if (!fresh.length) return;
        setSeen((prev) => {
          const next = new Set(prev);
          for (const entry of fresh) next.add(Number((entry.target as HTMLElement).dataset.index));
          return next;
        });
      },
      { rootMargin: '0px 0px -15% 0px' },
    );

    const centre = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );

    nodes.forEach((node) => {
      arrive.observe(node);
      centre.observe(node);
    });
    return () => {
      arrive.disconnect();
      centre.disconnect();
    };
  }, [items]);

  return (
    <div className="rack">
      <div className="rack-index" aria-hidden="true">
        <span className="rack-count mono">
          {String(active + 1).padStart(2, '0')}
          <i>/{String(items.length).padStart(2, '0')}</i>
        </span>
        <ul>
          {items.map((item, index) => (
            <li key={item.title} className={index === active ? 'is-active' : ''}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() =>
                  panels.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                <span className="rack-led" />
                {item.kicker}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rack-modules">
        {items.map((item, index) => (
          <article
            key={item.title}
            data-index={index}
            ref={(node) => {
              panels.current[index] = node;
            }}
            className={`rack-module ${seen.has(index) ? 'is-seen' : ''} ${index === active ? 'is-active' : ''}`}
          >
            <header>
              <span className="rack-module-kicker site-eyebrow">{item.kicker}</span>
              <span className="rack-module-no mono">{String(index + 1).padStart(2, '0')}</span>
            </header>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
            <ul className="rack-checks">
              {item.points.map((point, row) => (
                <li key={point} style={{ transitionDelay: `${row * 70}ms` }}>
                  <span className="rack-check-led" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
