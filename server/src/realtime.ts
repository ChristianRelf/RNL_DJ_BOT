import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { checkAccess, readSessionToken, verifySession } from './auth';
import { CommandError, type Rig } from './rig';
import { rigs } from './rigManager';
import {
  audioChunkSchema,
  audioGoneSchema,
  audioNoneSchema,
  hostTracksSchema,
  mediaPeaksSchema,
} from './schemas';
import { createLogger } from './logger';
import type { Ack, SessionUser, Toast } from './protocol';

const log = createLogger('realtime');

/**
 * Events that belong to the audio transport rather than to the control surface.
 *
 * `onAny` funnels everything else into the command path, which is where
 * permissions and the control lock are enforced. These carry no authority over
 * the mix — they answer requests the server made — so they are handled on their
 * own and must not reach `execute`, which would rightly refuse them as unknown
 * commands.
 */
const TRANSPORT_EVENTS = new Set([
  'hello',
  'host:claim',
  'host:release',
  'host:tracks',
  'audio:chunk',
  'audio:none',
  'audio:gone',
  'media:peaks',
]);

/** Coalescing window for state broadcasts. */
const STATE_COALESCE_MS = 50;
/** Steady refresh while audio is moving, so playheads stay smooth. */
const PLAYHEAD_INTERVAL_MS = 100;
const METER_INTERVAL_MS = 66;

interface SocketData {
  user: SessionUser;
  rig: Rig;
}

/** Everyone connected to one rig. State never crosses between them. */
const room = (guildId: string) => `guild:${guildId}`;
/** One person, in one rig — a toast meant for them and nobody else. */
const userRoom = (guildId: string, userId: string) => `guild:${guildId}:user:${userId}`;

export function createRealtime(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    path: '/socket.io',
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 25_000,
    // A quarter-second audio chunk is 48 KB, but the ceiling has to clear a
    // whole folder scan in one message as well — twenty thousand tracks of
    // title and path. Still small enough to be a real limit.
    maxHttpBufferSize: 8e6,
  });

  /**
   * Authenticate the handshake, and resolve which rig this socket is for.
   *
   * Membership is re-checked on every connection rather than trusted from the
   * session, so losing a DJ role takes effect on the next connect instead of
   * whenever the JWT happens to expire. The guild comes from the client because
   * one browser can have two rigs open in two tabs.
   */
  io.use(async (socket, next) => {
    try {
      const token = readSessionToken(socket.handshake.headers.cookie);
      const session = verifySession(token);
      if (!session) return next(new Error('Not signed in.'));

      const guildId = String(socket.handshake.auth?.guildId ?? '');
      if (!guildId) return next(new Error('No rig was named.'));

      const rig = await rigs.ensure(guildId);
      if (!rig) return next(new Error('That rig is not running.'));

      const access = await checkAccess(guildId, session.id, session.displayName);
      if (!access.allowed) return next(new Error(access.reason ?? 'Access denied.'));

      (socket.data as SocketData).user = {
        ...session,
        displayName: access.displayName,
        isAdmin: access.isAdmin,
      };
      (socket.data as SocketData).rig = rig;
      next();
    } catch (err) {
      log.warn('handshake rejected:', (err as Error).message);
      next(new Error('Could not verify your Discord session.'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { user, rig } = socket.data as SocketData;
    socket.join(room(rig.guildId));
    socket.join(userRoom(rig.guildId, user.id));
    rig.attach(user);
    log.info(`${user.displayName} connected to ${rig.guildId}`);

    socket.emit('hello', { user, state: rig.state(), media: rig.store.listMedia() });

    wireHost(socket, rig, user);

    socket.onAny(async (event: string, payload: unknown, ack?: (res: Ack) => void) => {
      if (TRANSPORT_EVENTS.has(event)) return;
      const respond = typeof ack === 'function' ? ack : () => undefined;
      try {
        await rig.execute(user, event, payload);
        respond({ ok: true });
      } catch (err) {
        const message =
          err instanceof CommandError ? err.message : 'That did not work — check the logs.';
        if (!(err instanceof CommandError)) log.error(`command ${event} failed:`, err);
        respond({ ok: false, error: message });
        socket.emit('toast', { level: 'error', message } satisfies Toast);
      }
    });

    socket.on('disconnect', () => {
      rig.host.release(socket.id);
      rig.detach(user.id);
      log.info(`${user.displayName} disconnected from ${rig.guildId}`);
    });
  });

  wireBroadcasts(io);
  return io;
}

/**
 * The audio channel for one socket.
 *
 * A console that has a music folder open offers to host; the server answers by
 * asking it for audio, a few times a second per playing deck. Nothing here goes
 * through the control lock: hosting is not a thing you do to the mix, it is
 * where the mix comes from.
 */
function wireHost(socket: Socket, rig: Rig, user: SessionUser): void {
  socket.on('host:claim', (payload: unknown, ack?: (res: Ack) => void) => {
    const respond = typeof ack === 'function' ? ack : () => undefined;
    const parsed = hostTracksSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      respond({ ok: false, error: parsed.error.issues[0]?.message ?? 'Bad track list.' });
      return;
    }

    const result = rig.host.claim({
      socketId: socket.id,
      userId: user.id,
      userName: user.displayName,
      tracks: parsed.data.tracks,
      // Bound to this socket, so a request can never be sent to a console that
      // has since been replaced as host.
      send: (need) => socket.emit('audio:need', need),
    });
    if (result.ok) rig.syncLibrary(parsed.data.tracks);
    respond(result.ok ? { ok: true } : { ok: false, error: result.reason ?? 'Already hosted.' });
  });

  socket.on('host:tracks', (payload: unknown, ack?: (res: Ack) => void) => {
    const respond = typeof ack === 'function' ? ack : () => undefined;
    const parsed = hostTracksSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      respond({ ok: false, error: 'Bad track list.' });
      return;
    }
    const ok = rig.host.update(socket.id, parsed.data.tracks);
    if (ok) rig.syncLibrary(parsed.data.tracks);
    respond(ok ? { ok: true } : { ok: false, error: 'You are not hosting this rig.' });
  });

  socket.on('host:release', () => {
    rig.host.release(socket.id);
  });

  // The hot one: a few of these a second per playing deck. No ack — the ring
  // either takes the chunk or does not, and a chunk that arrives too late to be
  // useful is dropped rather than reported, because by then the deck has
  // already faded and asked again.
  socket.on('audio:chunk', (payload: unknown, pcm: unknown) => {
    const parsed = audioChunkSchema.safeParse(payload ?? {});
    if (!parsed.success || !Buffer.isBuffer(pcm)) return;
    rig.host.chunk(socket.id, parsed.data.sourceKey, parsed.data.seq, parsed.data.fromFrame, pcm);
  });

  // Not ready yet, usually because the track is still being decoded. Answering
  // matters as much as sending audio — see RemoteWindowReader.decline.
  socket.on('audio:none', (payload: unknown) => {
    const parsed = audioNoneSchema.safeParse(payload ?? {});
    if (!parsed.success) return;
    rig.host.decline(socket.id, parsed.data.sourceKey, parsed.data.seq, parsed.data.fromFrame);
  });

  socket.on('media:peaks', (payload: unknown) => {
    const parsed = mediaPeaksSchema.safeParse(payload ?? {});
    if (!parsed.success) return;
    rig.registerPeaks(parsed.data.trackId, parsed.data.peaks, parsed.data.frames);
  });

  socket.on('audio:gone', (payload: unknown) => {
    const parsed = audioGoneSchema.safeParse(payload ?? {});
    if (!parsed.success) return;
    rig.host.gone(socket.id, parsed.data.trackId);
  });
}

/**
 * Broadcasts, per rig.
 *
 * Rigs are subscribed to as they are seen rather than once at boot, because one
 * can be started from the portal at any time. The timers walk every running rig
 * and skip the ones nobody is watching, so twenty idle guilds cost twenty cheap
 * checks rather than twenty broadcasts.
 */
function wireBroadcasts(io: IOServer): void {
  const pending = new Map<string, NodeJS.Timeout>();
  const wired = new WeakSet<Rig>();

  const subscribe = (rig: Rig) => {
    if (wired.has(rig)) return;
    wired.add(rig);

    rig.on('state', () => {
      if (pending.has(rig.guildId)) return;
      const timer = setTimeout(() => {
        pending.delete(rig.guildId);
        io.to(room(rig.guildId)).emit('state', rig.state());
      }, STATE_COALESCE_MS);
      timer.unref?.();
      pending.set(rig.guildId, timer);
    });

    rig.on('media', (media) => io.to(room(rig.guildId)).emit('media', media));

    rig.on('toast', (toast: Toast, userId?: string) => {
      if (userId) io.to(userRoom(rig.guildId, userId)).emit('toast', toast);
      else io.to(room(rig.guildId)).emit('toast', toast);
    });
  };

  const watching = (guildId: string) =>
    (io.sockets.adapter.rooms.get(room(guildId))?.size ?? 0) > 0;

  const playhead = setInterval(() => {
    for (const rig of rigs.all) {
      subscribe(rig);
      if (!watching(rig.guildId) || pending.has(rig.guildId)) continue;
      const state = rig.state();
      const moving =
        state.decks.A.playing || state.decks.B.playing || state.pads.some((p) => p.playing);
      if (moving) io.to(room(rig.guildId)).emit('state', state);
    }
  }, PLAYHEAD_INTERVAL_MS);
  playhead.unref?.();

  const meters = setInterval(() => {
    for (const rig of rigs.all) {
      if (!watching(rig.guildId)) continue;
      io.to(room(rig.guildId)).emit('meters', rig.mixer.meters());
    }
  }, METER_INTERVAL_MS);
  meters.unref?.();
}
