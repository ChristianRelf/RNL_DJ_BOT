import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { SitePage } from './SiteNav';
import { POSTS, TAGS, findPost, type Post, type TagId } from './blog/posts';

/**
 * The blog, at /blog and /blog/<slug>.
 *
 * Unlike the help centre - which is one page with a filter, because a reader
 * searching a few thousand words of reference finds their answer faster than
 * one clicking through a tree - posts get real URLs. A post is a thing people
 * link to, so it has to survive being pasted into a channel, and the reader
 * has to work on a cold load without a session.
 *
 * The copy lives in blog/posts.tsx; this file is the index, the reader and the
 * chrome around them.
 */

const EMAIL = 'hello@ronation.live';

/** `2026-08-14` -> `14 August 2026`, without pulling in a date library. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const name = MONTHS[month - 1];
  if (!name) return iso;
  return `${day} ${name} ${year}`;
}

function tagName(id: TagId): string {
  return TAGS.find((tag) => tag.id === id)?.name ?? 'Writing';
}

/** Date, topic and length - the three things worth knowing before committing. */
function Meta({ post }: { post: Post }) {
  return (
    <p className="blog-meta">
      <time dateTime={post.date}>{formatDate(post.date)}</time>
      <span aria-hidden="true">·</span>
      <span>{tagName(post.tag)}</span>
      <span aria-hidden="true">·</span>
      <span>{post.minutes} min read</span>
    </p>
  );
}

export function Blog({ slug }: { slug?: string }) {
  const post = slug ? findPost(slug) : undefined;

  // A slug that matches nothing is far more likely to be a stale or mistyped
  // link than a request for the index, so say so rather than silently serving
  // something else and leaving the reader wondering what they clicked.
  if (slug && !post) return <NotFound slug={slug} />;
  if (post) return <Reader post={post} />;
  return <Index />;
}

/* ---------------------------------------------------------------- index */

function Index() {
  const [tag, setTag] = useState<TagId | 'all'>('all');

  const posts = useMemo(
    () => (tag === 'all' ? POSTS : POSTS.filter((post) => post.tag === tag)),
    [tag],
  );

  // Only the tags with something under them, so the filter never offers a
  // topic that leads to an empty page.
  const tags = TAGS.filter((entry) => POSTS.some((post) => post.tag === entry.id));

  const [lead, ...rest] = posts;

  return (
    <SitePage current="/blog">
      <header className="doc-head">
        <h1>Writing</h1>
        <p>
          Longer pieces on mixing, on running a night, and on how the console works underneath.
          Written by the people who build it, and kept in step with what it actually does.
        </p>
      </header>

      <div className="blog-filters" role="group" aria-label="Filter by topic">
        <button
          type="button"
          className={tag === 'all' ? 'is-on' : ''}
          aria-pressed={tag === 'all'}
          onClick={() => setTag('all')}
        >
          All
        </button>
        {tags.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tag === entry.id ? 'is-on' : ''}
            aria-pressed={tag === entry.id}
            onClick={() => setTag(entry.id)}
          >
            {entry.name}
          </button>
        ))}
      </div>

      {/* The newest post of whatever is showing gets the wide card - an index
          where every entry has identical weight gives a reader nowhere to
          start. */}
      {lead ? (
        <a className="blog-lead" href={`/blog/${lead.slug}`}>
          <span className="site-eyebrow">{tagName(lead.tag)}</span>
          <h2>{lead.title}</h2>
          <p className="blog-lead-summary">{lead.summary}</p>
          <Meta post={lead} />
          <span className="blog-more">
            Read it <ArrowRight size={14} />
          </span>
        </a>
      ) : null}

      <div className="blog-grid">
        {rest.map((post) => (
          <a className="blog-card" href={`/blog/${post.slug}`} key={post.slug}>
            <span className="site-eyebrow">{tagName(post.tag)}</span>
            <h3>{post.title}</h3>
            <p>{post.summary}</p>
            <Meta post={post} />
          </a>
        ))}
      </div>

      <section className="doc-next">
        <p>
          Something you would like written about?{' '}
          <a href={`mailto:${EMAIL}?subject=deck%20-%20writing`}>Tell us</a>. If you are looking for
          reference rather than reading, the <a href="/home/help">help centre</a> is the place.
        </p>
      </section>
    </SitePage>
  );
}

/* --------------------------------------------------------------- reader */

function Reader({ post }: { post: Post }) {
  const index = POSTS.indexOf(post);
  const newer = POSTS[index - 1];
  const older = POSTS[index + 1];

  return (
    <SitePage current="/blog">
      <a className="blog-back" href="/blog">
        <ArrowLeft size={14} /> All writing
      </a>

      <article className="blog-post">
        <header className="blog-post-head">
          <span className="site-eyebrow">{tagName(post.tag)}</span>
          <h1>{post.title}</h1>
          <p className="blog-post-summary">{post.summary}</p>
          <Meta post={post} />
        </header>

        <div className="doc-body blog-post-body">{post.body}</div>
      </article>

      {newer || older ? (
        <nav className="blog-adjacent" aria-label="More writing">
          {older ? (
            <a href={`/blog/${older.slug}`}>
              <span className="site-eyebrow">Previous</span>
              <span className="blog-adjacent-title">{older.title}</span>
            </a>
          ) : (
            <span />
          )}
          {newer ? (
            <a className="is-next" href={`/blog/${newer.slug}`}>
              <span className="site-eyebrow">Next</span>
              <span className="blog-adjacent-title">{newer.title}</span>
            </a>
          ) : null}
        </nav>
      ) : null}

      <section className="doc-next">
        <p>
          Written by {post.author}. Questions, corrections or requests:{' '}
          <a href={`mailto:${EMAIL}?subject=deck%20-%20writing`}>{EMAIL}</a>.
        </p>
      </section>
    </SitePage>
  );
}

/* ------------------------------------------------------------ not found */

function NotFound({ slug }: { slug: string }) {
  return (
    <SitePage current="/blog">
      <header className="doc-head">
        <h1>No such post</h1>
        <p>
          There is nothing at <code>/blog/{slug}</code>. It may have been renamed, or the link may
          have been cut short somewhere along the way.
        </p>
      </header>

      <div className="blog-grid">
        {POSTS.slice(0, 4).map((post) => (
          <a className="blog-card" href={`/blog/${post.slug}`} key={post.slug}>
            <span className="site-eyebrow">{tagName(post.tag)}</span>
            <h3>{post.title}</h3>
            <p>{post.summary}</p>
            <Meta post={post} />
          </a>
        ))}
      </div>

      <section className="doc-next">
        <p>
          Or start from <a href="/blog">all the writing</a>.
        </p>
      </section>
    </SitePage>
  );
}
