import { EventEmitter } from 'node:events';
import { config } from './config';
import { createLogger } from './logger';
import type { ControlState, SessionUser } from './protocol';

const log = createLogger('control');

export type RequestOutcome = 'granted' | 'queued' | 'already-holder' | 'already-queued';

/**
 * Single-operator lock over the mix.
 *
 * Any number of DJs can be signed in and watching, but exactly one holds
 * control at a time. Others queue; the lock hands over automatically when the
 * holder releases, disconnects (after a grace period) or goes idle *while
 * somebody is waiting*. An idle holder with an empty queue keeps the decks —
 * there is nobody to hand them to, and silently dropping control mid-set would
 * be worse than holding it.
 */
export class ControlLock extends EventEmitter {
  private holder: { id: string; name: string } | null = null;
  private heldSince = 0;
  private lastActivity = 0;
  private queue: { userId: string; name: string; requestedAt: number }[] = [];
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  private sweep: NodeJS.Timeout;

  constructor() {
    super();
    this.sweep = setInterval(() => this.enforceIdleTimeout(), 2_000);
    this.sweep.unref?.();
  }

  get holderId(): string | null {
    return this.holder?.id ?? null;
  }

  has(userId: string): boolean {
    return this.holder?.id === userId;
  }

  snapshot(): ControlState {
    return {
      holderId: this.holder?.id ?? null,
      holderName: this.holder?.name ?? null,
      heldSince: this.holder ? this.heldSince : null,
      expiresAt: this.expiresAt(),
      queue: this.queue.map((q) => ({ ...q })),
    };
  }

  private expiresAt(): number | null {
    if (!this.holder || this.queue.length === 0 || config.control.idleTimeoutMs <= 0) return null;
    return this.lastActivity + config.control.idleTimeoutMs;
  }

  /** Called for every accepted mutation so an active DJ never times out. */
  touch(userId: string): void {
    if (this.holder?.id === userId) {
      const hadDeadline = this.expiresAt() !== null;
      this.lastActivity = Date.now();
      if (hadDeadline) this.emit('change');
    }
  }

  request(user: SessionUser): RequestOutcome {
    if (this.holder?.id === user.id) return 'already-holder';
    if (!this.holder) {
      this.assign(user.id, user.displayName);
      return 'granted';
    }
    if (this.queue.some((q) => q.userId === user.id)) return 'already-queued';
    this.queue.push({ userId: user.id, name: user.displayName, requestedAt: Date.now() });
    this.emit('change');
    return 'queued';
  }

  cancel(userId: string): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.userId !== userId);
    if (this.queue.length !== before) {
      this.emit('change');
      return true;
    }
    return false;
  }

  release(userId: string): boolean {
    if (this.holder?.id !== userId) return false;
    log.info(`${this.holder.name} released control`);
    this.holder = null;
    this.promote();
    this.emit('change');
    return true;
  }

  /** Admin override — seizes the lock regardless of who holds it. */
  take(user: SessionUser): void {
    if (this.holder && this.holder.id !== user.id) {
      log.warn(`${user.displayName} force-took control from ${this.holder.name}`);
      // The evicted DJ goes to the front of the queue rather than being dropped.
      this.queue.unshift({
        userId: this.holder.id,
        name: this.holder.name,
        requestedAt: Date.now(),
      });
    }
    this.assign(user.id, user.displayName);
  }

  /** Hand control to a specific user (holder passing the baton, or an admin). */
  grant(target: { id: string; name: string }): void {
    this.queue = this.queue.filter((q) => q.userId !== target.id);
    this.assign(target.id, target.name);
  }

  private assign(id: string, name: string): void {
    this.holder = { id, name };
    this.heldSince = Date.now();
    this.lastActivity = Date.now();
    this.queue = this.queue.filter((q) => q.userId !== id);
    this.clearDisconnectTimer(id);
    log.info(`${name} has control`);
    this.emit('change');
    this.emit('granted', id, name);
  }

  private promote(): void {
    const next = this.queue.shift();
    if (next) this.assign(next.userId, next.name);
  }

  /**
   * Last browser tab for this user closed. Control is kept for a short grace
   * period so a refresh or a flaky connection does not cost a DJ their set.
   */
  onUserDisconnected(userId: string): void {
    this.cancel(userId);
    if (this.holder?.id !== userId) return;
    this.clearDisconnectTimer(userId);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(userId);
      if (this.holder?.id !== userId) return;
      log.info(`${this.holder.name} dropped (disconnected)`);
      this.holder = null;
      this.promote();
      this.emit('change');
    }, config.control.disconnectGraceMs);
    timer.unref?.();
    this.disconnectTimers.set(userId, timer);
    this.emit('change');
  }

  onUserConnected(userId: string): void {
    this.clearDisconnectTimer(userId);
  }

  private clearDisconnectTimer(userId: string): void {
    const timer = this.disconnectTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(userId);
    }
  }

  private enforceIdleTimeout(): void {
    const deadline = this.expiresAt();
    if (deadline === null || !this.holder) return;
    if (Date.now() < deadline) return;
    log.info(`${this.holder.name} timed out while others were waiting`);
    const evicted = this.holder;
    this.holder = null;
    this.promote();
    this.emit('timeout', evicted.id, evicted.name);
    this.emit('change');
  }

  /** Forget a user entirely (used when an admin evicts someone). */
  purge(userId: string): void {
    this.cancel(userId);
    if (this.holder?.id === userId) {
      this.holder = null;
      this.promote();
      this.emit('change');
    }
  }

  dispose(): void {
    clearInterval(this.sweep);
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
  }
}
