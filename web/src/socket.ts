import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { meterBus } from './lib/meters';
import type {
  Ack,
  ClientCommands,
  CommandName,
  EngineState,
  MediaItem,
  SessionUser,
  Toast,
} from './protocol';

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'unauthorised';

export interface ToastEntry extends Toast {
  id: number;
}

export interface DjClient {
  status: ConnectionStatus;
  /**
   * The live socket, for the audio channel.
   *
   * Exposed because hosting is not a command — it does not go through `send`,
   * it answers requests the server makes — so the library hook needs the socket
   * itself rather than the command surface built on top of it.
   */
  socket: Socket | null;
  error: string | null;
  user: SessionUser | null;
  state: EngineState | null;
  media: MediaItem[];
  toasts: ToastEntry[];
  dismiss: (id: number) => void;
  send: <K extends CommandName>(command: K, payload: ClientCommands[K]) => Promise<Ack>;
}

let toastSeq = 0;

/**
 * The socket for one rig.
 *
 * Nothing connects until a guild is known: the server resolves the rig during
 * the handshake and refuses a socket that does not name one, because a console
 * that connected first and picked a guild afterwards would have a window where
 * it was subscribed to nothing and looked simply broken.
 */
export function useDj(guildId: string | null): DjClient {
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);

  const pushToast = useCallback((toast: Toast) => {
    const entry = { ...toast, id: ++toastSeq };
    setToasts((prev) => [...prev.slice(-4), entry]);
    const ttl = toast.level === 'error' ? 7000 : 4000;
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== entry.id)), ttl);
  }, []);

  useEffect(() => {
    if (!guildId) return;
    const socket = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      auth: { guildId },
    });
    socketRef.current = socket;
    setSocketInstance(socket);

    socket.on('connect', () => {
      setStatus('online');
      setError(null);
    });
    socket.on('hello', (payload: { user: SessionUser; state: EngineState; media: MediaItem[] }) => {
      setUser(payload.user);
      setState(payload.state);
      setMedia(payload.media);
    });
    socket.on('state', setState);
    socket.on('media', setMedia);
    socket.on('meters', (m) => meterBus.publish(m));
    socket.on('toast', pushToast);

    socket.on('disconnect', (reason) => {
      meterBus.reset();
      if (reason === 'io server disconnect') setStatus('offline');
      else setStatus('connecting');
    });
    socket.on('connect_error', (err) => {
      const message = err.message || 'Connection failed.';
      // The handshake middleware rejects unauthenticated or ungated users with
      // a readable reason; treat those as "needs login" rather than retrying.
      if (/signed in|denied|DJ role|member|verify/i.test(message)) {
        setStatus('unauthorised');
        setError(message);
        socket.disconnect();
      } else {
        setStatus('connecting');
        setError(message);
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setSocketInstance(null);
    };
  }, [pushToast, guildId]);

  const send = useCallback(
    <K extends CommandName>(command: K, payload: ClientCommands[K]): Promise<Ack> =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          resolve({ ok: false, error: 'Not connected.' });
          return;
        }
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve({ ok: false, error: 'The server did not respond.' });
        }, 8000);
        socket.emit(command, payload, (ack: Ack) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(ack ?? { ok: true });
        });
      }),
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return useMemo(
    () => ({ status, error, user, state, media, toasts, dismiss, send, socket: socketInstance }),
    [status, error, user, state, media, toasts, dismiss, send, socketInstance],
  );
}

/**
 * Identifies which control a throttled message belongs to, so two controls
 * touched inside the same window can't overwrite each other's final value —
 * a dropped final value leaves the control sitting where the server thinks it
 * is rather than where you left it.
 */
function controlKey(command: CommandName, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return command;
  const record = payload as Record<string, unknown>;
  const parts: string[] = [command];
  if (record.deck !== undefined) parts.push(String(record.deck));
  if (record.index !== undefined) parts.push(String(record.index));
  for (const [field, value] of Object.entries(record)) {
    if (field === 'deck' || field === 'index') continue;
    if (value && typeof value === 'object') {
      for (const inner of Object.keys(value as object)) parts.push(`${field}.${inner}`);
    } else {
      parts.push(field);
    }
  }
  return parts.join('|');
}

/**
 * Rate-limits continuous control changes (fader drags) to one message per
 * frame-ish, and always delivers the final value of every control touched.
 */
export function useThrottledSend(send: DjClient['send'], intervalMs = 45) {
  const pending = useRef(new Map<string, { command: CommandName; payload: unknown }>());
  const timer = useRef<number | null>(null);
  const last = useRef(0);

  const flush = useCallback(() => {
    timer.current = null;
    if (pending.current.size === 0) return;
    const queued = [...pending.current.values()];
    pending.current.clear();
    last.current = Date.now();
    for (const message of queued) void send(message.command as never, message.payload as never);
  }, [send]);

  return useCallback(
    <K extends CommandName>(command: K, payload: ClientCommands[K]) => {
      const now = Date.now();
      pending.current.set(controlKey(command, payload), { command, payload });
      if (now - last.current >= intervalMs) {
        if (timer.current !== null) {
          window.clearTimeout(timer.current);
          timer.current = null;
        }
        flush();
        return;
      }
      if (timer.current === null) {
        timer.current = window.setTimeout(flush, intervalMs - (now - last.current));
      }
    },
    [flush, intervalMs],
  );
}
