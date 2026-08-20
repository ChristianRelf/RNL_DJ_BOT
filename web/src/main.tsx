import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Home } from './components/Home';
import { Access } from './components/Access';
import { Help } from './components/Help';
import { SignIn } from './components/SignIn';
import { RigPicker } from './components/RigPicker';
import { Portal } from './components/Portal';
import { Onboard } from './components/Onboard';
import { RequestPage, RequestRigPicker } from './components/RequestPage';
import { parseRigPath, parseRequestPath } from './lib/rigs';
import { Legal } from './components/Legal';
import { Blog } from './components/Blog';
import { InviteAccept } from './components/InviteAccept';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * The public pages branch here rather than inside App so they never open a
 * socket or wait on a session - they have to work before you sign in. The
 * server's SPA fallback already serves index.html for these paths.
 *
 * A console belongs to a guild and lives under /g/<slug>; everything above that
 * is the front of house. The bare /deck paths are kept as aliases, because they
 * were handed out when there was only ever one rig to be on.
 */
const rawPath = window.location.pathname.replace(/\/+$/, '');
const path = rawPath.toLowerCase();
const rig = parseRigPath(path);
const requestSlug = parseRequestPath(path);
// Post slugs are lowercase kebab-case, so the lowercased path is safe to read.
const blogSlug = /^\/blog\/([a-z0-9-]+)$/.exec(path)?.[1];

function page() {
  // Tokens are base64url and case-sensitive, so extract from the untouched URL.
  const inviteToken = rawPath.match(/^\/invite\/([A-Za-z0-9_-]+)$/)?.[1];
  if (inviteToken) return <InviteAccept token={inviteToken} />;
  // A post is a link people paste into a channel, so it is a real URL rather
  // than a filter on the index - it has to survive a cold load with no session.
  // It goes ahead of the request page because the short /<slug>/request form is
  // also two segments deep, and would otherwise read /blog/request as a rig.
  if (blogSlug) return <Blog slug={blogSlug} />;
  // Before the console: the request page is for people who are in the Discord
  // server and have no DJ role, so it must never mount App - that opens a
  // socket the server would refuse them.
  if (requestSlug) return <RequestPage slug={requestSlug} />;
  if (rig) return <App slug={rig.slug} view={rig.view} />;

  switch (path) {
    case '/deck':
      // One rig used to be the only rig. Send them to the picker, which passes
      // straight through when there is still only one.
      return <RigPicker />;
    case '/deck/tools':
      return <RigPicker view="tools" />;
    case '/terms':
      return <Legal page="terms" />;
    case '/privacy':
      return <Legal page="privacy" />;
    // The cookie and accessibility policies. Both carry the spellings other
    // sites link to, because an inbound link to the wrong one of these should
    // not land on the sign-in door.
    case '/cookies':
    case '/cookie-policy':
      return <Legal page="cookies" />;
    case '/accessibility':
    case '/accessibility-statement':
    case '/a11y':
      return <Legal page="accessibility" />;

    // Front of house sits under /home. The bare paths are kept as aliases so
    // links handed out before the restructure still land somewhere sensible.
    case '/home':
      return <Home />;
    // /license and /home/license are kept as aliases: they were handed out
    // before access moved to a waitlist.
    case '/home/access':
    case '/home/license':
    case '/license':
      return <Access />;
    // The booth guide became the help centre; its old paths still land here.
    case '/home/help':
    case '/home/guides':
    case '/home/guide':
    case '/guide':
      return <Help />;
    // The writing. /home/blog is accepted because everything else front of
    // house sits under /home and people guess accordingly.
    case '/blog':
    case '/home/blog':
    case '/writing':
      return <Blog />;
    case '/rigs':
      return <RigPicker />;
    // Requests with no rig named. Passes through when only one is taking them.
    case '/request':
      return <RequestRigPicker />;
    // Reached on its own hostname, which the server redirects here, and
    // directly on the main host so it works where there is no second name.
    case '/portal':
      return <Portal />;
    case '/onboard':
      return <Onboard />;
    // `/` and /login are both the front door; a live session goes on to a rig.
    default:
      return <SignIn checkSession />;
  }
}

createRoot(container).render(<StrictMode>{page()}</StrictMode>);
