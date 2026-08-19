import { useMemo, useState } from 'react';
import { Radio, RotateCcw, X } from 'lucide-react';
import { MIDI_TARGETS, describeSignal, type MidiBinding } from '../lib/midi';
import type { MidiRuntime } from '../lib/useMidi';

/**
 * MIDI mapping.
 *
 * Learn is the only workflow that survives contact with real hardware: pick the
 * thing on screen, then move the thing on the controller. Everything else here
 * exists to explain what happened afterwards - what is bound to what, and how a
 * control that is not where the software is behaves when you first touch it.
 */

const MODES: Array<{ id: MidiBinding['mode']; label: string; hint: string }> = [
  { id: 'pickup', label: 'PICKUP', hint: 'Takes over once the control passes the console value' },
  { id: 'absolute', label: 'JUMP', hint: 'Follows the control immediately, jump and all' },
  { id: 'relative', label: 'ENCODER', hint: 'For endless encoders that send steps, not positions' },
];

export function MidiPanel({ midi }: { midi: MidiRuntime }) {
  const [filter, setFilter] = useState('');

  const bindings = useMemo(
    () => new Map(midi.settings.bindings.map((binding) => [binding.targetId, binding])),
    [midi.settings.bindings],
  );

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const out = new Map<string, typeof MIDI_TARGETS>();
    for (const target of MIDI_TARGETS) {
      if (needle && !`${target.group} ${target.name}`.toLowerCase().includes(needle)) continue;
      const list = out.get(target.group) ?? [];
      list.push(target);
      out.set(target.group, list);
    }
    return [...out.entries()];
  }, [filter]);

  if (!midi.supported) {
    return (
      <section className="panel midi-panel">
        <header className="panel-head">
          <h2 className="panel-title">MIDI</h2>
        </header>
        <p className="panel-note">
          This browser has no Web MIDI. Chrome, Edge and Opera have it; Safari and Firefox do not
          without a flag. The console works the same without it - MIDI only ever sends the commands
          the on-screen controls already send.
        </p>
      </section>
    );
  }

  return (
    <section className="panel midi-panel">
      <header className="panel-head">
        <h2 className="panel-title">MIDI</h2>
        <div className="panel-actions">
          {midi.settings.bindings.length > 0 ? (
            <button
              type="button"
              className="btn tiny"
              title="Forget every mapping"
              onClick={midi.reset}
            >
              <RotateCcw size={12} />
              CLEAR ALL
            </button>
          ) : null}
          <button
            type="button"
            className={`btn tiny ${midi.settings.enabled && midi.ready ? 'is-on' : ''}`}
            aria-pressed={midi.settings.enabled}
            onClick={() => (midi.settings.enabled ? midi.disable() : midi.enable())}
          >
            <Radio size={12} />
            {midi.settings.enabled ? (midi.ready ? 'LISTENING' : 'CONNECTING') : 'OFF'}
          </button>
        </div>
      </header>

      {midi.error ? <p className="tool-result is-bad">{midi.error}</p> : null}

      {midi.settings.enabled && midi.ready ? (
        <div className="midi-devices">
          <span className="tool-label-sm">INPUTS</span>
          {midi.devices.length === 0 ? (
            <span className="hint">Nothing plugged in.</span>
          ) : (
            midi.devices.map((device) => {
              const on =
                midi.settings.inputs.length === 0 || midi.settings.inputs.includes(device.id);
              return (
                <button
                  type="button"
                  key={device.id}
                  className={`btn tiny ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  title={on ? 'Listening to this input' : 'Ignoring this input'}
                  onClick={() => {
                    // An empty list means "everything", so the first exclusion
                    // has to be expanded into the full list first.
                    const all = midi.devices.map((entry) => entry.id);
                    const current = midi.settings.inputs.length === 0 ? all : midi.settings.inputs;
                    midi.setInputs(
                      on ? current.filter((id) => id !== device.id) : [...current, device.id],
                    );
                  }}
                >
                  {device.name}
                </button>
              );
            })
          )}
          <span className="midi-activity mono" title="The last message received">
            {midi.last ? `${describeSignal(midi.last.signal)} · ${midi.last.raw}` : 'waiting'}
          </span>
        </div>
      ) : null}

      {midi.learning ? (
        <p className="midi-learning">
          Move the control on your controller to map it, or
          <button type="button" className="btn tiny" onClick={() => midi.learn(null)}>
            CANCEL
          </button>
        </p>
      ) : null}

      <input
        className="tool-input"
        placeholder="Filter controls"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="midi-map">
        {groups.map(([group, targets]) => (
          <div className="midi-group" key={group}>
            <span className="tool-label-sm">{group}</span>
            {targets.map((target) => {
              const binding = bindings.get(target.id);
              const learning = midi.learning === target.id;
              return (
                <div className={`midi-row ${binding ? 'is-bound' : ''}`} key={target.id}>
                  <span className="midi-row-name">{target.name}</span>

                  <button
                    type="button"
                    className={`btn tiny ${learning ? 'primary' : ''}`}
                    disabled={!midi.ready || !midi.settings.enabled}
                    onClick={() => midi.learn(learning ? null : target.id)}
                    title={binding ? 'Remap this control' : 'Assign a control'}
                  >
                    {learning ? 'MOVE IT' : binding ? describeSignal(binding.signal) : 'LEARN'}
                  </button>

                  {binding && target.kind === 'continuous' ? (
                    <span className="seg is-tiny">
                      {MODES.map((mode) => (
                        <button
                          type="button"
                          key={mode.id}
                          className={`seg-btn ${binding.mode === mode.id ? 'is-on' : ''}`}
                          title={mode.hint}
                          aria-pressed={binding.mode === mode.id}
                          onClick={() => midi.setMode(target.id, mode.id)}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span />
                  )}

                  {binding ? (
                    <button
                      type="button"
                      className="btn tiny"
                      title="Unmap"
                      aria-label={`Unmap ${target.name}`}
                      onClick={() => midi.clear(target.id)}
                    >
                      <X size={12} />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="panel-note">
        Mappings live in this browser, like the layout - plugging the same controller into another
        machine means mapping it again. A bound control sends exactly what the on-screen one sends,
        so the control lock still applies: no control, no MIDI.
      </p>
    </section>
  );
}
