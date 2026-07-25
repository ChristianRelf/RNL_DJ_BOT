import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Home } from './components/Home';
import { License } from './components/License';
import { Setup } from './components/Setup';
import { Guide } from './components/Guide';
import { SignIn } from './components/SignIn';
import { Legal } from './components/Legal';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * The public pages branch here rather than inside App so they never open a
 * socket or wait on a session — they have to work before you sign in. The
 * server's SPA fallback already serves index.html for these paths.
 *
 * The console lives under /deck; everything above it is the front of house.
 */
const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();

function page() {
  switch (path) {
    case '/deck':
      return <App view="console" />;
    case '/deck/tools':
      return <App view="tools" />;
    case '/terms':
      return <Legal page="terms" />;
    case '/privacy':
      return <Legal page="privacy" />;

    // Front of house sits under /home. The bare paths are kept as aliases so
    // links handed out before the restructure still land somewhere sensible.
    case '/home':
      return <Home />;
    case '/home/license':
    case '/license':
      return <License />;
    case '/home/setup':
    case '/setup':
      return <Setup />;
    case '/home/guides':
    case '/home/guide':
    case '/guide':
      return <Guide />;
    // `/` and /login are both the front door; a live session goes on to /deck.
    default:
      return <SignIn checkSession />;
  }
}

createRoot(container).render(<StrictMode>{page()}</StrictMode>);
