import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Home } from './components/Home';
import { Legal } from './components/Legal';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * The standalone pages branch here rather than inside App so they never open a
 * socket or wait on a session — they have to work before you sign in, and
 * /home has to stay linkable after you have. The server's SPA fallback already
 * serves index.html for these paths.
 *
 * `/` itself is App, which shows the console to a signed-in operator and the
 * home page to everyone else.
 */
const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();

function page() {
  switch (path) {
    case '/terms':
      return <Legal page="terms" />;
    case '/privacy':
      return <Legal page="privacy" />;
    case '/home':
      return <Home />;
    default:
      return <App />;
  }
}

createRoot(container).render(<StrictMode>{page()}</StrictMode>);
