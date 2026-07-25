import { Code, DocPage, Step } from './SiteNav';

/**
 * Self-hosting walkthrough, for licensees standing up their own instance.
 *
 * Every command, path, variable and default here is taken from the repository —
 * the compose file, the Dockerfile and .env.example. If any of those change,
 * change this with them.
 */

const ENV_REQUIRED = [
  ['DISCORD_BOT_TOKEN', 'The bot token from the Bot tab.'],
  ['DISCORD_CLIENT_ID', 'The application ID from the OAuth2 tab.'],
  ['DISCORD_CLIENT_SECRET', 'The OAuth2 client secret.'],
  ['DISCORD_GUILD_ID', 'The Discord server deck serves.'],
  ['SESSION_SECRET', 'A long random string. Sessions are signed with it.'],
];

const ENV_OPTIONAL = [
  ['DJ_ROLE_IDS', '(all members)', 'Roles allowed into the booth, comma separated.'],
  ['ADMIN_ROLE_IDS', '(none)', 'Roles that can force-take control and delete any upload.'],
  ['ADMIN_USER_IDS', '(none)', 'Individual admins, by Discord user ID.'],
  ['PUBLIC_URL', 'http://localhost:7403', 'Must match the registered redirect URI exactly.'],
  ['PORT', '7403', 'Port the container publishes on.'],
  ['DATA_DIR', './data', 'Uploads, decoded audio and the track database.'],
  ['MAX_UPLOAD_MB', '100', 'Largest file the pool will accept.'],
  ['CONTROL_IDLE_TIMEOUT_S', '180', 'Idle time before control passes — only when someone is waiting.'],
  ['CONTROL_DISCONNECT_GRACE_S', '20', 'How long control is held after the last tab closes.'],
  ['LOG_LEVEL', 'info', 'error, warn, info or debug.'],
];

export function Setup() {
  return (
    <DocPage
      current="/setup"
      title="Setting it up"
      lede="deck runs as a single container against your own Discord application. Start to finish this takes about fifteen minutes, most of it in the Discord developer portal."
    >
      <section className="doc-callout">
        <h2>Before you start</h2>
        <ul>
          <li>A machine with Docker and Docker Compose.</li>
          <li>A Discord server you can administer.</li>
          <li>
            For anything public, a domain and a reverse proxy. ffmpeg and the Opus encoder are
            already inside the image — you do not install those yourself.
          </li>
        </ul>
      </section>

      <Step n={1} title="Create a Discord application">
        <p>
          Go to the{' '}
          <a href="https://discord.com/developers/applications">Discord developer portal</a> and
          create an application. You need three things off it, and one setting.
        </p>
        <ul>
          <li>
            <strong>Bot tab</strong> — add a bot and copy the token.
          </li>
          <li>
            <strong>OAuth2 tab</strong> — copy the client ID and client secret, then add the
            redirect URI. It has to match <code>PUBLIC_URL</code> exactly:
          </li>
        </ul>
        <Code>{`http://localhost:7403/api/auth/callback`}</Code>
        <p>
          Invite the bot with the <code>bot</code> and <code>applications.commands</code> scopes,
          and the <strong>Connect</strong> and <strong>Speak</strong> permissions. No privileged
          intents are needed.
        </p>
      </Step>

      <Step n={2} title="Configure it">
        <Code>{`cp .env.example .env`}</Code>
        <p>Fill in the five required values:</p>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>What it is</th>
              </tr>
            </thead>
            <tbody>
              {ENV_REQUIRED.map(([name, note]) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="doc-note">
          Leaving <code>DJ_ROLE_IDS</code> empty lets any member of the server into the booth. On a
          public server, set it.
        </p>
      </Step>

      <Step n={3} title="Run it">
        <Code>{`docker compose up -d --build`}</Code>
        <p>
          Open <code>http://localhost:7403</code>, sign in with Discord, press{' '}
          <strong>Take control</strong>, pick a voice channel and go live. Uploads, decoded audio
          and the track database all live in the <code>dj-data</code> volume, so rebuilding the
          image never touches your library.
        </p>
        <Code>{`docker compose logs -f dj    # watch it come up`}</Code>
      </Step>

      <Step n={4} title="Put it behind a proxy">
        <p>
          Compose binds the app to <code>127.0.0.1</code> so only your reverse proxy can reach it.
          There is a Caddyfile in <code>deploy/</code> to start from. Three things have to line up:
        </p>
        <Code>{`# .env on the server
PUBLIC_URL=https://deck.example.com

# Discord developer portal — redirect URI
https://deck.example.com/api/auth/callback`}</Code>
        <p>
          Because <code>PUBLIC_URL</code> starts with <code>https://</code>, session cookies are
          issued with the <code>Secure</code> flag automatically and Express is set to trust the
          proxy's forwarded headers. If your proxy network is not named <code>edge</code>, pass
          yours:
        </p>
        <Code>{`CADDY_NETWORK=my_net docker compose up -d --build`}</Code>
      </Step>

      <section className="doc-section">
        <h2>Everything else you can set</h2>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Default</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              {ENV_OPTIONAL.map(([name, value, note]) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td className="doc-default">{value}</td>
                  <td>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-section">
        <h2>If something misbehaves</h2>
        <dl className="doc-faq">
          <div>
            <dt>Uploads fail with a 413</dt>
            <dd>
              Your proxy is rejecting the body before it reaches the app. Raise its request body
              limit to match <code>MAX_UPLOAD_MB</code>.
            </dd>
          </div>
          <div>
            <dt>Sign-in bounces with a state mismatch</dt>
            <dd>
              The redirect URI registered with Discord does not match <code>PUBLIC_URL</code>. They
              have to be identical, including the scheme and any trailing path.
            </dd>
          </div>
          <div>
            <dt>The site returns 502</dt>
            <dd>
              The container is not on the proxy's network. <code>docker compose up -d</code>{' '}
              reattaches it; connecting by hand does not survive a recreate.
            </dd>
          </div>
          <div>
            <dt>Nobody can sign in</dt>
            <dd>
              Check <code>DISCORD_GUILD_ID</code> and <code>DJ_ROLE_IDS</code>. Membership and roles
              are verified server-side with the bot's own token, so the gate cannot be worked around
              from the browser — including by you.
            </dd>
          </div>
        </dl>
      </section>

      <section className="doc-next">
        <p>
          Instance up and running? <a href="/guide">The booth guide</a> covers actually using it.
        </p>
      </section>
    </DocPage>
  );
}
