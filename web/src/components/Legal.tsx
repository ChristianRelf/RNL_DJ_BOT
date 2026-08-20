import { POLICIES, SitePage, type PolicyPage } from './SiteNav';

/**
 * The policy pages for the decks - terms, privacy, cookies and accessibility -
 * served as whole pages by the SPA fallback so they stay reachable without a
 * session.
 *
 * These sit under the site-wide policies at ronation.live/legal rather than
 * restating them: the general terms, the code of conduct and the site cookie
 * notice are linked and incorporated, and what is written here is only what is
 * specific to this app. The factual sections are read off the implementation -
 * the OAuth scope, the two cookies, the browser storage keys and what the
 * console actually does at the keyboard - so keep them in step if any of that
 * changes.
 */

const SITE = 'https://ronation.live';
const EMAIL = 'hello@ronation.live';
const UPDATED = '20 August 2026';

const BODIES: Record<PolicyPage, () => JSX.Element> = {
  terms: Terms,
  privacy: Privacy,
  cookies: Cookies,
  accessibility: Accessibility,
};

export function Legal({ page }: { page: PolicyPage }) {
  const Body = BODIES[page];
  return (
    <SitePage>
      <nav className="doc-tabs" aria-label="Policies">
        {POLICIES.map((policy) => (
          <a
            key={policy.page}
            href={policy.href}
            className={page === policy.page ? 'is-current' : ''}
            aria-current={page === policy.page ? 'page' : undefined}
          >
            {policy.label}
          </a>
        ))}
        <a href="/deck">Back to the decks</a>
      </nav>

      <Body />
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

function Cookies() {
  return (
    <article className="doc-body">
      <h1>Cookie Policy</h1>
      <p className="doc-updated">Last updated: {UPDATED}</p>

      <SitePolicies />

      <h2>What this covers</h2>
      <p>
        This explains the cookies and other browser storage the decks use - the web control
        surface, the request page and the owner portal. It expands on the cookies section of the{' '}
        <a href="/privacy">Deck Privacy Policy</a> and sits under the{' '}
        <a href={`${SITE}/legal/cookies`}>site Cookie Notice</a>, which covers ronation.live as a
        whole.
      </p>

      <h2>The short version</h2>
      <p>
        The decks set two cookies, both strictly necessary, and neither is used to track you. There
        are no advertising cookies, no analytics cookies and no third-party trackers, which is why
        you are not asked to accept a banner: there is nothing optional to accept.
      </p>

      <h2>What a cookie is</h2>
      <p>
        A cookie is a small piece of text a site asks your browser to keep and send back on later
        visits. A cookie is called <strong>strictly necessary</strong> when the service cannot work
        without it - here, that means knowing you signed in and finishing the sign-in safely.
      </p>

      <h2>The cookies we set</h2>
      <div className="doc-table-wrap">
        <table className="doc-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Purpose</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>rnl_dj_session</code>
              </td>
              <td>
                Keeps you signed in. A signed token holding your Discord ID, username, display name,
                avatar URL, whether you are an administrator, and whether the session may drive a
                console or only submit requests.
              </td>
              <td>7 days, or when you sign out</td>
            </tr>
            <tr>
              <td>
                <code>rnl_dj_state</code>
              </td>
              <td>
                Protects the sign-in exchange against forgery and remembers which page to return you
                to afterwards. Set when sign-in begins and cleared as soon as it completes.
              </td>
              <td>10 minutes</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Both are <strong>first-party</strong> cookies, set by us and readable only by us. Both are{' '}
        <code>HttpOnly</code>, so page scripts cannot read them; both are{' '}
        <code>SameSite=Lax</code>, so they are not sent from other sites; and both are marked{' '}
        <code>Secure</code> wherever the service is served over HTTPS. The session cookie is set on
        the parent domain so one sign-in also covers the portal.
      </p>

      <h2>Cookies we do not set</h2>
      <ul>
        <li>Advertising, retargeting or profiling cookies.</li>
        <li>Analytics or audience-measurement cookies.</li>
        <li>Social media, embed or share-button cookies.</li>
        <li>Cookies that follow you to another site, or that another site can read.</li>
      </ul>

      <h2>Other storage in your browser</h2>
      <p>
        Some things are kept on your device without being cookies. They are never sent to us
        automatically the way a cookie is, and they stay on the device that created them.
      </p>
      <ul>
        <li>
          <strong>Local storage</strong> holds your console layout and your MIDI controller
          mappings, so the desk comes back the way you left it.
        </li>
        <li>
          <strong>IndexedDB</strong> holds the permission handle for the music folder you pointed at
          and the metadata from scanning it, so you do not re-pick the folder every session.
        </li>
        <li>
          <strong>The ordinary browser cache</strong> may hold audio while it plays, along with the
          usual page assets.
        </li>
      </ul>
      <p>
        You can clear all of it through your browser's site-data controls. Clearing it signs you out
        and resets your layout and mappings; it does not delete anything from Deck Cloud or from your
        own music folder.
      </p>

      <h2>Third parties</h2>
      <p>
        Signing in happens at Discord, on Discord's own pages, and Discord sets its own cookies
        there under <a href="https://discord.com/privacy">Discord's privacy policy</a> - we neither
        set nor read them. Cloud music is delivered through a content-delivery endpoint, which
        serves files and does not set tracking cookies.
      </p>

      <h2>Managing cookies</h2>
      <p>
        Every major browser lets you view, block and delete cookies, and signing out removes the
        session cookie directly. Because both of ours are strictly necessary, blocking them means
        sign-in cannot complete and the decks will not open - the public pages stay readable
        without them.
      </p>

      <h2>Changes</h2>
      <p>
        If we add a cookie, this page changes before it is set, and the date at the top shows when
        it last changed. If we ever add a cookie that is not strictly necessary, we will ask you
        first.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about cookies: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>, or the{' '}
        <a href={`${SITE}/contact`}>contact page</a>.
      </p>
    </article>
  );
}

function Accessibility() {
  return (
    <article className="doc-body">
      <h1>Accessibility Statement</h1>
      <p className="doc-updated">Last updated: {UPDATED}</p>

      <SitePolicies />

      <h2>Our commitment</h2>
      <p>
        We want as many people as possible to be able to use the decks, and we would rather be
        straight with you about where that currently stands than claim more than we can hold to.
        We aim to meet <strong>WCAG 2.2 level AA</strong>. The public pages - the product page, the
        help centre, the access page and these policies - are close to that. The console itself is
        a dense, pointer-driven instrument and does not yet meet it in full; the gaps are listed
        below rather than left for you to discover.
      </p>

      <h2>What is in place</h2>
      <ul>
        <li>
          <strong>Keyboard control of playback.</strong> <kbd>Q</kbd> and <kbd>P</kbd> play or pause
          the two decks, <kbd>1</kbd>&ndash;<kbd>8</kbd> fire the sample pads, and{' '}
          <kbd>[</kbd> and <kbd>]</kbd> nudge the crossfader, so a set can be run without a mouse
          on the controls that matter most.
        </li>
        <li>
          <strong>Visible focus.</strong> Interactive controls show a focus ring when reached by
          keyboard, and the ring is not removed for looks.
        </li>
        <li>
          <strong>Named controls.</strong> Knobs, faders, buttons and icon-only controls carry text
          names for screen readers. Knobs and faders report their value, range and a readable
          version of what that value means; toggles report whether they are on.
        </li>
        <li>
          <strong>Announced status.</strong> Toast notifications are announced rather than only
          shown.
        </li>
        <li>
          <strong>Reduced motion.</strong> If your system asks for less movement, decorative
          animation - meters, pulses, the landing page's motion - stops. Nothing load-bearing is
          animation-only.
        </li>
        <li>
          <strong>Hardware as an alternative.</strong> A MIDI controller can drive the desk in place
          of the pointer, and mappings are remembered.
        </li>
        <li>
          <strong>Pointer alternatives on controls.</strong> Scrolling steps a control, right-click
          or double-click resets it, and holding shift gives fine adjustment - so precise values do
          not depend on a precise drag.
        </li>
        <li>
          <strong>A layout you can rearrange.</strong> Panels can be moved and resized, so the parts
          you need can be put where you can see them.
        </li>
        <li>
          <strong>No flashing.</strong> Nothing in the interface flashes at a rate known to trigger
          seizures.
        </li>
      </ul>

      <h2>Known limitations</h2>
      <p>We know about the following, and are not claiming otherwise.</p>
      <ul>
        <li>
          <strong>Some interactions need a pointer.</strong> Scrubbing the waveform, setting cue
          points by hand and rearranging the layout are drag gestures with no keyboard equivalent
          yet.
        </li>
        <li>
          <strong>Screen reader support is partial.</strong> Controls are labelled, but the console
          is not yet a comfortable screen-reader experience end to end, and the reading order across
          a rearranged layout can be surprising.
        </li>
        <li>
          <strong>The interface is small and dense by design.</strong> Some labels are below the
          size we would choose for body text. Browser zoom works, but at high zoom the console
          layout gets tight.
        </li>
        <li>
          <strong>Colour carries some meaning.</strong> Deck A and deck B are told apart by colour
          as well as by their labels and position; on-air and playback states use colour alongside
          text. We are working through the places where colour is doing too much of the work on its
          own.
        </li>
        <li>
          <strong>One theme.</strong> There is a dark theme only, with no high-contrast or light
          alternative yet.
        </li>
        <li>
          <strong>It is an audio product.</strong> The core output is sound. There is no visual
          substitute for hearing the mix, though waveforms and level meters show what is playing.
        </li>
        <li>
          <strong>Discord and the browser.</strong> Sign-in happens on Discord's pages, and playback
          reaches listeners through Discord. Their accessibility is theirs, not ours.
        </li>
      </ul>

      <h2>What we are working on</h2>
      <p>
        Keyboard equivalents for the remaining drag-only interactions, a fuller pass over
        screen-reader labelling and reading order, and reducing the number of places where colour
        alone carries a state. We do not publish dates we cannot keep, but this section changes as
        those land.
      </p>

      <h2>Getting help</h2>
      <p>
        If something here is stopping you doing what you came to do, tell us and we will help you
        get it done - directly, if that is what it takes - while we fix the underlying problem.
      </p>

      <h2>Telling us about a problem</h2>
      <p>
        Email <a href={`mailto:${EMAIL}`}>{EMAIL}</a> or use the{' '}
        <a href={`${SITE}/contact`}>contact page</a>. It helps to know what you were trying to do,
        the page or panel it happened on, the browser and any assistive technology you use, and what
        you expected instead. We aim to reply within five working days, and to tell you what we
        intend to do and roughly when.
      </p>
      <p>
        If our reply does not resolve it, say so and we will look at it again. Nothing here affects
        rights you have under equality or accessibility law where you live.
      </p>

      <h2>How this was assessed</h2>
      <p>
        This statement is based on our own review of the interface against WCAG 2.2 AA, using
        keyboard testing, browser accessibility tooling and the implementation itself. It has not
        been audited by an independent third party, and it is not a formal conformance claim.
      </p>

      <h2>Changes</h2>
      <p>
        This statement is updated as the product changes. The date at the top shows when it last
        changed.
      </p>

      <h2>Contact</h2>
      <p>
        Accessibility questions: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>, or the{' '}
        <a href={`${SITE}/contact`}>contact page</a>.
      </p>
    </article>
  );
}
