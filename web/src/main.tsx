import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Legal } from './components/Legal';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// The legal pages branch here rather than inside App so they never open a
// socket or wait on a session — they have to be readable before you sign in.
// The server's SPA fallback serves index.html for these paths already.
const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
const legal = path === '/terms' ? 'terms' : path === '/privacy' ? 'privacy' : null;

createRoot(container).render(
  <StrictMode>{legal ? <Legal page={legal} /> : <App />}</StrictMode>,
);
