import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, UserPlus } from 'lucide-react';
import { SitePage } from './SiteNav';

interface InviteDetails {
  note: string;
  expiresAt: number;
  guild: { name: string } | null;
}

export function InviteAccept({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/invites/${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Could not check this invite (${res.status}).`);
        setInvite(body.invite as InviteDetails);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, [token]);

  const acceptUrl = `/api/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`;

  return (
    <SitePage>
      <div className="onboard">
        <section className="onboard-step">
          {error ? (
            <>
              <div className="invite-heading">
                <AlertTriangle size={30} />
                <h1 className="onboard-title">Invite unavailable</h1>
              </div>
              <p className="onboard-body">{error}</p>
              <a className="btn" href="/login">Go to sign in</a>
            </>
          ) : !invite ? (
            <div className="invite-loading">
              <div className="boot-spinner" />
              <p>Checking invitation&hellip;</p>
            </div>
          ) : (
            <>
              <UserPlus size={22} className="onboard-tick" />
              <h1 className="onboard-title">You&rsquo;re invited to Deck</h1>
              <p className="onboard-body">
                {invite.guild ? <>This link gives you DJ access to <strong>{invite.guild.name}</strong>.</> : <>This link gives you access to the Deck platform.</>}
              </p>
              {invite.note ? <p className="onboard-note">Invitation note: {invite.note}</p> : null}
              <p className="onboard-note">
                Sign in with your own Discord account. This link works once and expires{' '}
                {new Date(invite.expiresAt).toLocaleString()}.
              </p>
              <a className="btn btn-primary btn-large" href={acceptUrl}>
                Accept with Discord <ArrowRight size={15} />
              </a>
            </>
          )}
        </section>
      </div>
    </SitePage>
  );
}
