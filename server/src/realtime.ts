import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { checkAccess, readSessionToken, verifySession } from './auth';
import { engine, CommandError } from './engine';
import { store } from './store';
import { createLogger } from './logger';
import type { Ack, SessionUser, Toast } from './protocol';

const log = createLogger('realtime');

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
    maxHttpBufferSize: 1e6,
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

    socket.onAny(async (event: string, payload: unknown, ack?: (res: Ack) => void) => {
      if (event === 'hello') return;
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
      engine.detach(user.id);
      log.info(`${user.displayName} disconnected`);
    });
  });

  wireBroadcasts(io);
  return io;
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
