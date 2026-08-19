import { Rig } from './rig';
import { GuildStore } from './store';
import { getGuild, getGuildBySlug, listGuilds } from './db/platform';
import type { GuildRecord } from './store';
import { attachCommandHandlers } from './discord/commands';
import { verifyAuthAccess } from './discord/gate';
import { createLogger } from './logger';

const log = createLogger('rigs');

/**
 * Every rig this process is running.
 *
 * The only singleton left. Everything a guild owns - its mixer, its gateway
 * session, its store, its control lock - hangs off a `Rig`, and this is the map
 * from a guild id to one. What used to be five module-level instances is now
 * one map, which is the whole of the multi-guild change: the audio graph itself
 * was already properly instance-scoped and needed nothing.
 *
 * Rigs are started one at a time rather than all at once. Each start logs into
 * Discord, and twenty simultaneous logins is a rate limit rather than a fast
 * boot.
 */
class RigManager {
  private rigs = new Map<string, Rig>();
  private starting = new Map<string, Promise<Rig>>();

  get all(): Rig[] {
    return [...this.rigs.values()];
  }

  get count(): number {
    return this.rigs.size;
  }

  get(guildId: string): Rig | null {
    return this.rigs.get(guildId) ?? null;
  }

  bySlug(slug: string): Rig | null {
    const record = getGuildBySlug(slug);
    return record ? this.get(record.id) : null;
  }

  /** Brings up every active rig in the database. */
  async startAll(): Promise<void> {
    const guilds = listGuilds().filter((g) => g.status === 'active');
    if (guilds.length === 0) {
      log.info('no rigs configured yet - add one from the portal');
      return;
    }

    for (const guild of guilds) {
      try {
        await this.start(guild);
      } catch (err) {
        // One guild that cannot start must not stop the others. A bad token or
        // a bot that was kicked is that guild's problem, and the rest of the
        // platform carries on without it.
        log.error(`could not start ${guild.slug} (${guild.id}): ${(err as Error).message}`);
      }
    }
    log.info(`${this.rigs.size} of ${guilds.length} rig${guilds.length === 1 ? '' : 's'} running`);
  }

  /** Starts one rig, or returns the running one. Concurrent calls share a start. */
  async ensure(guildId: string): Promise<Rig | null> {
    const running = this.rigs.get(guildId);
    if (running) return running;

    const pending = this.starting.get(guildId);
    if (pending) return pending;

    const record = getGuild(guildId);
    if (!record || record.status !== 'active') return null;

    const job = this.start(record).finally(() => this.starting.delete(guildId));
    this.starting.set(guildId, job);
    return job;
  }

  private async start(record: GuildRecord): Promise<Rig> {
    const store = new GuildStore(record.id);
    const rig = new Rig(record.id, store);

    // Handlers before the login: they are registered against every client the
    // bot connects, including the one `start` is about to bring up.
    attachCommandHandlers(rig);
    await rig.start();

    this.rigs.set(record.id, rig);
    // Not awaited: it only logs whether sign-in will work, and a slow Discord
    // should not hold up a rig that is otherwise ready to play.
    void verifyAuthAccess(record.id);
    log.info(`${record.slug} (${record.name}) is up`);
    return rig;
  }

  async stop(guildId: string): Promise<void> {
    const rig = this.rigs.get(guildId);
    if (!rig) return;
    this.rigs.delete(guildId);
    await rig.shutdown();
    log.info(`${guildId} stopped`);
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(this.all.map((rig) => rig.shutdown()));
    this.rigs.clear();
  }
}

export const rigs = new RigManager();
