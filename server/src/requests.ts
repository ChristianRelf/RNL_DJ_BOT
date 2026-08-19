import express, { type Request, type Response, type NextFunction } from 'express';
import { checkMember } from './auth';
import * as platform from './db/platform';
import { rigs } from './rigManager';
import { CommandError, type Rig } from './rig';
import { createLogger } from './logger';
import type { RequestPageInfo, RequestTrack, SessionUser } from './protocol';

const log = createLogger('requests');

/**
 * Asking for a track.
 *
 * The one surface in the whole server that answers to somebody without a DJ
 * role. Everything else here — the console, the media pool, the rig routes —
 * asks `checkAccess`, which wants a role the room does not have; this asks
 * `checkMember`, which only wants them to be in the Discord server the rig
 * plays to. That is the entire difference, and it is why these routes live in
 * their own file rather than as three more entries on the guild router: it
 * should not be possible to add a route to the rig's API and accidentally
 * inherit the wrong gate.
 *
 * Addressed by slug rather than by guild id, because the URL is meant to be
 * read out loud in a voice channel.
 */

/** Asks allowed per person per rig, per window. */
const PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Longest a free-text ask and its note may be. Two lines and one line. */
const TEXT_MAX = 120;
const NOTE_MAX = 200;

/** The most search hits sent back. A request page is not a library browser. */
const SEARCH_LIMIT = 12;

const hits = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed window, per person per rig, in memory.
 *
 * Not in the database on purpose: the same reasoning as the waitlist limiter —
 * a restart clearing it is correct, because the limit is there to keep one
 * person from filling the booth's list in a minute, not to hold anything
 * against them for the rest of the night.
 */
function spend(key: string, take: boolean): number {
  const now = Date.now();
  const hit = hits.get(key);
  if (!hit || now > hit.resetAt) {
    for (const [id, value] of hits) if (now > value.resetAt) hits.delete(id);
    if (!take) return PER_WINDOW;
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return PER_WINDOW - 1;
  }
  if (hit.count >= PER_WINDOW) return 0;
  if (take) hit.count++;
  return PER_WINDOW - hit.count;
}

/** What the room is hearing, or null when nothing is. */
function nowPlaying(rig: Rig): string | null {
  const state = rig.state();
  const { crossfader } = state.mixer;
  // Whichever deck is actually winning the mix, on the same reading the now-
  // playing tool uses: playing, fader up, and on the near side of the fader.
  const candidates = (['A', 'B'] as const).filter(
    (id) => state.decks[id].playing && state.decks[id].gain > 0.05 && !state.decks[id].muted,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return state.decks[candidates[0]].title;
  return state.decks[crossfader <= 0 ? 'A' : 'B'].title;
}

function summary(rig: Rig, slug: string, name: string) {
  return {
    id: rig.guildId,
    slug,
    name,
    open: rig.store.db.tools.requests,
    live: rig.voice.snapshot().status === 'ready',
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    /** The rig this request page belongs to, and the requester's name in it. */
    requestRig?: { rig: Rig; slug: string; name: string; displayName: string };
  }
}

export function mountRequests(app: express.Express): void {
  const json = express.json({ limit: '8kb' });

  /**
   * Resolves the slug and checks the caller belongs to that Discord server.
   *
   * The rig being switched off for requests is *not* refused here — the page
   * has to be able to say "this rig is not taking requests" rather than 404,
   * which reads as a broken link. Only submitting is refused.
   */
  async function withRequestRig(req: Request, res: Response, next: NextFunction): Promise<void> {
    const session = req.session;
    if (!session) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }

    const record = platform.getGuildBySlug(String(req.params.slug ?? '').toLowerCase());
    if (!record || record.status !== 'active') {
      res.status(404).json({ error: 'No rig answers to that name.' });
      return;
    }

    const rig = await rigs.ensure(record.id);
    if (!rig) {
      res.status(503).json({ error: 'That rig is not running at the moment.' });
      return;
    }

    const membership = await checkMember(record.id, session.user.id, session.user.displayName);
    if (!membership.member) {
      // Deliberately the same wording whether they are not in the server or the
      // lookup failed — neither is something the page can act on differently.
      res.status(403).json({ error: membership.reason ?? 'You are not in that Discord server.' });
      return;
    }

    req.requestRig = {
      rig,
      slug: record.slug,
      name: record.name,
      displayName: membership.displayName,
    };
    next();
  }

  const guard = (req: Request, res: Response, next: NextFunction) =>
    void withRequestRig(req, res, next);

  /**
   * Which rigs this person could ask on.
   *
   * Only rigs that are running with the tool on are considered, so the
   * membership lookups this makes are bounded by that rather than by the size
   * of the platform.
   */
  app.get('/api/requests', async (req, res) => {
    const session = req.session;
    if (!session) return res.status(401).json({ error: 'Not signed in.' });

    const open = platform
      .listGuilds()
      .filter((guild) => guild.status === 'active')
      .map((guild) => ({ guild, rig: rigs.get(guild.id) }))
      .filter((entry) => entry.rig?.store.db.tools.requests);

    const found = await Promise.all(
      open.map(async ({ guild, rig }) => {
        const membership = await checkMember(guild.id, session.user.id, session.user.displayName);
        if (!membership.member) return null;
        return summary(rig as Rig, guild.slug, guild.name);
      }),
    );

    res.json({ rigs: found.filter(Boolean) });
  });

  /** Everything the page needs to draw itself. */
  app.get('/api/requests/:slug', guard, (req, res) => {
    const { rig, slug, name, displayName } = req.requestRig as NonNullable<Request['requestRig']>;
    const user = req.session?.user as SessionUser;

    const info: RequestPageInfo = {
      rig: summary(rig, slug, name),
      user: { id: user.id, displayName, avatarUrl: user.avatarUrl },
      nowPlaying: nowPlaying(rig),
      mine: rig.requestsBy(user.id).slice(0, 10),
      remaining: spend(`${rig.guildId}:${user.id}`, false),
    };
    res.json(info);
  });

  /**
   * Searching the rig's library.
   *
   * Only ever answers a query — there is no listing, and a blank search returns
   * nothing rather than the whole pool. Somebody who can ask for a track can
   * confirm whether a particular record is in the box, which is the point; they
   * cannot walk away with the box.
   */
  app.get('/api/requests/:slug/search', guard, (req, res) => {
    const { rig } = req.requestRig as NonNullable<Request['requestRig']>;
    if (!rig.store.db.tools.requests) {
      return res.status(403).json({ error: 'This rig is not taking requests.' });
    }

    const query = String(req.query.q ?? '').trim().toLowerCase();
    if (query.length < 2) return res.json({ tracks: [] });

    const tracks: RequestTrack[] = rig.store
      .listMedia()
      .filter((item) => item.status === 'ready' && item.title.toLowerCase().includes(query))
      .slice(0, SEARCH_LIMIT)
      .map((item) => ({
        mediaId: item.id,
        title: item.title,
        durationMs: item.durationMs,
        bpm: item.bpm,
      }));

    res.json({ tracks });
  });

  app.post('/api/requests/:slug', guard, json, (req, res) => {
    const { rig, displayName } = req.requestRig as NonNullable<Request['requestRig']>;
    const user = req.session?.user as SessionUser;
    const key = `${rig.guildId}:${user.id}`;

    if (!rig.store.db.tools.requests) {
      return res.status(403).json({ error: 'This rig is not taking requests.' });
    }
    if (spend(key, false) <= 0) {
      return res.status(429).json({
        error: `That is ${PER_WINDOW} requests in a row — give the booth a chance to get through them.`,
      });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const mediaId = typeof body.mediaId === 'string' && body.mediaId ? body.mediaId : null;
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, TEXT_MAX) : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : '';

    if (!mediaId && text.length < 2) {
      return res.status(400).json({ error: 'Say what you are after.' });
    }

    try {
      const item = rig.addRequest(
        { id: user.id, name: displayName, avatarUrl: user.avatarUrl },
        { mediaId, text, note },
      );
      // Only counted once it is actually on the list, so a duplicate or a track
      // that has gone missing does not cost somebody one of their asks.
      const remaining = spend(key, true);
      res.json({ request: item, remaining });
    } catch (err) {
      if (err instanceof CommandError) return res.status(400).json({ error: err.message });
      log.error('request failed:', (err as Error).message);
      res.status(500).json({ error: 'That did not go through — try again in a moment.' });
    }
  });
}
