import { useEffect, useState } from 'react';
import { Colophon } from './Colophon';

interface SignInProps {
  /** Reason the last attempt was refused, if there was one. */
  error?: string | null;
  /**
   * Set on the front-door routes, where someone may arrive already signed in
   * and should be sent through to the console. App renders this component
   * directly once it already knows there is no session, and skips the check.
   */
  checkSession?: boolean;
}

/**
 * The front door. Serves both `/` for signed-out visitors and the standalone
 * `/login` route the OAuth callback redirects failures to.
 */
export function SignIn({ error, checkSession }: SignInProps) {
  const [checking, setChecking] = useState(Boolean(checkSession));

  // /login is also where the callback drops people when sign-in was refused.
  // Read once, lazily, and never during a render that has no window.
  const [queryError] = useState(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('error'),
  );
  const reason = error ?? queryError;

  useEffect(() => {
    if (!checkSession) return;
    let cancelled = false;
    fetch('/api/me', { credentials: 'include' })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) window.location.replace('/deck');
        else setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [checkSession]);

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
      <main className="signin-card">
        <img className="signin-logo" src="/deckLogo.png" alt="deck" />

        <p className="signin-tagline">Shared decks for Discord.</p>

        {reason ? <p className="signin-error">{reason}</p> : null}

        <div className="signin-actions">
          <a className="btn primary signin-btn" href="/api/auth/login">
            Sign in with Discord
          </a>
          <a className="btn signin-btn signin-btn-ghost" href="/license">
            Find out more
          </a>
        </div>

        <p className="signin-note">
          Sign-in happens at Discord — no new account, and we never see your password. You need the
          DJ role to reach the decks.
        </p>
      </main>

      <footer className="signin-foot">
        <p className="signin-consent">
          By signing in you accept the <a href="/terms">Terms</a> and{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
        <Colophon block />
      </footer>
    </div>
  );
}
