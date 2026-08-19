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
import { parseRigPath } from './lib/rigs';
import { Legal } from './components/Legal';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * The public pages branch here rather than inside App so they never open a
 * socket or wait on a session — they have to work before you sign in. The
 * server's SPA fallback already serves index.html for these paths.
 *
 * A console belongs to a guild and lives under /g/<slug>; everything above that
 * is the front of house. The bare /deck paths are kept as aliases, because they
 * were handed out when there was only ever one rig to be on.
 */
const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
const rig = parseRigPath(path);

function page() {
  if (rig) return <App slug={rig.slug} view={rig.view} />;

  switch (path) {
    case '/deck':
    case '/deck/tools':
      // One rig used to be the only rig. Send them to the picker, which passes
      // straight through when there is still only one.
      return <RigPicker />;
    case '/terms':
      return <Legal page="terms" />;
    case '/privacy':
      return <Legal page="privacy" />;

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
    case '/rigs':
      return <RigPicker />;
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
