import { SitePage } from './SiteNav';

/**
 * Terms and Privacy for the decks, served as whole pages by the SPA fallback
 * so they stay reachable without a session.
 *
 * These sit under the site-wide policies at ronation.live/legal rather than
 * restating them: the general terms, the code of conduct and the cookie notice
 * are linked and incorporated, and what is written here is only what is
 * specific to this app. The data-handling sections are read off the
 * implementation - the OAuth scope, the cookie, and the files that get kept -
 * so keep them in step if any of that changes.
 */

const SITE = 'https://ronation.live';
const EMAIL = 'hello@ronation.live';
const UPDATED = '20 August 2026';

export function Legal({ page }: { page: 'terms' | 'privacy' }) {
  return (
    <SitePage>
      <nav className="doc-tabs" aria-label="Policies">
        <a href="/terms" className={page === 'terms' ? 'is-current' : ''}>
          Terms
        </a>
        <a href="/privacy" className={page === 'privacy' ? 'is-current' : ''}>
          Privacy
        </a>
        <a href="/deck">Back to the decks</a>
      </nav>

      {page === 'terms' ? <Terms /> : <Privacy />}
    </SitePage>
  );
}

/** Points at the site-wide policies these pages sit under. */
function SitePolicies() {
  return (
    <p className="doc-note">
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
    <article className="doc-body">
      <h1>Terms of Service</h1>
      <p className="doc-updated">Last updated: {UPDATED}</p>

      <SitePolicies />

      <h2>What this covers</h2>
      <p>
        These terms cover the decks - the web control surface and the bot that plays audio into a
        Discord voice channel - including a rig, its request page and the owner portal. Using any
        part of Deck means you accept these terms. If you do not accept them, do not use it.
      </p>

      <h2>Eligibility and accounts</h2>
      <p>
        You must be at least 13 and old enough to use Discord where you live. Use your own Discord
        account and do not impersonate somebody else, share access, or use another account to get
        around a suspension or role restriction. Discord is responsible for its accounts; we do
        not create or recover them.
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
        Access is deliberately limited. You need a permitted Discord account, membership of the
        associated server and any DJ role configured for that rig. Server administrators decide
        their own roles; RO. Nation LIVE controls platform admission and the owner portal. Either
        can change or withdraw the access they control.
      </p>

      <h2>Administrators and the owner portal</h2>
      <p>
        Administrative access is a privilege, not a permanent entitlement. Use it only to run the
        rigs and communities you are responsible for. Do not inspect, copy, disclose or use member,
        waitlist, bot or operational data for another purpose. Bot tokens are credentials: enter
        only tokens you are authorised to manage and never expose one to another person.
      </p>

      <h2>Control of the decks</h2>
      <p>
        One person holds control at a time. Control is handed over by request, or released
        automatically after a period of inactivity. While you hold it, what you play is broadcast
        live to everyone in the voice channel - treat it as a public performance.
      </p>
      <p>
        Do not take control by technical means, and hand it over when asked if someone else is
        scheduled to play.
      </p>

      <h2>Your music</h2>
      <p>
        Music uploaded to Deck Cloud is stored in RNL&rsquo;s object storage and delivered through its
        configured content-delivery endpoint. The browser may cache audio locally and sends
        short-lived audio chunks to the decks while it hosts playback; the Droplet does not retain
        source files or decoded audio on its disk.
      </p>
      <p>
        You are responsible for what you play. By making a file available you confirm you hold the rights
        to it, or are otherwise permitted to play it publicly in this setting, and that doing so
        does not infringe anyone else's rights.
      </p>
      <p>
        You keep ownership of your music and metadata. You give us the limited permission needed
        to receive live audio chunks, mix them, transmit the result to Discord and display the
        associated track information to authorised users. That permission ends when the material
        is no longer needed to provide the service, except for metadata we are entitled to retain.
      </p>

      <h2>Requests and information you submit</h2>
      <p>
        A listener may submit a track request and an applicant may join the access waitlist. You
        remain responsible for what you type. Do not submit unlawful, abusive, misleading or
        malicious material, somebody else's private information, or anything you are not entitled
        to send. We may reject or remove submissions that break these terms.
      </p>

      <h2>How you must use it</h2>
      <ul>
        <li>Do not broadcast unlawful content, or content that breaches the Code of Conduct.</li>
        <li>Do not use the decks to harass anyone.</li>
        <li>
          Do not interfere with the service - no flooding it with commands, no attempting to
          bypass the access controls, no disrupting another operator's set.
        </li>
        <li>Do not play anything you do not have the right to play.</li>
        <li>Do not scrape, crawl or bulk-download the service, or automate requests or commands.</li>
        <li>Do not probe, attack, reverse-engineer or try to reach another rig, portal or account.</li>
        <li>Do not introduce malware, unsafe links or credentials that are not yours to use.</li>
      </ul>

      <h2>Platform limits and third-party services</h2>
      <p>
        Deck depends on Discord, browsers, networks, hosting and audio codecs we do not control.
        Features may be unavailable on some devices, and Discord can change permissions, voice
        behaviour or APIs. You are responsible for a suitable device, browser, connection and
        lawful source library, and for keeping your own files backed up.
      </p>

      <h2>Losing access</h2>
      <p>
        Access can be suspended or removed at any time, with or without notice, including for
        breaching these terms or the Code of Conduct. Stored track metadata may be removed at the same time.
      </p>

      <h2>No warranty</h2>
      <p>
        The decks are provided as-is, with no guarantee of availability. They may be taken offline
        for maintenance, or permanently, without notice. Keep your own music library backed up.
        The limitations of liability in the{' '}
        <a href={`${SITE}/legal/terms`}>site Terms of Service</a> apply here.
      </p>

      <h2>Liability</h2>
      <p>
        To the fullest extent the law allows, RO. Nation LIVE is not liable for indirect or
        consequential loss arising from Deck - including a lost set, unavailable rig, dropped
        stream, browser storage being cleared, Discord outage or lost metadata. Nothing here
        excludes or limits liability that cannot lawfully be excluded or limited.
      </p>

      <h2>Which law applies</h2>
      <p>
        As with the site terms, these terms and disputes arising from Deck are governed by the law
        of England and Wales, and the courts of England and Wales have exclusive jurisdiction. If
        you live elsewhere, you keep any mandatory consumer protection your local law gives you.
        Please contact us first so we have a fair chance to resolve a problem informally.
      </p>

      <h2>The rest of the agreement</h2>
      <ul>
        <li>These terms sit alongside the site Terms, Privacy Policy and Code of Conduct.</li>
        <li>If part of these terms cannot be enforced, the rest remains in effect.</li>
        <li>Delay in enforcing a term does not waive it.</li>
        <li>You cannot transfer your rights under these terms to another person.</li>
        <li>No person who is not a party to these terms may enforce them.</li>
      </ul>

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
    <article className="doc-body">
      <h1>Privacy Policy</h1>
      <p className="doc-updated">Last updated: {UPDATED}</p>

      <SitePolicies />

      <h2>What this covers</h2>
      <p>
        This covers the decks - the web control surface and the bot that plays audio into a Discord
        voice channel. It does not cover Discord sign-in on the main site, or the account-linking
        bot, which have their own policies.
      </p>

      <h2>Who is responsible</h2>
      <p>
        RO. Nation LIVE operates Deck and is responsible for the information held by the platform.
        A Discord server's administrators control membership and role choices inside their own
        community, but they do not receive ownership of your data. Contact details are at the end
        of this policy.
      </p>

      <h2>Age</h2>
      <p>
        Deck is for people aged 13 and over. We cannot independently verify age. If we learn that
        an account belongs to somebody under 13, we will remove its access and delete associated
        personal information where we can.
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
        <li>
          Your Discord user ID, username, display name, avatar URL, server nickname, relevant roles
          and administrator status.
        </li>
        <li>
          Access records: the platform allowlist, who granted access and when, and access-waitlist
          details you submit, including Discord handle, email, community, size and message.
        </li>
        <li>
          Track metadata supplied by the hosting browser: title, duration, file size, tempo, tags
          and a content identifier. Audio files and decoded audio are not retained server-side.
        </li>
        <li>
          Rig and console state: server and channel identifiers, access roles, control and queue
          state, requests, mixer and pad settings, cue points, and the last
          voice channel joined.
        </li>
        <li>
          Playback-bot details entered by a platform administrator. Tokens are encrypted at rest;
          browsers receive only safe identifiers and fingerprints, never the stored token.
        </li>
        <li>
          Ordinary server logs, which may include an IP address, browser user-agent, timestamps,
          sign-ins, requests and errors, kept for security and debugging.
        </li>
      </ul>

      <h2>What stays in your browser</h2>
      <p>
        Deck stores scan metadata, your console layout and a playback cache in browser-managed
        storage. These remain on that device and can be removed through browser site-data controls.
        The browser may clear them under its own storage rules. Removing a browser cache does not
        remove the corresponding object from Deck Cloud.
      </p>

      <h2>What we do not collect</h2>
      <ul>
        <li>Your Discord password, direct messages or message history.</li>
        <li>Your Discord email address through sign-in.</li>
        <li>Card, bank or payment details.</li>
        <li>Advertising identifiers or third-party analytics tracking.</li>
        <li>Source music or decoded audio on the Deck Droplet; cloud-library objects are held separately in object storage.</li>
      </ul>

      <h2>What it is used for</h2>
      <p>
        Your Discord identity is used to check you are allowed in, to show who is connected, to
        show who holds control of the decks, and to associate track metadata with the host. Audio
        chunks are used only for live playback.
      </p>
      <ul>
        <li>Authenticating you and checking platform, server and role-based access.</li>
        <li>Operating rigs, queues, requests, handovers and live Discord playback.</li>
        <li>Showing authorised users who is connected and what the rig is doing.</li>
        <li>Running the waitlist, onboarding communities and administering playback bots.</li>
        <li>Preventing abuse, investigating failures and protecting the service.</li>
      </ul>

      <h2>Who can see it</h2>
      <p>
        Anyone signed in can see the browser library catalogue and can see who is connected and
        who holds control. They cannot download the host's source files.
      </p>
      <p>
        Users of a rig can see its shared operational state, track catalogue, requests and connected
        operators. Guild administrators may manage that rig. Platform administrators can manage
        every rig, the allowlist, waitlist and bot pool because they operate the service. Waitlist
        details and bot controls are not exposed on ordinary rig pages.
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

      <h2>Where information is stored</h2>
      <p>
        Server-held data lives in our service database and logs with our hosting provider. Cloud
        music lives in our configured object storage and may be delivered from CDN edge locations.
        Data may be processed in a country different from yours. Cached audio stays on the device
        whose browser created it. Live audio necessarily passes through our server and Discord to
        reach the voice channel.
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
      <ul>
        <li>Sessions last up to 7 days or until you sign out.</li>
        <li>Waitlist entries remain until reviewed, dismissed or deleted on request.</li>
        <li>Allowlist records remain while access is granted or needed for administration.</li>
        <li>Rig state and track metadata remain until removed or the rig is deleted.</li>
        <li>Bot credentials remain until a platform administrator removes the bot.</li>
        <li>Browser-held data remains until you or the browser clears it.</li>
        <li>Server logs are kept briefly, then discarded.</li>
      </ul>

      <h2>Your choices</h2>
      <p>
        You can forget track metadata from the browser library; administrators can remove any
        entry. This never deletes the source file on the host device. Signing out clears your session.
      </p>
      <p>
        You may ask for a copy of personal information we hold, ask us to correct it, object to its
        use, or ask for deletion. Some operational or security records may need to be retained where
        the law permits or requires it, and we cannot remove information already made anonymous.
        If you cannot sign in to make a request, email us and we will verify your identity another way.
      </p>
      <p>
        To get a copy of your data, correct it, or have it deleted, see{' '}
        <a href={`${SITE}/legal/data-requests`}>Data &amp; Privacy Requests</a>.
      </p>

      <h2>Security</h2>
      <p>
        Sessions use signed, HTTP-only cookies. Access is rechecked against Discord membership and
        roles, sensitive portal routes require platform-administrator status, and bot tokens are
        encrypted before storage and never returned to the browser. No system is perfectly secure;
        if you find a vulnerability, report it privately so we can investigate it.
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
