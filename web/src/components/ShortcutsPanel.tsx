/**
 * The keyboard and gesture reference, as a widget.
 *
 * The same lines live in the console footer, but the footer is easy to miss and
 * disappears on a short window - this is for anyone who wants it on screen
 * while they learn the desk.
 */

const KEYS: Array<[string, string]> = [
  ['Q', 'Play or pause deck A'],
  ['P', 'Play or pause deck B'],
  ['1 – 8', 'Fire the sample pads'],
  ['[  ]', 'Nudge the crossfader'],
];

const GESTURES: Array<[string, string]> = [
  ['Right-click', 'Reset a control to its default'],
  ['Shift-drag', 'Fine adjustment'],
  ['Right-drag', 'Fine adjustment'],
  ['Scroll', 'Nudge a control a step at a time'],
  ['Double-click', 'Also resets'],
];

export function ShortcutsPanel() {
  return (
    <section className="panel shortcuts-panel">
      <h2 className="panel-title">Shortcuts</h2>

      <div className="sp-group">
        <span className="tool-label">Keyboard</span>
        <dl className="sp-list">
          {KEYS.map(([key, what]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="sp-group">
        <span className="tool-label">Any knob or fader</span>
        <dl className="sp-list">
          {GESTURES.map(([action, what]) => (
            <div key={action}>
              <dt>{action}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
