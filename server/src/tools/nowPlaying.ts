import { ActivityType } from 'discord.js';
import type { Bot } from '../discord/bot';
import { createLogger } from '../logger';
import type { DeckId, EngineState } from '../protocol';

const log = createLogger('nowplaying');

/**
 * Says what the room is hearing, to people who are not in the room.
 *
 * Two tools share one watcher because they answer the same question and it is
 * not a cheap one: what the channel is actually hearing is not "whichever deck
 * is playing" — it is the deck winning the crossfader, with its own fader up
 * and its mute off. Working that out twice would be two chances to disagree.
 *
 * It polls a state snapshot rather than hooking the broadcast path. The mix
 * changes sixty times a second and this needs to know roughly once a track;
 * polling at 2 Hz and settling for six seconds costs nothing and means a slow
 * crossfade announces the track that won it, not both of them in turn.
 */

const POLL_MS = 2000;
/** How long a track has to hold the room before it counts as the one playing. */
const SETTLE_MS = 6000;

/**
 * Only Discord's own webhook endpoints. This is the whole reason the tool
 * needs no address checking of its own: there is no host here for anyone to
 * point back at the machine the rig is running on.
 */
export const WEBHOOK_PATTERN =
  /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/(v\d{1,2}\/)?webhooks\/\d+\/[\w-]+$/;

interface Playing {
  mediaId: string;
  title: string;
  deck: DeckId;
}

/**
 * What the voice channel is hearing, or null if that is nothing worth naming.
 *
 * The crossfader law is the mixer's own, minus the curve — the curve changes
 * where the travel bites, not which side of it is louder, and this only has to
 * pick a winner.
 */
function audible(state: EngineState): Playing | null {
  const x = Math.max(-1, Math.min(1, state.mixer.crossfader));
  const theta = ((x + 1) / 2) * (Math.PI / 2);
  const across: Record<DeckId, number> = { A: Math.cos(theta), B: Math.sin(theta) };

  let best: Playing | null = null;
  let bestLevel = 0;
  for (const id of ['A', 'B'] as const) {
    const deck = state.decks[id];
    if (!deck.playing || deck.muted || !deck.mediaId) continue;
    const level = deck.gain * across[id];
    // Below this the deck is on its way out of the mix, or parked with the
    // fader down — either way it is not what the room would say is playing.
    if (level < 0.06 || level <= bestLevel) continue;
    bestLevel = level;
    best = { mediaId: deck.mediaId, title: deck.title ?? 'Untitled', deck: id };
  }
  return best;
}

export class NowPlaying {
  private timer: NodeJS.Timeout | null = null;
  private snapshot: (() => EngineState) | null = null;
  private presence = false;
  private webhook: string | null = null;

  /** The track being considered, and since when. */
  private candidate: string | null = null;
  private candidateSince = 0;
  /** The track already acted on, so nothing is said twice. */
  private settled: string | null = null;

  constructor(private readonly bot: Bot) {}

  /**
   * Brings the watcher in line with the tools. Safe to call on every change:
   * turning both tools off stops the timer and clears the bot's activity.
   */
  configure(options: {
    presence: boolean;
    webhook: string | null;
    snapshot: () => EngineState;
  }): void {
    const wasPresence = this.presence;
    this.presence = options.presence;
    this.webhook = options.webhook;
    this.snapshot = options.snapshot;

    if (wasPresence && !options.presence) this.clearActivity();

    if (!options.presence && !options.webhook) {
      this.stop();
      return;
    }
    // Re-announcing everything on an unrelated settings change would be noise,
    // so what has already been said stays said.
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), POLL_MS);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.candidate = null;
    this.settled = null;
  }

  private tick(): void {
    const get = this.snapshot;
    if (!get) return;

    const playing = audible(get());
    const key = playing?.mediaId ?? null;

    if (key !== this.candidate) {
      this.candidate = key;
      this.candidateSince = Date.now();
      return;
    }
    if (Date.now() - this.candidateSince < SETTLE_MS) return;
    if (key === this.settled) return;
    this.settled = key;

    if (this.presence) this.setActivity(playing);
    // Silence is not an announcement — the channel does not need telling that
    // a set ended three seconds ago.
    if (this.webhook && playing) void this.announce(playing);
  }

  private setActivity(playing: Playing | null): void {
    try {
      const user = this.bot.client.user;
      if (!user) return;
      if (!playing) return this.clearActivity();
      user.setActivity({ name: playing.title.slice(0, 120), type: ActivityType.Listening });
    } catch (err) {
      log.debug(`could not set presence: ${(err as Error).message}`);
    }
  }

  private clearActivity(): void {
    try {
      this.bot.client.user?.setPresence({ activities: [] });
    } catch {
      /* no client to clear it on */
    }
  }

  private async announce(playing: Playing): Promise<void> {
    const url = this.webhook;
    if (!url) return;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: `Now playing on deck ${playing.deck}: **${playing.title.slice(0, 200)}**`,
          // A track title is somebody's filename. Without this, one called
          // "@everyone (extended mix)" would ping the whole server.
          allowed_mentions: { parse: [] },
        }),
      });
      if (!response.ok) {
        log.warn(`the announcement webhook replied ${response.status}`);
      }
    } catch (err) {
      log.warn(`could not post the announcement: ${(err as Error).message}`);
    }
  }
}

/** Instantiated per rig — one poll timer and one settled track each. */
