import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  folderPickerSupported,
  pickFolder,
  regrantFolder,
  restoreFolder,
  type FolderStatus,
  type ScannedTrack,
} from './folder';
import { Library } from './library';
import type { AudioNeedMessage } from '../protocol';

export interface LibraryClient {
  supported: boolean;
  status: FolderStatus;
  folderName: string | null;
  tracks: ScannedTrack[];
  scanning: boolean;
  progress: { found: number; current: string } | null;
  decoding: string[];
  error: string | null;
  /** Pick a folder. Must be called straight from a click. */
  connect: () => void;
  /** Re-grant a folder we already remember. Must be called straight from a click. */
  regrant: () => void;
  rescan: () => void;
}

/**
 * The console's side of hosting a rig's audio.
 *
 * Holds the music folder, offers it to the server, and answers the server's
 * requests for audio out of the decoded cache. Everything here hangs off the
 * socket: hosting only means anything while connected, and a reconnect has to
 * re-offer, because the server tracks the host by socket and has forgotten.
 */
export function useLibrary(socket: Socket | null, guildId: string | null): LibraryClient {
  const [status, setStatus] = useState<FolderStatus>('none');
  const [folderName, setFolderName] = useState<string | null>(null);
  const [tracks, setTracks] = useState<ScannedTrack[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ found: number; current: string } | null>(null);
  const [decoding, setDecoding] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  socketRef.current = socket;

  const libraryRef = useRef<Library | null>(null);
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  /** Kept in a ref as well so the socket handler never closes over a stale list. */
  const tracksRef = useRef<ScannedTrack[]>([]);

  const supported = useMemo(() => folderPickerSupported(), []);

  // The decoded cache is namespaced per rig, so two guilds on one machine do
  // not evict each other's tracks or collide on a track id that means different
  // audio in each.
  if (guildId && !libraryRef.current && typeof Worker !== 'undefined') {
    libraryRef.current = new Library(guildId, {
      onScanProgress: (found, current) => setProgress({ found, current }),
      onDecodeStart: (id) => setDecoding((prev) => (prev.includes(id) ? prev : [...prev, id])),
      onDecodeDone: (id) => setDecoding((prev) => prev.filter((t) => t !== id)),
      onError: (message) => setError(message),
      onTracks: (next) => {
        tracksRef.current = next;
        setTracks(next);
        // A decode corrects the length the scan estimated off file metadata, and
        // the server's ring sizes its requests against that number - so a
        // correction has to travel, not just be remembered locally.
        socketRef.current?.emit('host:tracks', { tracks: next });
      },
      onPeaks: (trackId, peaks, frames) => {
        socketRef.current?.emit('media:peaks', { trackId, peaks, frames });
      },
    });
  }

  useEffect(() => () => libraryRef.current?.dispose(), []);

  /* ------------------------------------------------------- folder state */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await restoreFolder();
      if (cancelled) return;
      handleRef.current = restored.handle;
      setFolderName(restored.handle?.name ?? null);
      setStatus(restored.status);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------------------------------------------- scanning + claim */

  const scanAndClaim = useCallback(async () => {
    const library = libraryRef.current;
    const handle = handleRef.current;
    if (!library || !handle) return;

    setScanning(true);
    setError(null);
    try {
      const found = await library.scan(handle);
      tracksRef.current = found;
      setTracks(found);

      if (socket?.connected) {
        socket.emit('host:claim', { tracks: found }, (ack: { ok: boolean; error?: string }) => {
          if (!ack?.ok) setError(ack?.error ?? 'Could not start hosting.');
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, [socket]);

  // A granted folder is offered as soon as there is a socket to offer it to,
  // and again on every reconnect - the server tracks the host by socket id, so
  // after a drop it does not know this console has a library at all.
  useEffect(() => {
    if (!socket || status !== 'granted' || !handleRef.current) return;

    const offer = () => {
      if (tracksRef.current.length > 0) {
        socket.emit('host:claim', { tracks: tracksRef.current });
      } else {
        void scanAndClaim();
      }
    };

    if (socket.connected) offer();
    socket.on('connect', offer);
    return () => {
      socket.off('connect', offer);
    };
  }, [socket, status, scanAndClaim]);

  /* --------------------------------------------------------- serving */

  useEffect(() => {
    const library = libraryRef.current;
    if (!socket || !library) return;

    const onNeed = (need: AudioNeedMessage) => {
      void (async () => {
        try {
          const served = await library.serve(need);
          if (served && served.frames > 0) {
            socket.emit(
              'audio:chunk',
              { sourceKey: need.sourceKey, fromFrame: need.fromFrame, seq: need.seq },
              served.pcm,
            );
            return;
          }
        } catch {
          /* falls through to the refusal below */
        }
        // Saying "not yet" matters as much as sending audio. The server caps
        // requests in flight, so an unanswered one is a request it goes on
        // believing is coming - and after a few of those it stops asking.
        socket.emit('audio:none', {
          sourceKey: need.sourceKey,
          fromFrame: need.fromFrame,
          seq: need.seq,
        });
      })();
    };

    socket.on('audio:need', onNeed);
    return () => {
      socket.off('audio:need', onNeed);
    };
  }, [socket]);

  /* ---------------------------------------------------------- actions */

  const connect = useCallback(() => {
    void (async () => {
      const handle = await pickFolder();
      if (!handle) return;
      handleRef.current = handle;
      setFolderName(handle.name);
      setStatus('granted');
      await scanAndClaim();
    })();
  }, [scanAndClaim]);

  const regrant = useCallback(() => {
    void (async () => {
      const handle = handleRef.current;
      if (!handle) return;
      const ok = await regrantFolder(handle);
      if (!ok) {
        setError('Access to that folder was refused.');
        return;
      }
      setStatus('granted');
      await scanAndClaim();
    })();
  }, [scanAndClaim]);

  const rescan = useCallback(() => {
    void scanAndClaim();
  }, [scanAndClaim]);

  return useMemo(
    () => ({
      supported,
      status,
      folderName,
      tracks,
      scanning,
      progress,
      decoding,
      error,
      connect,
      regrant,
      rescan,
    }),
    [supported, status, folderName, tracks, scanning, progress, decoding, error, connect, regrant, rescan],
  );
}
