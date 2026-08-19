import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TARGETS_BY_ID,
  loadMidiSettings,
  midiHub,
  midiSupported,
  resolveValue,
  saveMidiSettings,
  signalKey,
  type MidiBinding,
  type MidiContext,
  type MidiDevice,
  type MidiMessage,
  type MidiSettings,
} from './midi';

/**
 * The MIDI runtime.
 *
 * It lives above the console rather than inside the MIDI panel, because a
 * controller should keep working when the panel is not on the grid - taking a
 * tool off the console is a layout decision, not a routing one.
 */

/**
 * How long the console trusts its own last value over the server's echo. Long
 * enough to cover the throttled round trip, short enough that a control moved
 * from somewhere else is picked up rather than fought.
 */
const ECHO_MS = 600;

export interface MidiRuntime {
  supported: boolean;
  ready: boolean;
  error: string | null;
  settings: MidiSettings;
  devices: MidiDevice[];
  /** The last message seen, whether or not anything was bound to it. */
  last: MidiMessage | null;
  /** Target currently waiting to be assigned, if any. */
  learning: string | null;
  enable: () => void;
  disable: () => void;
  setInputs: (inputs: string[]) => void;
  learn: (targetId: string | null) => void;
  clear: (targetId: string) => void;
  setMode: (targetId: string, mode: MidiBinding['mode']) => void;
  reset: () => void;
}

export function useMidiRuntime(ctx: MidiContext | null): MidiRuntime {
  const [settings, setSettings] = useState<MidiSettings>(loadMidiSettings);
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<MidiMessage | null>(null);
  const [learning, setLearning] = useState<string | null>(null);

  // The message handler is registered once and reads through these, so a state
  // broadcast does not tear down and rebuild the MIDI subscription.
  const context = useRef(ctx);
  context.current = ctx;
  const learningRef = useRef(learning);
  learningRef.current = learning;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** What the console last sent for a target, so pickup has something honest to compare against. */
  const sent = useRef(new Map<string, { value: number; at: number }>());

  const persist = useCallback((next: MidiSettings) => {
    setSettings(next);
    saveMidiSettings(next);
  }, []);

  const enable = useCallback(() => {
    setError(null);
    midiHub
      .enable()
      .then(() => {
        setReady(true);
        setDevices(midiHub.devices());
        persist({ ...settingsRef.current, enabled: true });
      })
      .catch((err: Error) => {
        // A refused permission prompt lands here, as does a browser with no
        // Web MIDI at all - both are worth saying out loud rather than leaving
        // the switch stuck on.
        setError(err.message || 'MIDI access was refused.');
        persist({ ...settingsRef.current, enabled: false });
      });
  }, [persist]);

  const disable = useCallback(() => {
    persist({ ...settingsRef.current, enabled: false });
  }, [persist]);

  // Reconnect on load if MIDI was on last time. The browser only prompts once
  // per origin, so this is silent for anyone who has already allowed it.
  useEffect(() => {
    if (!settings.enabled || ready || !midiSupported()) return;
    enable();
  }, [enable, ready, settings.enabled]);

  useEffect(() => midiHub.onDevicesChanged(() => setDevices(midiHub.devices())), []);

  useEffect(() => {
    return midiHub.subscribe((message, deviceId) => {
      const current = settingsRef.current;
      if (!current.enabled) return;
      if (current.inputs.length > 0 && !current.inputs.includes(deviceId)) return;
      setLast(message);

      // Learning takes the message rather than acting on it, and drops the
      // release half of a button press so a note-off cannot rebind.
      const target = learningRef.current;
      if (target) {
        if (message.value <= 0 && message.signal.kind === 'note') return;
        const bindings = current.bindings
          .filter((binding) => binding.targetId !== target)
          .filter((binding) => signalKey(binding.signal) !== signalKey(message.signal));
        const kind = TARGETS_BY_ID.get(target)?.kind;
        bindings.push({
          targetId: target,
          signal: message.signal,
          mode: kind === 'button' ? 'absolute' : 'pickup',
        });
        const next = { ...current, bindings };
        setSettings(next);
        saveMidiSettings(next);
        setLearning(null);
        return;
      }

      const ctxNow = context.current;
      if (!ctxNow) return;
      const key = signalKey(message.signal);
      for (const binding of current.bindings) {
        if (signalKey(binding.signal) !== key) continue;
        const bound = TARGETS_BY_ID.get(binding.targetId);
        if (!bound) continue;
        if (bound.kind === 'button') {
          bound.apply(message.value > 0 ? 1 : 0, ctxNow);
          continue;
        }
        const echo = sent.current.get(binding.targetId);
        const now = Date.now();
        const currentValue =
          echo && now - echo.at < ECHO_MS ? echo.value : bound.read?.(ctxNow.state) ?? 0;
        const value = resolveValue(binding, message, currentValue);
        if (value === null) continue;
        sent.current.set(binding.targetId, { value, at: now });
        bound.apply(value, ctxNow);
      }
    });
  }, []);

  const setInputs = useCallback(
    (inputs: string[]) => persist({ ...settingsRef.current, inputs }),
    [persist],
  );

  const clear = useCallback(
    (targetId: string) =>
      persist({
        ...settingsRef.current,
        bindings: settingsRef.current.bindings.filter((b) => b.targetId !== targetId),
      }),
    [persist],
  );

  const setMode = useCallback(
    (targetId: string, mode: MidiBinding['mode']) =>
      persist({
        ...settingsRef.current,
        bindings: settingsRef.current.bindings.map((b) =>
          b.targetId === targetId ? { ...b, mode } : b,
        ),
      }),
    [persist],
  );

  const reset = useCallback(
    () => persist({ ...settingsRef.current, bindings: [] }),
    [persist],
  );

  return useMemo(
    () => ({
      supported: midiSupported(),
      ready,
      error,
      settings,
      devices,
      last,
      learning,
      enable,
      disable,
      setInputs,
      learn: setLearning,
      clear,
      setMode,
      reset,
    }),
    [clear, devices, disable, enable, error, last, learning, ready, reset, setInputs, setMode, settings],
  );
}
