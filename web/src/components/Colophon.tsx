/**
 * Attribution and the legal links. Plain anchors rather than client-side
 * navigation: /terms and /privacy are whole pages served by the SPA fallback,
 * and a full load keeps them reachable without a session or a socket.
 */
export function Colophon({ block }: { block?: boolean }) {
  return (
    <div className={`colophon ${block ? 'is-block' : ''}`}>
      <a className="colophon-brand" href="https://ronation.live">
        Powered by RO Nation Live
      </a>
      <span className="colophon-links">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
      </span>
    </div>
  );
}
