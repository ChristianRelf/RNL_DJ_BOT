import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, UserPlus } from 'lucide-react';
import { SitePage } from './SiteNav';

export function InviteAccept({ token }: { token: string }) {
  const [invite, setInvite] = useState<{ note: string; expiresAt: number; guild: { name: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch(`/api/invites/${token}`).then(async (res) => { const body = await res.json(); if (!res.ok) throw new Error(body.error); setInvite(body.invite); }).catch((err) => setError(err.message)); }, [token]);
  return <SitePage><div className="onboard"><section className="onboard-step">
    {error ? <><AlertTriangle size={18} /><h1 className="onboard-title">Invite unavailable</h1><p className="onboard-body">{error}</p></> : !invite ? <p>Checking invitation…</p> : <>
      <UserPlus size={22} className="onboard-tick" /><h1 className="onboard-title">You&rsquo;re invited to Deck</h1>
      <p className="onboard-body">{invite.guild ? <>This link gives you DJ access to <strong>{invite.guild.name}</strong>.</> : <>This link gives you access to the Deck platform.</>}</p>
      {invite.note ? <p className="onboard-note">Invitation note: {invite.note}</p> : null}
      <p className="onboard-note">Sign in with your own Discord account. The link works once and expires {new Date(invite.expiresAt).toLocaleString()}.</p>
      <a className="btn btn-primary btn-large" href={`/api/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Accept with Discord <ArrowRight size={15} /></a>
    </>}
  </section></div></SitePage>;
}
