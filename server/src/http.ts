import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import {
  attachUser,
  authorizeUrl,
  avatarUrl,
  checkAccess,
  clearSession,
  cookieNames,
  exchangeCode,
  issueSession,
  invalidateAccess,
  isPlatformAdmin,
  maySignIn,
  newState,
  readStateCookie,
  requirePlatformAdmin,
  requireUser,
  setStateCookie,
} from './auth';
import { BotError } from './discord/bots';
import { config } from './config';
import { rigs } from './rigManager';
import type { Rig } from './rig';
import * as platform from './db/platform';
import { createLogger } from './logger';
import { mountOnboarding } from './onboard';
import { mountRequests } from './requests';
import { DECK_IDS, type SessionUser } from './protocol';

const log = createLogger('http');


/**
 * The pages somebody who is not on the allowlist is allowed to be sent to after
 * signing in. Kept as one pattern rather than checked in two places, because it
 * is the line between a listener session and a DJ one.
 */
const REQUEST_PATH = /^\/(?:g\/)?[a-z0-9-]+\/request$|^\/request$/;
const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]{20,80})$/;

/** The most people who can be waiting at once, as a backstop against a flood. */
const WAITLIST_LIMIT = 5000;
/**
 * Attempts allowed from one address per hour. Counted against every request
 * rather than every stored entry, so it is set high enough that somebody
 * mistyping their address a few times never meets it - the honeypot and the
 * duplicate check are what actually stop a script.
 */
const WAITLIST_PER_HOUR = 12;

const waitlistHits = new Map<string, { count: number; resetAt: number }>();

/**
 * A plain fixed-window limiter. In memory rather than in the database because
 * a restart clearing it is the right behaviour - the limit exists to stop a
 * script, not to punish anyone across days.
 */
function withinRate(address: string): boolean {
  const now = Date.now();
  const hit = waitlistHits.get(address);
  if (!hit || now > hit.resetAt) {
    // Sweeping here keeps the map from growing without a timer to prune it.
    for (const [key, value] of waitlistHits) if (now > value.resetAt) waitlistHits.delete(key);
    waitlistHits.set(address, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (hit.count >= WAITLIST_PER_HOUR) return false;
  hit.count++;
  return true;
}

/**
 * Bot failures are mostly the operator's to fix - a bad token, a bot that has
 * not been invited - so those are reported as they came. Anything else is
 * logged and reduced to a generic message rather than risking a token or an
 * internal path in the response.
 */
function sendBotError(res: Response, err: unknown): void {
  if (err instanceof BotError) {
    res.status(400).json({ error: err.message });
    return;
  }
  log.error('bot management failed:', (err as Error).message);
  res.status(500).json({ error: 'That did not work - check the server log.' });
}

declare module 'express-serve-static-core' {
  interface Request {
    rig?: Rig;
  }
}

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(attachUser);

  /**
   * The portal answers on its own hostname, but it is the same bundle and the
   * same session - so rather than a second build, the portal host simply lands
   * on the portal route. It stays reachable at /portal on the main host too,
   * which is what makes it work on localhost where there is no second name.
   */
  app.use((req, res, next) => {
    const host = req.hostname?.toLowerCase();
    if (!config.http.portalHost || host !== config.http.portalHost) return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();
    if (req.path.startsWith('/portal')) return next();
    if (req.path.includes('.')) return next(); // built assets
    return res.redirect('/portal');
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rigs: rigs.count,
      voice: rigs.all.map((rig) => ({
        guildId: rig.guildId,
        status: rig.voice.snapshot().status,
        hosted: rig.host.hosted,
      })),
      uptime: process.uptime(),
    });
  });

  // ------------------------------------------------------------- auth ---

  /**
   * `next` is where to land afterwards - the request page uses it, because
   * somebody who followed a link to ask for a track should end up back at that
   * rig's page and not at a console they cannot open. Only same-site paths are
   * kept; anything else is dropped and they go to the front door.
   */
  app.get('/api/auth/login', (req, res) => {
    const state = newState();
    const wanted = String(req.query.next ?? '');
    setStateCookie(res, state, /^\/(?!\/)[\w\-/]*$/.test(wanted) ? wanted : undefined);
    res.redirect(authorizeUrl(state));
  });

  app.get('/api/auth/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const { state: expected, next } = readStateCookie(req.cookies?.[cookieNames.state]);
    res.clearCookie(cookieNames.state, { path: '/' });

    // Failures go back to /login rather than /, so the reason lands beside the
    // button that failed instead of on the marketing page.
    if (error) return res.redirect(`/login?error=${encodeURIComponent(error)}`);
    if (!code || !state || !expected || state !== expected) {
      return res.redirect('/login?error=' + encodeURIComponent('Login state mismatch - try again.'));
    }

    try {
      const { profile } = await exchangeCode(code);
      const fallbackName = profile.global_name || profile.username;

      const user: SessionUser = {
        id: profile.id,
        username: profile.username,
        displayName: fallbackName,
        avatarUrl: avatarUrl(profile),
        isAdmin: false,
        isPlatformAdmin: isPlatformAdmin(profile.id),
      };

      // An invite is redeemed only after Discord has identified the recipient.
      // It admits them to the platform and may additionally grant one rig.
      const inviteToken = next?.match(INVITE_PATH)?.[1];
      if (inviteToken) {
        const invite = platform.redeemInvite(inviteToken, user.id);
        if (!invite) return res.redirect('/login?error=' + encodeURIComponent('That invite has expired or was already used.'));
        platform.allow({ discordId: user.id, note: invite.note || 'Accepted an invite', canOnboard: false, addedBy: invite.createdBy });
        if (invite.guildId) invalidateAccess(invite.guildId, user.id);
        issueSession(res, user);
        const guild = invite.guildId ? platform.getGuild(invite.guildId) : null;
        return res.redirect(guild ? `/g/${guild.slug}/deck` : '/rigs');
      }

      // The allowlist is the whole of the gate at this point. Which rigs they
      // can reach is a question for each rig, asked when they open one.
      if (!maySignIn(profile.id)) {
        // Except for the request page, which is for the room rather than for
        // the booth: anybody in the Discord server may ask for a track. They
        // get a listener session, which every other route in the server refuses
        // - the rig then checks they are actually in that guild.
        if (next && REQUEST_PATH.test(next)) {
          issueSession(res, user, 'listener');
          log.info(`${user.displayName} signed in to ask for a track`);
          return res.redirect(next);
        }
        return res.redirect(
          '/login?error=' +
            encodeURIComponent('That Discord account has not been given access to Deck yet.'),
        );
      }

      issueSession(res, user);
      log.info(`${user.displayName} signed in`);
      res.redirect(next ?? '/');
    } catch (err) {
      log.warn('login failed:', (err as Error).message);
      res.redirect('/login?error=' + encodeURIComponent((err as Error).message));
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: req.user, publicUrl: config.http.publicUrl });
  });

  app.get('/api/invites/:token', (req, res) => {
    const invite = platform.getInviteByToken(req.params.token);
    if (!invite || invite.usedAt || invite.expiresAt <= Date.now()) {
      return res.status(404).json({ error: 'That invite has expired or was already used.' });
    }
    const guild = invite.guildId ? platform.getGuild(invite.guildId) : null;
    res.json({ invite: { note: invite.note, expiresAt: invite.expiresAt, guild: guild ? { name: guild.name, slug: guild.slug } : null } });
  });

  /** Which rigs this person can actually open, for the picker after sign-in. */
  app.get('/api/rigs', requireUser, async (req, res) => {
    const user = req.user as SessionUser;
    const found = await Promise.all(
      platform.listGuilds().map(async (guild) => {
        if (guild.status !== 'active') return null;
        const access = await checkAccess(guild.id, user.id, user.displayName);
        if (!access.allowed) return null;
        const rig = rigs.get(guild.id);
        return {
          id: guild.id,
          slug: guild.slug,
          name: guild.name,
          isAdmin: access.isAdmin,
          running: rig !== null,
          hosted: rig?.host.hosted ?? false,
          live: rig?.voice.snapshot().status === 'ready',
        };
      }),
    );
    res.json({ rigs: found.filter(Boolean) });
  });

  mountOnboarding(app);
  mountRequests(app);

  // --------------------------------------------------------- waitlist ---

  /**
   * Requests for access. The only endpoint here that anyone can reach without
   * a Discord session, so it is also the only one that needs its own defences:
   * a per-address rate limit, a field no human ever fills in, hard length caps
   * and a ceiling on the list as a whole.
   *
   * What comes back is deliberately the same whether the entry was stored or
   * quietly dropped - a form that reports "you are already on the list" is a
   * way to ask whether an address is.
   */
  app.post('/api/waitlist', express.json({ limit: '32kb' }), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = (value: unknown, max: number) =>
      typeof value === 'string' ? value.trim().slice(0, max) : '';

    // A field hidden from people and irresistible to form-fillers.
    if (text(body.website, 80)) return res.json({ ok: true });

    if (!withinRate(req.ip ?? 'unknown')) {
      return res.status(429).json({ error: 'Too many requests - try again later.' });
    }

    const entry = {
      discord: text(body.discord, 60),
      email: text(body.email, 160),
      community: text(body.community, 120),
      size: text(body.size, 40),
      note: text(body.note, 600),
    };

    if (!entry.discord) return res.status(400).json({ error: 'Add your Discord handle.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(entry.email)) {
      return res.status(400).json({ error: 'That email address does not look right.' });
    }
    if (!entry.community) return res.status(400).json({ error: 'Tell us where it is for.' });

    if (!platform.waitlistHas(entry.discord, entry.email) && platform.waitlistCount() < WAITLIST_LIMIT) {
      platform.addWaitlist({ id: crypto.randomUUID(), ...entry, at: Date.now() });
      log.info(`waitlist: ${entry.discord} (${entry.community})`);
    }
    res.json({ ok: true });
  });

  // ----------------------------------------------------------- portal ---

  const json = express.json({ limit: '8kb' });

  app.get('/api/portal/overview', requirePlatformAdmin, (_req, res) => {
    res.json({
      guilds: platform.listGuilds().map((guild) => {
        const rig = rigs.get(guild.id);
        const voice = rig?.voice.snapshot();
        return {
          ...guild,
          running: rig !== null,
          host: rig?.host.snapshot() ?? null,
          voice: voice ? { status: voice.status, channelName: voice.channelName } : null,
          bot: rig?.bots.active() ?? null,
          tracks: rig ? rig.store.listMedia().length : 0,
        };
      }),
      allowlist: platform.listAllowed(),
      waitlist: platform.listWaitlist(),
      invites: platform.listInvites(),
      bots: platform.listBots().map((bot) => ({
        id: bot.id,
        name: bot.name,
        applicationId: bot.applicationId,
        tag: bot.tag,
        fingerprint: bot.fingerprint,
        addedBy: bot.addedBy,
        addedAt: bot.addedAt,
      })),
      health: {
        rigs: rigs.count,
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        uptime: Math.round(process.uptime()),
      },
    });
  });

  app.post('/api/portal/allow', requirePlatformAdmin, json, (req, res) => {
    const discordId = String(req.body?.discordId ?? '').trim();
    if (!/^\d{15,25}$/.test(discordId)) {
      return res.status(400).json({ error: 'That does not look like a Discord user id.' });
    }
    platform.allow({
      discordId,
      note: String(req.body?.note ?? '').slice(0, 200),
      canOnboard: req.body?.canOnboard !== false,
      addedBy: (req.user as SessionUser).id,
    });
    res.json({ allowlist: platform.listAllowed() });
  });

  app.delete('/api/portal/allow/:id', requirePlatformAdmin, (req, res) => {
    platform.disallow(req.params.id);
    res.json({ allowlist: platform.listAllowed() });
  });

  app.delete('/api/portal/waitlist/:id', requirePlatformAdmin, (req, res) => {
    platform.removeWaitlist(req.params.id);
    res.json({ waitlist: platform.listWaitlist() });
  });

  app.post('/api/portal/invites', requirePlatformAdmin, json, (req, res) => {
    const guildId = typeof req.body?.guildId === 'string' && platform.getGuild(req.body.guildId) ? req.body.guildId : null;
    const days = Math.min(30, Math.max(1, Number(req.body?.days) || 7));
    const created = platform.createInvite({ guildId, note: String(req.body?.note ?? '').trim().slice(0, 160),
      createdBy: (req.user as SessionUser).id, expiresAt: Date.now() + days * 86400000 });
    res.json({ invite: created.invite, url: `${config.http.publicUrl}/invite/${created.token}` });
  });

  app.get('/api/portal/invites', requirePlatformAdmin, (_req, res) => {
    res.json({ invites: platform.listInvites() });
  });

  app.delete('/api/portal/invites/:id', requirePlatformAdmin, (req, res) => {
    platform.revokeInvite(req.params.id);
    res.json({ ok: true });
  });

  const portalRig = async (id: string): Promise<Rig | null> => rigs.ensure(id);

  app.get('/api/portal/rigs/:id/bots', requirePlatformAdmin, async (req, res) => {
    const rig = await portalRig(req.params.id);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    res.json({ bots: rig.bots.list(), active: rig.bots.active() });
  });

  app.post('/api/portal/rigs/:id/bots', requirePlatformAdmin, json, async (req, res) => {
    const rig = await portalRig(req.params.id);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    try {
      await rig.bots.add(req.user as SessionUser, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        token: typeof req.body?.token === 'string' ? req.body.token : '',
      });
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) { sendBotError(res, err); }
  });

  app.post('/api/portal/rigs/:id/bots/:botId/activate', requirePlatformAdmin, async (req, res) => {
    const rig = await portalRig(req.params.id);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    try {
      await rig.bots.activate(req.user as SessionUser, req.params.botId);
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) { sendBotError(res, err); }
  });

  app.delete('/api/portal/rigs/:id/bots/:botId', requirePlatformAdmin, async (req, res) => {
    const rig = await portalRig(req.params.id);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });
    try {
      await rig.bots.remove(req.user as SessionUser, req.params.botId);
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) { sendBotError(res, err); }
  });

  app.post('/api/portal/rigs/:id/stop', requirePlatformAdmin, async (req, res) => {
    await rigs.stop(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/portal/rigs/:id/start', requirePlatformAdmin, async (req, res) => {
    const rig = await rigs.ensure(req.params.id);
    res.json({ ok: rig !== null });
  });

  app.delete('/api/portal/rigs/:id', requirePlatformAdmin, async (req, res) => {
    await rigs.stop(req.params.id);
    platform.deleteGuild(req.params.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------------ guild scope ---

  /**
   * Everything below here belongs to one rig.
   *
   * The guild is resolved and the caller's access to it re-checked on every
   * request rather than trusted from the session - losing a DJ role has to take
   * effect on the next request, not whenever the token happens to expire.
   */
  async function withRig(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }

    const rig = await rigs.ensure(req.params.guildId);
    if (!rig) {
      res.status(404).json({ error: 'No such rig, or it is not running.' });
      return;
    }

    const access = await checkAccess(rig.guildId, user.id, user.displayName);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason ?? 'You do not have access to that rig.' });
      return;
    }

    req.rig = rig;
    req.user = { ...user, displayName: access.displayName, isAdmin: access.isAdmin };
    next();
  }

  const guild = express.Router({ mergeParams: true });
  guild.use((req, res, next) => void withRig(req, res, next));

  guild.get('/media', (req, res) => {
    res.json({ media: (req.rig as Rig).store.listMedia() });
  });

  guild.get('/invites', (req, res) => {
    const user = req.user as SessionUser;
    if (!user.isAdmin) return res.status(403).json({ error: 'Only a rig owner or admin can invite DJs.' });
    const rig = req.rig as Rig;
    res.json({ invites: platform.listInvites(rig.guildId), members: platform.listGuildMembers(rig.guildId) });
  });

  guild.post('/invites', json, (req, res) => {
    const user = req.user as SessionUser;
    if (!user.isAdmin) return res.status(403).json({ error: 'Only a rig owner or admin can invite DJs.' });
    const rig = req.rig as Rig;
    const days = Math.min(30, Math.max(1, Number(req.body?.days) || 7));
    const created = platform.createInvite({ guildId: rig.guildId, note: String(req.body?.note ?? '').trim().slice(0, 160),
      createdBy: user.id, expiresAt: Date.now() + days * 86400000 });
    res.json({ invite: created.invite, url: `${config.http.publicUrl}/invite/${created.token}` });
  });

  guild.delete('/invites/:id', (req, res) => {
    const user = req.user as SessionUser;
    if (!user.isAdmin) return res.status(403).json({ error: 'Only a rig owner or admin can revoke invitations.' });
    const rig = req.rig as Rig;
    const invite = platform.listInvites(rig.guildId).find((entry) => entry.id === req.params.id);
    if (!invite) return res.status(404).json({ error: 'No such invitation.' });
    platform.revokeInvite(invite.id);
    res.json({ ok: true });
  });

  guild.delete('/members/:id', (req, res) => {
    const user = req.user as SessionUser;
    if (!user.isAdmin) return res.status(403).json({ error: 'Only a rig owner or admin can remove invited DJs.' });
    const rig = req.rig as Rig;
    platform.removeGuildMember(rig.guildId, req.params.id);
    invalidateAccess(rig.guildId, req.params.id);
    res.json({ ok: true });
  });

  /**
   * Serves a decoded upload so a DJ can pre-listen without touching the mix.
   *
   * Only ever finds anything for a track that came in through an upload; one
   * played off somebody's folder is already on their machine, and the console
   * cues it locally without asking the server for it at all.
   */
  /**
   * Which Discord account this rig plays through.
   *
   * On HTTP rather than the socket deliberately: the socket broadcasts state to
   * every signed-in DJ, and this is platform-admin territory - adding a bot
   * means handing the server a token. Tokens are never returned, only
   * fingerprints.
   */
  guild.get('/bots', requirePlatformAdmin, (req, res) => {
    const rig = req.rig as Rig;
    res.json({ bots: rig.bots.list(), active: rig.bots.active() });
  });

  guild.post('/bots', requirePlatformAdmin, json, async (req, res) => {
    const rig = req.rig as Rig;
    try {
      const added = await rig.bots.add(req.user as SessionUser, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        token: typeof req.body?.token === 'string' ? req.body.token : '',
      });
      res.json({ bot: added, bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) {
      sendBotError(res, err);
    }
  });

  guild.post('/bots/:id/activate', requirePlatformAdmin, async (req, res) => {
    const rig = req.rig as Rig;
    try {
      await rig.bots.activate(req.user as SessionUser, req.params.id);
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) {
      sendBotError(res, err);
    }
  });

  guild.delete('/bots/:id', requirePlatformAdmin, async (req, res) => {
    const rig = req.rig as Rig;
    try {
      await rig.bots.remove(req.user as SessionUser, req.params.id);
      res.json({ bots: rig.bots.list(), active: rig.bots.active() });
    } catch (err) {
      sendBotError(res, err);
    }
  });

  app.use('/api/g/:guildId', guild);

  // ------------------------------------------------------------ tools ---

  /**
   * Live deck positions for lighting desks, overlays and video.
   *
   * Consumers of this cannot hold a Discord session, so the key in the query
   * string is the credential. It is rotated every time the tool is switched on,
   * and the endpoint disappears entirely when it is off.
   */
  app.get('/api/g/:guildId/timecode', (req, res) => {
    const rig = rigs.get(req.params.guildId);
    if (!rig) return res.status(404).json({ error: 'No such rig.' });

    const tools = rig.store.db.tools;
    if (!tools.timecode) return res.status(404).json({ error: 'The timecode feed is off.' });

    const supplied = String(req.query.key ?? '');
    const expected = tools.timecodeKey;
    // Compared over fixed-length digests so a wrong key cannot be narrowed down
    // by timing the response.
    const ok =
      expected.length > 0 &&
      crypto.timingSafeEqual(
        crypto.createHash('sha256').update(supplied).digest(),
        crypto.createHash('sha256').update(expected).digest(),
      );
    if (!ok) return res.status(403).json({ error: 'Bad or missing key.' });

    const state = rig.state();
    res.setHeader('cache-control', 'no-store');
    res.setHeader('access-control-allow-origin', '*');
    res.json({
      serverTime: state.serverTime,
      decks: DECK_IDS.map((id) => {
        const deck = state.decks[id];
        return {
          deck: id,
          mediaId: deck.mediaId,
          title: deck.title,
          playing: deck.playing,
          positionMs: deck.positionMs,
          durationMs: deck.durationMs,
          remainingMs: Math.max(0, deck.durationMs - deck.positionMs),
          rate: deck.rate,
          bpm: deck.bpm === null ? null : deck.bpm * deck.rate,
        };
      }),
      mixer: { crossfader: state.mixer.crossfader, master: state.mixer.master },
      voice: { status: state.voice.status, channelName: state.voice.channelName },
    });
  });

  // ----------------------------------------------------------- static ---

  const webDist = config.paths.webDist;
  if (fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('cache-control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) return next();

      // A hashed asset express.static did not find is gone, not a route. Falling
      // through to index.html answers a stylesheet or module request with HTML,
      // which the browser refuses on the MIME mismatch - the page renders
      // unstyled, or blank, with nothing but 200s in the network log. A browser
      // holding index.html from an earlier build asks for exactly these, so let
      // it have the 404 and fetch the shell again.
      if (req.path.startsWith('/assets/')) return next();

      // The shell names the current build's hashed assets, so it has to be
      // revalidated every load; the assets it points at stay immutable.
      res.sendFile(path.join(webDist, 'index.html'), {
        headers: { 'cache-control': 'no-cache' },
      });
    });
  } else {
    log.warn(`web build not found at ${webDist} - run "npm run build -w web"`);
    app.get('/', (_req, res) => {
      res.status(503).send('Web UI has not been built yet. Run: npm run build -w web');
    });
  }

  app.use((
    err: Error & { code?: string; type?: string },
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `Files must be under ${config.http.maxUploadBytes / 1048576} MB.` });
      return;
    }
    // A body past the JSON limit is the sender's to fix, and saying so beats
    // the 500 it would otherwise fall through to.
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'That was too long - shorten it and try again.' });
      return;
    }
    log.error('unhandled http error:', err?.message ?? err);
    res.status(500).json({ error: 'Internal error.' });
  });

  return app;
}
