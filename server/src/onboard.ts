import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { isPlatformAdmin, requireUser } from './auth';
import { config } from './config';
import * as platform from './db/platform';
import { guildInfo, guildRoles, verifyAuthAccess } from './discord/gate';
import { rigs } from './rigManager';
import { createLogger } from './logger';
import type { SessionUser } from './protocol';

const log = createLogger('onboard');

const STATE_COOKIE = 'rnl_dj_onboard';

/**
 * Setting up a new rig.
 *
 * The whole thing hangs off Discord's own bot-authorisation flow rather than
 * asking anyone to paste a guild id. Discord shows them a server picker they
 * already understand, and hands the guild id back in the callback — which also
 * means this never has to hold an OAuth token to go looking for the servers
 * somebody administers. Discord decides who may add a bot where; there is no
 * reason to re-derive that here and a good reason not to.
 */

/** Connect, Speak, View Channel — the least a rig can do its job with. */
const PERMISSIONS = (1n << 20n) | (1n << 21n) | (1n << 10n);

function inviteUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.discord.playback.applicationId,
    scope: 'bot applications.commands',
    permissions: PERMISSIONS.toString(),
    redirect_uri: `${config.http.publicUrl}/api/onboard/callback`,
    response_type: 'code',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function mayOnboard(user: SessionUser): boolean {
  if (isPlatformAdmin(user.id)) return true;
  return platform.isAllowed(user.id)?.canOnboard === true;
}

export function mountOnboarding(app: express.Express): void {
  const json = express.json({ limit: '8kb' });

  /** What the wizard needs to draw itself. */
  app.get('/api/onboard/state', requireUser, (req, res) => {
    const user = req.user as SessionUser;
    res.json({
      mayOnboard: mayOnboard(user),
      rigs: platform.listGuilds().map((guild) => ({
        id: guild.id,
        slug: guild.slug,
        name: guild.name,
        createdBy: guild.createdBy,
      })),
    });
  });

  app.get('/api/onboard/invite', requireUser, (req, res) => {
    const user = req.user as SessionUser;
    if (!mayOnboard(user)) {
      return res.status(403).json({ error: 'You are not set up to create a rig.' });
    }

    // The state cookie carries who started this, so the callback can record who
    // created the rig without trusting anything that came back from Discord.
    const state = crypto.randomBytes(24).toString('base64url');
    res.cookie(STATE_COOKIE, `${state}.${user.id}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.http.publicUrl.startsWith('https://'),
      maxAge: 15 * 60 * 1000,
      path: '/',
      ...(config.http.cookieDomain ? { domain: config.http.cookieDomain } : {}),
    });
    res.redirect(inviteUrl(state));
  });

  /**
   * Discord sends them back here after they pick a server.
   *
   * `guild_id` is the whole point: it is the server they chose, from Discord's
   * own picker, and it is not something the browser could have made up.
   */
  app.get('/api/onboard/callback', async (req: Request, res: Response) => {
    const { guild_id: guildId, state, error } = req.query as Record<string, string | undefined>;
    const cookie = req.cookies?.[STATE_COOKIE] as string | undefined;
    res.clearCookie(STATE_COOKIE, { path: '/' });

    const fail = (message: string) => res.redirect('/onboard?error=' + encodeURIComponent(message));

    if (error) return fail(error);
    if (!cookie || !state) return fail('That setup link expired — start again.');

    const [expected, startedBy] = cookie.split('.');
    if (!expected || expected !== state) return fail('Setup state mismatch — start again.');
    if (!guildId) return fail('Discord did not say which server that was. Try again.');

    // The person who started it has to still be the person finishing it, and
    // still allowed to. A stale cookie is not authority.
    const session = req.user;
    if (!session || session.id !== startedBy || !mayOnboard(session)) {
      return fail('Sign in again and restart the setup.');
    }

    const existing = platform.getGuild(guildId);
    if (existing) {
      log.info(`${session.displayName} re-invited the bot to ${existing.slug}`);
      return res.redirect(`/onboard?rig=${encodeURIComponent(existing.slug)}`);
    }

    // The same bot that was just invited is the one the sign-in gate reads
    // membership with, so this should always pass. It is checked anyway,
    // because "should always pass" is where the surprising failures live and
    // this one would otherwise surface as nobody being able to log in.
    const gateOk = await verifyAuthAccess(guildId);
    const info = await guildInfo(guildId);

    const record = platform.createGuild({
      id: guildId,
      name: info?.name ?? 'New rig',
      createdBy: session.id,
      // Left empty on purpose: no DJ role means every member of the server can
      // use the decks, which is the sane default for somebody who has just set
      // this up and has not thought about roles yet. The wizard offers to
      // narrow it on the next step.
      djRoleIds: [],
      adminRoleIds: [],
    });

    log.info(`${session.displayName} created rig ${record.slug} for ${guildId}`);
    void rigs.ensure(guildId);

    res.redirect(
      `/onboard?rig=${encodeURIComponent(record.slug)}${gateOk ? '' : '&gate=missing'}`,
    );
  });

  /** The roles the wizard offers, once the bot is actually in the server. */
  app.get('/api/onboard/roles/:guildId', requireUser, async (req, res) => {
    const guild = platform.getGuild(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'No such rig.' });

    const user = req.user as SessionUser;
    if (guild.createdBy !== user.id && !isPlatformAdmin(user.id)) {
      return res.status(403).json({ error: 'That rig is not yours to set up.' });
    }

    res.json({
      guild: { id: guild.id, slug: guild.slug, name: guild.name },
      roles: await guildRoles(guild.id),
      djRoleIds: guild.djRoleIds,
      adminRoleIds: guild.adminRoleIds,
    });
  });

  app.post('/api/onboard/finish', requireUser, json, async (req, res) => {
    const user = req.user as SessionUser;
    const guildId = String(req.body?.guildId ?? '');
    const guild = platform.getGuild(guildId);
    if (!guild) return res.status(404).json({ error: 'No such rig.' });
    if (guild.createdBy !== user.id && !isPlatformAdmin(user.id)) {
      return res.status(403).json({ error: 'That rig is not yours to set up.' });
    }

    const ids = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string' && /^\d{15,25}$/.test(id)).slice(0, 20)
        : [];

    const name = String(req.body?.name ?? guild.name).trim().slice(0, 120) || guild.name;
    const wanted = String(req.body?.slug ?? '').trim().toLowerCase();
    // Only re-slugged when they actually asked for something different, so
    // finishing the wizard twice does not walk the URL to "nightshift-2".
    const slug =
      wanted && wanted !== guild.slug ? platform.uniqueSlug(wanted) : guild.slug;

    platform.updateGuild(guildId, {
      name,
      slug,
      djRoleIds: ids(req.body?.djRoleIds),
      adminRoleIds: ids(req.body?.adminRoleIds),
    });

    // Roles are baked into the access cache, so a change has to clear it or the
    // person who just set it up waits a minute to be let in.
    const { invalidateAccess } = await import('./auth');
    invalidateAccess(guildId);

    await rigs.ensure(guildId);
    log.info(`${user.displayName} finished setting up ${slug}`);
    res.json({ slug });
  });
}
