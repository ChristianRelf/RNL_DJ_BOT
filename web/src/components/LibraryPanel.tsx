import { AlertTriangle, FolderOpen, HardDriveDownload, RefreshCw, Radio } from 'lucide-react';
import type { HostState } from '../protocol';
import type { LibraryClient } from '../lib/useLibrary';

interface LibraryPanelProps {
  library: LibraryClient;
  host: HostState;
  meId: string;
}

function countLabel(n: number): string {
  return `${n} track${n === 1 ? '' : 's'}`;
}

/**
 * The music folder.
 *
 * This is the panel that explains where the audio actually comes from, which is
 * not obvious and is the first thing anybody will ask: the rig plays off a
 * folder on somebody's machine, live, and goes quiet when that machine does.
 * Whoever is hosting needs to know they are, because closing the tab is the one
 * action here with a consequence for the room.
 */
export function LibraryPanel({ library, host, meId }: LibraryPanelProps) {
  const iAmHost = host.hosted && host.userId === meId;
  const someoneElse = host.hosted && host.userId !== meId;

  if (!library.supported) {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2 className="panel-title">Music folder</h2>
        </header>
        <p className="panel-empty">
          This browser cannot keep a folder connected. Chrome or Edge can — open the console
          there to host the library.
          {someoneElse && ` ${host.userName} is hosting, so the decks still work here.`}
        </p>
      </section>
    );
  }

  return (
    <section className={`panel library ${iAmHost ? 'is-hosting' : ''}`}>
      <header className="panel-head">
        <h2 className="panel-title">Music folder</h2>
        {iAmHost && (
          <span className="library-badge" title="This browser is serving the rig's audio">
            <Radio size={11} /> HOSTING
          </span>
        )}
      </header>

      {library.status === 'needs-permission' && (
        <>
          <p className="panel-empty">
            Reconnect <strong>{library.folderName}</strong> to carry on where you left off.
          </p>
          <button type="button" className="btn btn-primary" onClick={library.regrant}>
            <FolderOpen size={13} /> Reconnect folder
          </button>
        </>
      )}

      {library.status === 'none' && (
        <>
          <p className="panel-empty">
            Deck plays straight off your machine — nothing is uploaded. Pick the folder your
            music lives in.
          </p>
          <button type="button" className="btn btn-primary" onClick={library.connect}>
            <FolderOpen size={13} /> Choose music folder
          </button>
        </>
      )}

      {library.status === 'granted' && (
        <>
          <div className="library-folder" title={library.folderName ?? undefined}>
            <FolderOpen size={13} />
            <span className="library-folder-name">{library.folderName}</span>
          </div>

          <div className="library-stats mono">
            {library.scanning
              ? `scanning... ${library.progress?.found ?? 0}`
              : countLabel(library.tracks.length)}
          </div>

          {library.scanning && library.progress && (
            <div className="library-progress" title={library.progress.current}>
              {library.progress.current}
            </div>
          )}

          {library.decoding.length > 0 && (
            <div className="library-decoding">
              <HardDriveDownload size={12} />
              preparing {library.decoding.length}...
            </div>
          )}

          <div className="library-actions">
            <button
              type="button"
              className="btn"
              onClick={library.rescan}
              disabled={library.scanning}
            >
              <RefreshCw size={13} /> Rescan
            </button>
            <button type="button" className="btn" onClick={library.connect}>
              Change folder
            </button>
          </div>

          {iAmHost && (
            <p className="library-note">
              Closing this tab stops the music. Nothing is stored on the server.
            </p>
          )}
          {someoneElse && (
            <p className="library-note">
              {host.userName} is hosting this rig. Your folder is standing by.
            </p>
          )}
        </>
      )}

      {library.error && (
        <p className="library-error">
          <AlertTriangle size={12} /> {library.error}
        </p>
      )}
    </section>
  );
}
