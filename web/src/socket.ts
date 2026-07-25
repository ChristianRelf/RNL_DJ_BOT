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
  error: string | null;
  user: SessionUser | null;
  state: EngineState | null;
  media: MediaItem[];
  toasts: ToastEntry[];
  dismiss: (id: number) => void;
  send: <K extends CommandName>(command: K, payload: ClientCommands[K]) => Promise<Ack>;
}

let toastSeq = 0;

export function useDj(): DjClient {
  const socketRef = useRef<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const pushToast = useCallback((toast: Toast) => {
    const entry = { ...toast, id: ++toastSeq };
    setToasts((prev) => [...prev.slice(-4), entry]);
    const ttl = toast.level === 'error' ? 7000 : 4000;
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== entry.id)), ttl);
  }, []);

  useEffect(() => {
    const socket = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    socketRef.current = socket;

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
    };
  }, [pushToast]);

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
    () => ({ status, error, user, state, media, toasts, dismiss, send }),
    [status, error, user, state, media, toasts, dismiss, send],
  );
}

/**
 * Rate-limits continuous control changes (fader drags) to one message per
 * frame-ish, and always delivers the final value.
 */
export function useThrottledSend(send: DjClient['send'], intervalMs = 45) {
  const pending = useRef<{ command: CommandName; payload: unknown } | null>(null);
  const timer = useRef<number | null>(null);
  const last = useRef(0);

  const flush = useCallback(() => {
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    last.current = Date.now();
    void send(next.command as never, next.payload as never);
  }, [send]);

  return useCallback(
    <K extends CommandName>(command: K, payload: ClientCommands[K]) => {
      const now = Date.now();
      pending.current = { command, payload };
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
