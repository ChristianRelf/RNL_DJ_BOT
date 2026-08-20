import { useRef } from 'react';
import { AlertTriangle, FolderOpen, HardDriveDownload, Plus, RefreshCw, Radio } from 'lucide-react';
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
  const fileInput = useRef<HTMLInputElement>(null);
  const iAmHost = host.hosted && host.userId === meId;
  const someoneElse = host.hosted && host.userId !== meId;

  if (!library.supported) {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2 className="panel-title">Music folder</h2>
        </header>
        <p className="panel-empty">
          This browser cannot use private browser storage for a music library.
          {someoneElse && ` ${host.userName} is hosting, so the decks still work here.`}
        </p>
      </section>
    );
  }

  return (
    <section className={`panel library ${iAmHost ? 'is-hosting' : ''}`}>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus,.aiff,.aif,.alac"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) library.importFiles(event.target.files);
          event.target.value = '';
        }}
      />
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
            Add music to private browser storage, or connect an existing folder. Nothing is
            uploaded to the server.
          </p>
          <div className="library-actions">
            <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>
              <Plus size={13} /> Add music
            </button>
            {library.canPickFolder ? <button type="button" className="btn" onClick={library.connect}>
              <FolderOpen size={13} /> Connect folder
            </button> : null}
          </div>
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
            <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>
              <Plus size={13} /> Add music
            </button>
            <button
              type="button"
              className="btn"
              onClick={library.rescan}
              disabled={library.scanning}
            >
              <RefreshCw size={13} /> Rescan
            </button>
            {library.canPickFolder ? <button type="button" className="btn" onClick={library.connect}>
              Change folder
            </button> : null}
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
