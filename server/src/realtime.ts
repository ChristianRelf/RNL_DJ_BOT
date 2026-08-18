import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { checkAccess, readSessionToken, verifySession } from './auth';
import { engine, CommandError } from './engine';
import { store } from './store';
import { createLogger } from './logger';
import {
  audioChunkSchema,
  audioGoneSchema,
  audioNoneSchema,
  hostTracksSchema,
  mediaPeaksSchema,
} from './schemas';
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
}

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

  // Authenticate on the handshake and re-check guild membership every time, so
  // losing the DJ role takes effect on the next connection instead of whenever
  // the JWT happens to expire.
  io.use(async (socket, next) => {
    try {
      const token = readSessionToken(socket.handshake.headers.cookie);
      const session = verifySession(token);
      if (!session) return next(new Error('Not signed in.'));
      const access = await checkAccess(session.id, session.displayName);
      if (!access.allowed) return next(new Error(access.reason ?? 'Access denied.'));
      (socket.data as SocketData).user = {
        ...session,
        displayName: access.displayName,
        isAdmin: access.isAdmin,
        isOwner: access.isOwner,
      };
      next();
    } catch (err) {
      log.warn('handshake rejected:', (err as Error).message);
      next(new Error('Could not verify your Discord session.'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as SocketData).user;
    socket.join(`user:${user.id}`);
    engine.attach(user);
    log.info(`${user.displayName} connected`);

    socket.emit('hello', { user, state: engine.state(), media: store.listMedia() });

    wireHost(socket, user);

    socket.onAny(async (event: string, payload: unknown, ack?: (res: Ack) => void) => {
      if (TRANSPORT_EVENTS.has(event)) return;
      const respond = typeof ack === 'function' ? ack : () => undefined;
      try {
        await engine.execute(user, event, payload);
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
      engine.host.release(socket.id);
      engine.detach(user.id);
      log.info(`${user.displayName} disconnected`);
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
function wireHost(socket: Socket, user: SessionUser): void {
  socket.on('host:claim', (payload: unknown, ack?: (res: Ack) => void) => {
    const respond = typeof ack === 'function' ? ack : () => undefined;
    const parsed = hostTracksSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      respond({ ok: false, error: parsed.error.issues[0]?.message ?? 'Bad track list.' });
      return;
    }

    const result = engine.host.claim({
      socketId: socket.id,
      userId: user.id,
      userName: user.displayName,
      tracks: parsed.data.tracks,
      // Bound to this socket, so a request can never be sent to a console that
      // has since been replaced as host.
      send: (need) => socket.emit('audio:need', need),
    });
    if (result.ok) engine.syncLibrary(parsed.data.tracks);
    respond(result.ok ? { ok: true } : { ok: false, error: result.reason ?? 'Already hosted.' });
  });

  socket.on('host:tracks', (payload: unknown, ack?: (res: Ack) => void) => {
    const respond = typeof ack === 'function' ? ack : () => undefined;
    const parsed = hostTracksSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      respond({ ok: false, error: 'Bad track list.' });
      return;
    }
    const ok = engine.host.update(socket.id, parsed.data.tracks);
    if (ok) engine.syncLibrary(parsed.data.tracks);
    respond(ok ? { ok: true } : { ok: false, error: 'You are not hosting this rig.' });
  });

  socket.on('host:release', () => {
    engine.host.release(socket.id);
  });

  // The hot one: a few of these a second per playing deck. No ack — the ring
  // either takes the chunk or does not, and a chunk that arrives too late to be
  // useful is dropped rather than reported, because by then the deck has
  // already faded and asked again.
  socket.on('audio:chunk', (payload: unknown, pcm: unknown) => {
    const parsed = audioChunkSchema.safeParse(payload ?? {});
    if (!parsed.success || !Buffer.isBuffer(pcm)) return;
    engine.host.chunk(
      socket.id,
      parsed.data.sourceKey,
      parsed.data.seq,
      parsed.data.fromFrame,
      pcm,
    );
  });

  // Not ready yet, usually because the track is still being decoded. Answering
  // matters as much as sending audio does — see RemoteWindowReader.decline.
  socket.on('audio:none', (payload: unknown) => {
    const parsed = audioNoneSchema.safeParse(payload ?? {});
    if (!parsed.success) return;
    engine.host.decline(socket.id, parsed.data.sourceKey, parsed.data.seq, parsed.data.fromFrame);
  });

  socket.on('media:peaks', (payload: unknown) => {
    const parsed = mediaPeaksSchema.safeParse(payload ?? {});
    if (!parsed.success) return;
    engine.registerPeaks(parsed.data.trackId, parsed.data.peaks, parsed.data.frames);
  });

  socket.on('audio:gone', (payload: unknown) => {
    const parsed = audioGoneSchema.safeParse(payload ?? {});
    if (!parsed.success) return;
    engine.host.gone(socket.id, parsed.data.trackId);
  });
}

function wireBroadcasts(io: IOServer): void {
  let pending: NodeJS.Timeout | null = null;

  const flush = () => {
    pending = null;
    io.emit('state', engine.state());
  };

  engine.on('state', () => {
    if (pending) return;
    pending = setTimeout(flush, STATE_COALESCE_MS);
    pending.unref?.();
  });

  engine.on('media', (media) => io.emit('media', media));

  engine.on('toast', (toast: Toast, userId?: string) => {
    if (userId) io.to(`user:${userId}`).emit('toast', toast);
    else io.emit('toast', toast);
  });

  const playhead = setInterval(() => {
    const state = engine.state();
    const moving =
      state.decks.A.playing || state.decks.B.playing || state.pads.some((p) => p.playing);
    if (moving && !pending) io.emit('state', state);
  }, PLAYHEAD_INTERVAL_MS);
  playhead.unref?.();

  const meters = setInterval(() => {
    if (io.engine.clientsCount === 0) return;
    io.emit('meters', engine.mixer.meters());
  }, METER_INTERVAL_MS);
  meters.unref?.();
}
