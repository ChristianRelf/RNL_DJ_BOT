import { useEffect, useState } from 'react';
import { Colophon } from './Colophon';

/**
 * The dedicated sign-in page.
 *
 * This is where the OAuth callback sends people when sign-in fails, so the
 * reason lands next to the button that failed rather than on the marketing
 * page. Anyone who is already signed in gets bounced straight to the console —
 * there is nothing useful here for them.
 */
export function LoginPage() {
  const [checking, setChecking] = useState(true);

  // The reason sign-in was refused: wrong role, state mismatch, and so on.
  const error = new URLSearchParams(window.location.search).get('error');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { credentials: 'include' })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) window.location.replace('/');
        else setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <div className="boot">
        <div className="boot-spinner" />
        <p>checking your session</p>
      </div>
    );
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <a href="/home" className="signin-logo-link">
          <img className="brand-logo signin-logo" src="/deckLogo.png" alt="deck" />
        </a>

        <div className="signin-copy">
          <h1>Sign in</h1>
          <p>
            Sign-in happens at Discord — no new account, and we never see your password. You need
            to be in the server with the DJ role to reach the decks.
          </p>
        </div>

        {error ? <p className="login-error">{error}</p> : null}

        <a className="btn primary signin-btn" href="/api/auth/login">
          SIGN IN WITH DISCORD
        </a>

        <p className="signin-consent">
          By signing in you accept the <a href="/terms">Terms</a> and{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <div className="signin-foot">
          <a href="/home">What is deck?</a>
          <Colophon />
        </div>
      </div>
    </div>
  );
}
