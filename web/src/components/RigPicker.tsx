import { useEffect, useState } from 'react';
import { Radio, Disc3, AlertTriangle } from 'lucide-react';
import { fetchRigs, type RigSummary } from '../lib/rigs';
import { SiteNav } from './SiteNav';

/**
 * Which rig to open.
 *
 * Skipped entirely when there is exactly one, because a chooser with one option
 * is a page nobody wants to read. It only earns its place once somebody DJs in
 * more than one server.
 */
export function RigPicker() {
  const [rigs, setRigs] = useState<RigSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRigs()
      .then((found) => {
        if (found.length === 1) {
          window.location.replace(`/g/${found[0].slug}/deck`);
          return;
        }
        setRigs(found);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="boot">
        <AlertTriangle size={18} />
        <p>{error}</p>
        <a className="btn" href="/login">
          Sign in
        </a>
      </div>
    );
  }

  if (!rigs) {
    return (
      <div className="boot">
        <p>loading your rigs</p>
      </div>
    );
  }

  return (
    <div className="page">
      <SiteNav />
      <main className="page-main rigpicker">
        <h1 className="rigpicker-title">Your rigs</h1>

        {rigs.length === 0 ? (
          <p className="panel-empty">
            No rigs yet. If somebody has just given you access, ask them which server it was
            for — or <a href="/onboard">set one up</a> if that is yours to do.
          </p>
        ) : (
          <ul className="rigpicker-list">
            {rigs.map((rig) => (
              <li key={rig.id}>
                <a className="rigpicker-card" href={`/g/${rig.slug}/deck`}>
                  <span className="rigpicker-name">{rig.name}</span>
                  <span className="rigpicker-meta mono">
                    {rig.live ? (
                      <>
                        <Radio size={11} /> on air
                      </>
                    ) : rig.running ? (
                      <>
                        <Disc3 size={11} /> idle
                      </>
                    ) : (
                      'stopped'
                    )}
                    {rig.hosted ? ' · library connected' : ' · no library'}
                    {rig.isAdmin ? ' · admin' : ''}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
