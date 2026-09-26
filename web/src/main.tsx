import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { parseRigPath, parseRequestPath } from './lib/rigs';
import { CookieConsent } from './components/CookieConsent';
import './styles.css';

// Public traffic should not download the full console, audio-hosting and portal
// code before it can read the first headline. Each route family gets its own
// chunk and the browser only fetches the one it is about to render.
const App = lazy(() => import('./App'));
const Home = lazy(() => import('./components/Home').then((module) => ({ default: module.Home })));
const Access = lazy(() => import('./components/Access').then((module) => ({ default: module.Access })));
const Help = lazy(() => import('./components/Help').then((module) => ({ default: module.Help })));
const SignIn = lazy(() => import('./components/SignIn').then((module) => ({ default: module.SignIn })));
const RigPicker = lazy(() => import('./components/RigPicker').then((module) => ({ default: module.RigPicker })));
const Portal = lazy(() => import('./components/Portal').then((module) => ({ default: module.Portal })));
const Onboard = lazy(() => import('./components/Onboard').then((module) => ({ default: module.Onboard })));
const RequestPage = lazy(() => import('./components/RequestPage').then((module) => ({ default: module.RequestPage })));
const RequestRigPicker = lazy(() => import('./components/RequestPage').then((module) => ({ default: module.RequestRigPicker })));
const Legal = lazy(() => import('./components/Legal').then((module) => ({ default: module.Legal })));
const Blog = lazy(() => import('./components/Blog').then((module) => ({ default: module.Blog })));
const InviteAccept = lazy(() => import('./components/InviteAccept').then((module) => ({ default: module.InviteAccept })));
const BroadcastOverlay = lazy(() => import('./components/BroadcastOverlay').then((module) => ({ default: module.BroadcastOverlay })));
const BugReport = lazy(() => import('./components/BugReport').then((module) => ({ default: module.BugReport })));

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
    // /license and /home/license are kept as aliases from earlier versions of
    // the purchase page.
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
    case '/home/help/report-a-bug':
      return <BugReport />;
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
    case '/overlay':
      return <BroadcastOverlay />;
    // Authentication keeps its own URL; the bare host is redirected to /home.
    case '/login':
      return <SignIn checkSession />;
    default:
      return <SignIn checkSession />;
  }
}

if (path === '') {
  window.location.replace('/home');
} else {
  createRoot(container).render(
    <StrictMode>
      <Suspense fallback={<div className="boot"><div className="boot-spinner" /></div>}>
        {page()}
      </Suspense>
      <CookieConsent />
    </StrictMode>,
  );
}
