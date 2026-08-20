import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Trash2, UserPlus } from 'lucide-react';

interface InviteEntry {
  id: string;
  guildId: string | null;
  note: string;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

export function InvitePanel({ api, title = 'Invite DJs', guildId, description }: { api: string; title?: string; guildId?: string | null; description?: string }) {
  const [invites, setInvites] = useState<InviteEntry[]>([]);
  const [note, setNote] = useState('');
  const [days, setDays] = useState('7');
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleInvites = guildId === undefined ? invites : invites.filter((invite) => invite.guildId === guildId);

  const load = useCallback(() => {
    void request(api).then((body) => setInvites(body.invites ?? [])).catch((err) => setError(err.message));
  }, [api]);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true); setError(null); setUrl(null);
    try {
      const body = await request(api, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: note.trim(), days: Number(days), guildId }) });
      setUrl(body.url); setNote(''); load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="tool is-on invite-tool">
      <header className="tool-head"><div className="tool-heading"><h2>{title}</h2><p>
        {description ?? 'Make a one-use sign-in link. It expires automatically and grants DJ access, never admin access. The recipient must still be a member of this Discord server.'}
      </p></div></header>
      <div className="tool-body">
        {error ? <p className="tool-result is-bad">{error}</p> : null}
        <div className="tool-row">
          <label className="tool-field"><span>Who is it for? (optional)</span><input className="tool-input" value={note}
            maxLength={160} placeholder="Alex — Friday show" onChange={(e) => setNote(e.target.value)} /></label>
          <label className="tool-field tool-field-port"><span>Expires</span><select className="tool-input" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option>
          </select></label>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}><UserPlus size={13} />{busy ? 'MAKING' : 'CREATE LINK'}</button>
        </div>
        {url ? <div className="tool-row invite-link"><input className="tool-input mono" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
            {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'COPIED' : 'COPY'}</button></div> : null}
        {visibleInvites.length ? <ul className="portal-list invite-list">{visibleInvites.slice(0, 8).map((invite) => <li key={invite.id} className="portal-allow">
          <Link2 size={12} /><span>{invite.note || 'Unnamed invite'}</span><span className="mono portal-dim">{invite.usedAt ? 'used' : invite.expiresAt <= Date.now() ? 'expired' : `expires ${new Date(invite.expiresAt).toLocaleDateString()}`}</span>
          {!invite.usedAt && invite.expiresAt > Date.now() ? <button className="btn tiny danger" type="button" aria-label="Revoke invite" onClick={() => void request(`${api}/${invite.id}`, { method: 'DELETE' }).then(load)}><Trash2 size={12} /></button> : <span />}
        </li>)}</ul> : null}
      </div>
    </section>
  );
}
