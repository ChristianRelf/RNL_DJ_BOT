export function Login({ error }: { error: string | null }) {
  return (
    <div className="login">
      <div className="login-card">
        <div className="brand login-brand">
          <span className="brand-mark">RNL</span>
          <span className="brand-text">DJ</span>
        </div>
        <p className="login-copy">
          A shared DJ rig for your Discord voice channels. Sign in with Discord to reach the
          decks — you need to be a member of the server with a DJ role.
        </p>
        {error ? <p className="login-error">{error}</p> : null}
        <a className="btn primary login-btn" href="/api/auth/login">
          Sign in with Discord
        </a>
      </div>
    </div>
  );
}
