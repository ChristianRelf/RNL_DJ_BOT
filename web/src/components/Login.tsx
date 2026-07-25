export function Login({ error }: { error: string | null }) {
  return (
    <div className="login">
      <div className="login-card">
        <img className="brand-logo login-logo" src="/deckLogo.png" alt="deck" />
        <p className="login-copy">
          Shared decks for your Discord voice channels. You need to be in the server with a DJ
          role to get in.
        </p>
        {error ? <p className="login-error">{error}</p> : null}
        <a className="btn primary login-btn" href="/api/auth/login">
          SIGN IN WITH DISCORD
        </a>
      </div>
    </div>
  );
}
