import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Cloud, Loader2, Plus } from 'lucide-react';
import { SitePage } from './SiteNav';

/**
 * Setting a rig up.
 *
 * Two steps and no forms to speak of: add the bot to a Discord server, then say
 * who is allowed to drive it. The server is picked in Discord's own dialog, so
 * nobody is ever asked to find and paste a guild id - and the id that comes back
 * is Discord's word for it rather than the browser's.
 */

interface OnboardState {
  mayOnboard: boolean;
  rigs: Array<{ id: string; slug: string; name: string; createdBy: string }>;
}

interface Role {
  id: string;
  name: string;
  color: number;
  isEveryone: boolean;
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

function roleColour(color: number): string | undefined {
  return color ? `#${color.toString(16).padStart(6, '0')}` : undefined;
}

export function Onboard() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('rig');
  const gateMissing = params.get('gate') === 'missing';

  const [state, setState] = useState<OnboardState | null>(null);
  const [error, setError] = useState<string | null>(params.get('error'));

  useEffect(() => {
    api('/api/onboard/state')
      .then(setState)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error && !state) {
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

  if (!state) {
    return (
      <div className="boot">
        <div className="boot-spinner" />
        <p>loading</p>
      </div>
    );
  }

  return (
    <SitePage>
      <div className="onboard">
        {error && (
          <p className="onboard-error">
            <AlertTriangle size={13} /> {error}
          </p>
        )}

        {!state.mayOnboard ? (
          <section className="onboard-step">
            <h1 className="onboard-title">Not set up yet</h1>
            <p className="onboard-body">
              Your account can sign in, but it has not been cleared to create a rig. If somebody
              is expecting you to set one up, ask them to enable it - otherwise{' '}
              <a href="/home/access">put your community on the list</a>.
            </p>
          </section>
        ) : slug ? (
          <Configure state={state} slug={slug} gateMissing={gateMissing} onError={setError} />
        ) : (
          <Invite existing={state.rigs.length} />
        )}
      </div>
    </SitePage>
  );
}

/* ------------------------------------------------------------- step one */

function Invite({ existing }: { existing: number }) {
  return (
    <section className="onboard-step">
      <h1 className="onboard-title">Add deck to your server</h1>
      <p className="onboard-body">
        Deck plays into a Discord voice channel, so the first thing it needs is to be in your
        server. Discord will ask which one - pick it there and you will land back here.
      </p>
      <p className="onboard-note">
        It asks for three permissions: view channels, connect, and speak. Nothing else, and
        nothing that can read messages.
      </p>

      <a className="btn btn-primary btn-large" href="/api/onboard/invite">
        <Plus size={15} /> Add to a Discord server
      </a>

      {existing > 0 && (
        <p className="onboard-note">
          Already set one up? <a href="/rigs">Open your rigs</a>.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- step two */

function Configure({
  state,
  slug,
  gateMissing,
  onError,
}: {
  state: OnboardState;
  slug: string;
  gateMissing: boolean;
  onError: (message: string) => void;
}) {
  const rig = state.rigs.find((entry) => entry.slug === slug);

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [name, setName] = useState(rig?.name ?? '');
  const [djRole, setDjRole] = useState('');
  const [adminRole, setAdminRole] = useState('');
  const [saving, setSaving] = useState(false);

  const guildId = rig?.id;

  useEffect(() => {
    if (!guildId) return;
    api(`/api/onboard/roles/${guildId}`)
      .then((body: { roles: Role[]; guild: { name: string } }) => {
        setRoles(body.roles.filter((role) => !role.isEveryone));
        setName((current) => current || body.guild.name);
      })
      .catch((err: Error) => onError(err.message));
  }, [guildId, onError]);

  const finish = useCallback(() => {
    if (!guildId || saving) return;
    setSaving(true);
    void api('/api/onboard/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guildId,
        name,
        slug: name,
        djRoleIds: djRole ? [djRole] : [],
        adminRoleIds: adminRole ? [adminRole] : [],
      }),
    })
      .then((body: { slug: string }) => {
        window.location.href = `/g/${body.slug}/deck`;
      })
      .catch((err: Error) => {
        onError(err.message);
        setSaving(false);
      });
  }, [guildId, name, djRole, adminRole, saving, onError]);

  if (!rig) {
    return (
      <section className="onboard-step">
        <h1 className="onboard-title">Nearly there</h1>
        <p className="onboard-body">
          That rig is not showing up yet. Give it a moment and <a href={`/onboard?rig=${slug}`}>try
          again</a>.
        </p>
      </section>
    );
  }

  return (
    <section className="onboard-step">
      <h1 className="onboard-title">
        <Check size={18} className="onboard-tick" /> {rig.name} is connected
      </h1>

      {gateMissing && (
        <p className="onboard-warn">
          <AlertTriangle size={13} /> deck cannot read that server yet, so nobody there will be
          able to sign in. Discord sometimes takes a moment to catch up - reload this page, and
          if it persists, check the bot is still in the server.
        </p>
      )}

      <label className="onboard-field">
        <span>Call it</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="onboard-field">
        <span>Who can DJ</span>
        <select className="input" value={djRole} onChange={(e) => setDjRole(e.target.value)}>
          <option value="">Anyone in the server</option>
          {(roles ?? []).map((role) => (
            <option key={role.id} value={role.id} style={{ color: roleColour(role.color) }}>
              {role.name}
            </option>
          ))}
        </select>
      </label>

      <label className="onboard-field">
        <span>Who can take over</span>
        <select className="input" value={adminRole} onChange={(e) => setAdminRole(e.target.value)}>
          <option value="">Only the server owner</option>
          {(roles ?? []).map((role) => (
            <option key={role.id} value={role.id} style={{ color: roleColour(role.color) }}>
              {role.name}
            </option>
          ))}
        </select>
      </label>
      <p className="onboard-note">
        Taking over means pulling the decks away from whoever currently holds control. The server
        owner can always do it.
      </p>

      <div className="onboard-basics">
        <h2>How deck works</h2>
        <ol>
          <li>
            <strong>Upload music to Deck Cloud.</strong>
            <span>
              Music goes directly from your browser to the rig&rsquo;s cloud library. A local playback
              cache is prepared automatically; the Droplet does not retain the source file.
            </span>
          </li>
          <li>
            <strong>Take control before mixing.</strong>
            <span>
              Everyone can watch the console, but only the person holding control can operate the
              decks. Other DJs can request control for a clean handover.
            </span>
          </li>
          <li>
            <strong>Load two decks and blend.</strong>
            <span>
              Search Deck Cloud tracks, load one onto A or B, press play, then use the channel
              faders and crossfader to decide what the room hears.
            </span>
          </li>
          <li>
            <strong>Join a Discord voice channel.</strong>
            <span>
              Pick a voice channel from the top bar and put the rig on air. Queueing, cueing and
              arranging the console can all be prepared before listeners hear anything.
            </span>
          </li>
        </ol>
      </div>

      <p className="onboard-body onboard-next">
        <Cloud size={14} /> When the console opens, start with <strong>Deck Cloud</strong>,
        then take control. You can rearrange every panel later.
      </p>

      <button type="button" className="btn btn-primary btn-large" onClick={finish} disabled={saving}>
        {saving ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
        Open the console
      </button>
    </section>
  );
}
