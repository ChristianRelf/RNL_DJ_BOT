import { DocPage } from './SiteNav';

/**
 * How to actually work the booth, for the DJs on a licensee's server.
 *
 * Read off the console itself — the gestures come from controls.tsx, the
 * shortcuts from App.tsx, the handover rules from control.ts, and the slash
 * commands from discord/commands.ts. Keep it in step with those.
 */

const GESTURES = [
  ['Drag up or down', 'Move any knob or fader.'],
  ['Right-click', 'Reset a control to its default.'],
  ['Right-drag or shift-drag', 'Fine adjustment — a fifth of the normal travel.'],
  ['Scroll over a control', 'Nudge it a step at a time. Hold shift for finer steps.'],
  ['Double-click', 'Also resets, if you would rather.'],
  ['Arrow keys', 'Step a focused control. Home resets it.'],
];

const SHORTCUTS = [
  ['Q', 'Play or pause deck A'],
  ['P', 'Play or pause deck B'],
  ['1 – 8', 'Fire the sample pads'],
  ['[  ]', 'Nudge the crossfader'],
];

const COMMANDS = [
  ['/dj panel', 'Get a link to the control surface.'],
  ['/dj now', 'Show what is playing right now.'],
  ['/dj summon [channel]', 'Bring the bot into a voice channel.'],
  ['/dj leave', 'Disconnect the bot from voice.'],
];

export function Guide() {
  return (
    <DocPage
      current="/home/guides"
      title="Working the booth"
      lede="Everything the console does, and how to get at it. If you have used a controller before, most of this will already be where you expect."
    >
      <section className="doc-section">
        <h2>Getting in</h2>
        <p>
          Sign in with Discord. You need to be in the server and hold the DJ role — there is no
          separate account and no password. Once you are in you can see the whole console straight
          away, but everything is read-only until you take control.
        </p>
      </section>

      <section className="doc-section">
        <h2>Taking control</h2>
        <p>
          Only one person drives at a time. Everyone else watches the same live state — faders
          moving, meters bouncing, tracks loading — so a handover is seamless.
        </p>
        <ul className="doc-list">
          <li>
            <strong>Take control</strong> when nobody has it, and you are on.
          </li>
          <li>
            <strong>Request control</strong> when somebody does. You join a queue, and they can see
            you waiting.
          </li>
          <li>
            <strong>Release</strong> when you are done, or hand it to a specific person.
          </li>
          <li>
            If the holder goes idle for three minutes <em>while somebody is waiting</em>, control
            passes automatically. With an empty queue an idle holder keeps the decks — you will
            never get bumped just for letting a long track run.
          </li>
          <li>
            Close every tab and control is held for another twenty seconds, so a refresh does not
            cost you your set.
          </li>
          <li>Admins can force-take, for when something has gone wrong.</li>
        </ul>
      </section>

      <section className="doc-section">
        <h2>Getting on air</h2>
        <p>
          Pick a voice channel from the bar at the top and the bot joins it. Everything you play
          from that point is live to whoever is in there. <code>/dj summon</code> in Discord does
          the same thing from the other side.
        </p>
      </section>

      <section className="doc-section">
        <h2>Loading tracks</h2>
        <p>
          Drag files onto the media pool to upload them. Waveforms and tempo are worked out for you
          while you carry on. From there, drag a track onto a deck or a sample pad.
        </p>
        <p>
          The headphone button pre-listens <strong>in your own browser only</strong>. It never goes
          to air, so you can audition something mid-set.
        </p>
      </section>

      <section className="doc-section">
        <h2>The decks</h2>
        <ul className="doc-list">
          <li>
            <strong>Cue</strong> jumps to the cue point and stops. <strong>Set cue</strong> drops it
            where the playhead is.
          </li>
          <li>
            <strong>Loops</strong> — set in and out by hand, or hit a beat division to drop a loop
            of that length from where you are. Halve and double from there.
          </li>
          <li>
            <strong>Jump</strong> moves the playhead by whole beats, so you stay on the grid. On a
            track with no tempo it falls back to seconds.
          </li>
          <li>
            <strong>Pitch</strong> runs from half to double speed, turntable style — the tempo
            readout shows what the room actually hears.
          </li>
          <li>
            <strong>Sync</strong> matches the other deck, halving or doubling if it needs to, so a
            drum track can ride alongside something half its tempo.
          </li>
        </ul>
      </section>

      <section className="doc-section">
        <h2>The mixer</h2>
        <ul className="doc-list">
          <li>
            <strong>Trim</strong> sets the input level. <strong>Mute</strong> drops the channel and
            remembers where the fader was.
          </li>
          <li>
            <strong>EQ</strong> is a three-band isolator — a full cut is a real kill, not a dip.
            Click a band's label to kill it outright and click again to bring it back.
          </li>
          <li>
            <strong>Filter</strong> is one knob: low-pass to the left, high-pass to the right,
            bypassed in the middle.
          </li>
          <li>
            <strong>Crossfader</strong> is constant power, so the middle does not dip. The A, CTR
            and B buttons slam it.
          </li>
          <li>
            Anything moved off its default shows in orange, so you can spot a knob you left
            somewhere at a glance.
          </li>
        </ul>
      </section>

      <section className="doc-section">
        <h2>Sample pads</h2>
        <p>
          Eight slots, on their own bus, with an auto-duck that pulls the decks down underneath a
          hit. Click a pad's mode to cycle it:
        </p>
        <ul className="doc-list">
          <li>
            <strong>ONE</strong> — fires and runs to the end.
          </li>
          <li>
            <strong>LOOP</strong> — keeps going until you hit it again.
          </li>
          <li>
            <strong>HOLD</strong> — plays only while you hold it down.
          </li>
        </ul>
      </section>

      <section className="doc-section">
        <h2>Every control works the same way</h2>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <tbody>
              {GESTURES.map(([action, what]) => (
                <tr key={action}>
                  <td className="doc-key">{action}</td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-section">
        <h2>Keyboard</h2>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <tbody>
              {SHORTCUTS.map(([key, what]) => (
                <tr key={key}>
                  <td className="doc-key">
                    <kbd>{key}</kbd>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-section">
        <h2>From Discord</h2>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <tbody>
              {COMMANDS.map(([cmd, what]) => (
                <tr key={cmd}>
                  <td className="doc-key">
                    <code>{cmd}</code>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-next">
        <p>
          Running your own instance? <a href="/home/setup">The setup guide</a> covers standing one
          up.
        </p>
      </section>
    </DocPage>
  );
}
