import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, RefreshCw, X } from 'lucide-react';

/**
 * Who is waiting for access, on the tools page.
 *
 * Owner-only and over its own HTTP endpoint, like the bot roster: this is the
 * one place in the database holding details of people who are not in the
 * guild, so it never goes near the state broadcast every DJ receives.
 */

interface Entry {
  id: string;
  discord: string;
  email: string;
  community: string;
  size: string;
  note: string;
  at: number;
}

export function WaitlistPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/portal/overview', { credentials: 'include' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Could not read the list (${res.status}).`);
        setEntries(body.waitlist);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const remove = (id: string) => {
    fetch(`/api/portal/waitlist/${id}`, { method: 'DELETE', credentials: 'include' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.ok) setEntries(body.waitlist);
      })
      .catch(() => undefined);
  };

  return (
    <section className="tool is-on">
      <header className="tool-head">
        <div className="tool-heading">
          <h2>Waitlist</h2>
          <p>
            Rooms asking for access, newest first. Remove one once they are in — nothing here is
            sent anywhere else.
          </p>
        </div>
        <button type="button" className="btn tiny" onClick={load} title="Reload">
          <RefreshCw size={12} />
          REFRESH
        </button>
      </header>

      <div className="tool-body">
        {error ? <p className="tool-result is-bad">{error}</p> : null}

        {entries === null ? (
          <p className="tool-note">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="tool-note">
            <ClipboardList size={12} /> Nobody waiting yet. The form is at /home/access.
          </p>
        ) : (
          <div className="waitlist-admin">
            {entries.map((entry) => (
              <div className="waitlist-entry" key={entry.id}>
                <div className="waitlist-entry-who">
                  <strong>{entry.discord}</strong>
                  <span>{entry.email}</span>
                  <span>
                    {entry.community}
                    {entry.size ? ` · ${entry.size}` : ''}
                  </span>
                  <span>{new Date(entry.at).toLocaleDateString()}</span>
                </div>
                <button
                  type="button"
                  className="btn tiny"
                  title="Remove from the list"
                  aria-label={`Remove ${entry.discord}`}
                  onClick={() => remove(entry.id)}
                >
                  <X size={12} />
                </button>
                {entry.note ? <p className="waitlist-entry-note">{entry.note}</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
