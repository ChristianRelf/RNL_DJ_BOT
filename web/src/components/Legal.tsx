import { Colophon } from './Colophon';

/**
 * Terms and Privacy for the decks, served as whole pages by the SPA fallback
 * so they stay reachable without a session.
 *
 * These sit under the site-wide policies at ronation.live/legal rather than
 * restating them: the general terms, the code of conduct and the cookie notice
 * are linked and incorporated, and what is written here is only what is
 * specific to this app. The data-handling sections are read off the
 * implementation — the OAuth scope, the cookie, and the files that get kept —
 * so keep them in step if any of that changes.
 */

const SITE = 'https://ronation.live';
const EMAIL = 'hello@ronation.live';
const UPDATED = '25 July 2026';

export function Legal({ page }: { page: 'terms' | 'privacy' }) {
  return (
    <div className="legal">
      <div className="legal-card">
        <header className="legal-head">
          <a href="/" className="legal-back">
            <img className="brand-logo" src="/deckLogo.png" alt="deck" />
          </a>
          <nav className="legal-nav">
            <a href="/terms" className={page === 'terms' ? 'is-current' : ''}>
              Terms
            </a>
            <a href="/privacy" className={page === 'privacy' ? 'is-current' : ''}>
              Privacy
            </a>
            <a href="/">Back to the decks</a>
          </nav>
        </header>

        {page === 'terms' ? <Terms /> : <Privacy />}

        <footer className="legal-foot">
          <Colophon block />
        </footer>
      </div>
    </div>
  );
}

/** Points at the site-wide policies these pages sit under. */
function SitePolicies() {
  return (
    <p className="legal-note">
      The decks are part of RO. Nation LIVE. The{' '}
      <a href={`${SITE}/legal/terms`}>site Terms of Service</a>, the{' '}
      <a href={`${SITE}/legal/privacy`}>site Privacy Policy</a> and the{' '}
      <a href={`${SITE}/legal/code-of-conduct`}>Code of Conduct</a> apply here too. This page
      covers only what is specific to the decks.
    </p>
  );
}

function Terms() {
  return (
    <article className="legal-body">
      <h1>Terms of Service</h1>
      <p className="legal-updated">Last updated: {UPDATED}</p>

      <SitePolicies />

      <h2>What this covers</h2>
      <p>
        These terms cover the decks — the web control surface and the bot that plays audio into a
        Discord voice channel. Using either means you accept them.
      </p>

      <h2>Our relationship with Discord</h2>
      <p>
        We are an independent group. We are not affiliated with, endorsed by, or operated by
        Discord Inc. The decks run on Discord's platform, and Discord's own terms apply to your use
        of it. We are not responsible for Discord outages, changes to its service, or anything
        Discord does with audio passing through it.
      </p>

      <h2>Who can use the decks</h2>
      <p>
        You need a Discord account, membership of the associated Discord server, and the DJ role.
        You must be at least 13, in line with Discord's own minimum age. Access is granted by the
        server's administrators and can be changed or withdrawn by them at any time.
      </p>

      <h2>Control of the decks</h2>
      <p>
        One person holds control at a time. Control is handed over by request, or released
        automatically after a period of inactivity. While you hold it, what you play is broadcast
        live to everyone in the voice channel — treat it as a public performance.
      </p>
      <p>
        Do not take control by technical means, and hand it over when asked if someone else is
        scheduled to play.
      </p>

      <h2>What you upload</h2>
      <p>
        You keep ownership of anything you upload. By adding a file to the media pool you give us
        permission to store it, convert it for playback, and play it through the decks — that is
        the only thing we do with it.
      </p>
      <p>
        You are responsible for what you upload. By adding a file you confirm you hold the rights
        to it, or are otherwise permitted to play it publicly in this setting, and that doing so
        does not infringe anyone else's rights. If you believe something in the pool infringes your
        rights, contact us at <a href={`mailto:${EMAIL}`}>{EMAIL}</a> and we will remove it.
      </p>

      <h2>How you must use it</h2>
      <ul>
        <li>Do not broadcast unlawful content, or content that breaches the Code of Conduct.</li>
        <li>Do not use the decks to harass anyone.</li>
        <li>
          Do not interfere with the service — no flooding it with commands, no attempting to
          bypass the access controls, no disrupting another operator's set.
        </li>
        <li>Do not upload anything you do not have the right to play.</li>
      </ul>

      <h2>Losing access</h2>
      <p>
        Access can be suspended or removed at any time, with or without notice, including for
        breaching these terms or the Code of Conduct. Uploads may be removed at the same time.
      </p>

      <h2>No warranty</h2>
      <p>
        The decks are provided as-is, with no guarantee of availability. They may be taken offline
        for maintenance, or permanently, without notice, and uploaded files may be lost. Keep your
        own copy of anything you care about. The limitations of liability in the{' '}
        <a href={`${SITE}/legal/terms`}>site Terms of Service</a> apply here.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may be updated. The date at the top shows when they last changed, and
        continuing to use the decks after a change means you accept it.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>, or the{' '}
        <a href={`${SITE}/contact`}>contact page</a>.
      </p>
    </article>
  );
}

function Privacy() {
  return (
    <article className="legal-body">
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated: {UPDATED}</p>

      <SitePolicies />

      <h2>What this covers</h2>
      <p>
        This covers the decks — the web control surface and the bot that plays audio into a Discord
        voice channel. It does not cover Discord sign-in on the main site, or the account-linking
        bot, which have their own policies.
      </p>

      <h2>How signing in works</h2>
      <p>
        Sign-in happens at Discord. We never see or hold your password. Discord asks you to approve
        the sign-in and then tells us who you are.
      </p>

      <h2>What we receive</h2>
      <p>
        We ask Discord for the <code>identify</code> scope only. That returns your Discord user ID,
        username, display name and avatar image URL. We do not request your email address and do
        not receive it.
      </p>
      <p>
        To decide whether you may use the decks, we also ask whether your account is a member of
        the associated server and which roles it holds. Your server nickname and whether you hold
        an administrator role are read at that point.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Audio files you upload, and a decoded copy used for playback.</li>
        <li>
          For each upload: its title, original filename, duration, file size, tempo and any tags,
          along with the Discord ID and display name of whoever uploaded it, and when.
        </li>
        <li>
          The state of the console — mixer and pad settings, and the last voice channel that was
          joined.
        </li>
        <li>Server logs, which may record sign-ins and errors.</li>
      </ul>

      <h2>What it is used for</h2>
      <p>
        Your Discord identity is used to check you are allowed in, to show who is connected, to
        show who holds control of the decks, and to record who uploaded what. Uploaded audio is
        used to play it. That is all.
      </p>

      <h2>Who can see it</h2>
      <p>
        Anyone signed in can see the media pool — the title of each track and the display name of
        whoever uploaded it — and can see who is connected and who holds control.
      </p>
      <p>
        Outside that, data goes to Discord (for authentication and to deliver the audio) and our
        hosting provider. Nobody else receives it, unless we are required by law to hand it over.
      </p>

      <h2>Audio broadcast</h2>
      <p>
        Audio you play is mixed and streamed live into a Discord voice channel. We do not record
        the broadcast. What Discord does with audio passing through its service is covered by
        Discord's own privacy policy.
      </p>

      <h2>Cookies</h2>
      <p>
        Session cookies only. After a successful sign-in we set{' '}
        <code>rnl_dj_session</code>, a signed token holding your Discord ID, username, display
        name, avatar URL and whether you are an administrator. It expires after 7 days and is
        removed when you sign out. A short-lived cookie is also set during sign-in to protect the
        exchange, and is cleared as soon as sign-in completes.
      </p>
      <p>
        No advertising, analytics or third-party tracking cookies are set. See the{' '}
        <a href={`${SITE}/legal/cookies`}>Cookie Notice</a> for the site as a whole.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Uploads are kept until you or an administrator delete them. Deleting an upload removes the
        file and its decoded copy from the server. Your session ends after 7 days, or as soon as
        you sign out. Server logs are kept briefly.
      </p>

      <h2>Your choices</h2>
      <p>
        You can delete anything you uploaded from the media pool at any time; administrators can
        delete any upload. Signing out clears your session.
      </p>
      <p>
        To get a copy of your data, correct it, or have it deleted, see{' '}
        <a href={`${SITE}/legal/data-requests`}>Data &amp; Privacy Requests</a>.
      </p>

      <h2>Changes</h2>
      <p>
        This policy may be updated. The date at the top shows when it last changed.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>, or the{' '}
        <a href={`${SITE}/contact`}>contact page</a>.
      </p>
    </article>
  );
}
