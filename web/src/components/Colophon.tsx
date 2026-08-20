import { POLICIES } from './SiteNav';

/**
 * Attribution and the legal links, for the pages that have no site footer -
 * the console and the sign-in door. Plain anchors rather than client-side
 * navigation: the policies are whole pages served by the SPA fallback, and a
 * full load keeps them reachable without a session or a socket.
 */
export function Colophon({ block }: { block?: boolean }) {
  return (
    <div className={`colophon ${block ? 'is-block' : ''}`}>
      <a className="colophon-brand" href="https://ronation.live">
        Powered by RO Nation Live
      </a>
      <span className="colophon-links">
        {POLICIES.map((policy) => (
          <a key={policy.page} href={policy.href}>
            {policy.label}
          </a>
        ))}
      </span>
    </div>
  );
}
