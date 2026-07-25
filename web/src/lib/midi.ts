/**
 * MIDI input for the console.
 *
 * A hardware controller talks to this browser, not to the rig: the mapping is
 * personal, the same way the layout is, and two operators plugging in two
 * different controllers should not be fighting over one shared map. Everything
 * a message does ends up as an ordinary command on the socket, so a knob on a
 * controller and a knob on the screen are the same knob as far as the server is
 * concerned — and the control lock still applies.
 *
 * Web MIDI is not in every browser, and the types are not in every TypeScript
 * lib, so the API is reached through a minimal local declaration rather than a
 * dependency.
 */

import { DECK_IDS, PAD_COUNT, type DeckId, type EngineState } from '../protocol';
import type { ClientCommands, CommandName } from '../protocol';

/* ------------------------------------------------------- the browser API */

interface MidiPort {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: string;
}

interface MidiInput extends MidiPort {
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
}

interface MidiAccess {
  inputs: Map<string, MidiInput>;
  onstatechange: ((event: unknown) => void) | null;
}

type MidiCapableNavigator = Navigator & {
  requestMIDIAccess?: (options?: { sysex: boolean }) => Promise<MidiAccess>;
};

export function midiSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as MidiCapableNavigator).requestMIDIAccess === 'function'
  );
}

/* ------------------------------------------------------------- messages */

export type SignalKind = 'cc' | 'note' | 'pitch';

export interface MidiSignal {
  kind: SignalKind;
  /** 1-16, as printed on hardware. */
  channel: number;
  /** Controller or note number. Pitch bend has no number, so it carries 0. */
  number: number;
}

export interface MidiMessage {
  signal: MidiSignal;
  /** Normalised 0..1. A note-off arrives as 0. */
  value: number;
  /** Raw data byte, for working out what an encoder meant. */
  raw: number;
}

export function signalKey(signal: MidiSignal): string {
  return `${signal.kind}:${signal.channel}:${signal.number}`;
}

export function describeSignal(signal: MidiSignal): string {
  if (signal.kind === 'pitch') return `PB ch${signal.channel}`;
  const prefix = signal.kind === 'cc' ? 'CC' : 'NOTE';
  return `${prefix} ${signal.number} ch${signal.channel}`;
}

/** Decodes one MIDI packet, or null for anything the console does not use. */
export function decode(data: Uint8Array): MidiMessage | null {
  if (data.length < 2) return null;
  const status = data[0] & 0xf0;
  const channel = (data[0] & 0x0f) + 1;
  const a = data[1] ?? 0;
  const b = data[2] ?? 0;

  switch (status) {
    case 0xb0:
      return { signal: { kind: 'cc', channel, number: a }, value: b / 127, raw: b };
    case 0x90:
      // A note-on at zero velocity is how most hardware says note-off.
      return { signal: { kind: 'note', channel, number: a }, value: b / 127, raw: b };
    case 0x80:
      return { signal: { kind: 'note', channel, number: a }, value: 0, raw: 0 };
    case 0xe0:
      return { signal: { kind: 'pitch', channel, number: 0 }, value: ((b << 7) | a) / 16383, raw: b };
    default:
      return null;
  }
}

/* -------------------------------------------------------------- targets */

export type TargetKind = 'continuous' | 'button';

export interface MidiContext {
  state: EngineState;
  send: <K extends CommandName>(command: K, payload: ClientCommands[K]) => void;
  throttled: (command: 'deck:set' | 'mixer:set', payload: any) => void;
}

export interface MidiTarget {
  id: string;
  name: string;
  group: string;
  kind: TargetKind;
  /** Where the control sits now, 0..1. Continuous targets only. */
  read?: (state: EngineState) => number;
  /** Continuous: a 0..1 position. Button: 1 on press, 0 on release. */
  apply: (value: number, ctx: MidiContext) => void;
}

const scale = (value: number, min: number, max: number) => min + value * (max - min);
const unscale = (value: number, min: number, max: number) => (value - min) / (max - min);

function deckTargets(id: DeckId): MidiTarget[] {
  const group = `Deck ${id}`;
  const set = (ctx: MidiContext, patch: Record<string, unknown>) =>
    ctx.throttled('deck:set', { deck: id, ...patch });

  return [
    {
      id: `deck.${id}.gain`,
      name: 'Channel fader',
      group,
      kind: 'continuous',
      read: (state) => unscale(state.decks[id].gain, 0, 1.25),
      apply: (v, ctx) => set(ctx, { gain: scale(v, 0, 1.25) }),
    },
    {
      id: `deck.${id}.trim`,
      name: 'Trim',
      group,
      kind: 'continuous',
      read: (state) => unscale(state.decks[id].trim, 0, 2),
      apply: (v, ctx) => set(ctx, { trim: scale(v, 0, 2) }),
    },
    {
      id: `deck.${id}.eq.high`,
      name: 'EQ high',
      group,
      kind: 'continuous',
      read: (state) => unscale(state.decks[id].eq.high, -26, 6),
      apply: (v, ctx) => set(ctx, { eq: { high: scale(v, -26, 6) } }),
    },
    {
      id: `deck.${id}.eq.mid`,
      name: 'EQ mid',
      group,
      kind: 'continuous',
      read: (state) => unscale(state.decks[id].eq.mid, -26, 6),
      apply: (v, ctx) => set(ctx, { eq: { mid: scale(v, -26, 6) } }),
    },
    {
      id: `deck.${id}.eq.low`,
      name: 'EQ low',
      group,
      kind: 'continuous',
      read: (state) => unscale(state.decks[id].eq.low, -26, 6),
      apply: (v, ctx) => set(ctx, { eq: { low: scale(v, -26, 6) } }),
    },
    {
      id: `deck.${id}.filter`,
      name: 'Filter',
      group,
      kind: 'continuous',
      read: (state) => unscale(state.decks[id].filter, -1, 1),
      apply: (v, ctx) => set(ctx, { filter: scale(v, -1, 1) }),
    },
    {
      id: `deck.${id}.pan`,
      name: 'Pan',
      group,
      kind: 'continuous',
      read: (state) => unscale(state.decks[id].pan, -1, 1),
      apply: (v, ctx) => set(ctx, { pan: scale(v, -1, 1) }),
    },
    {
      id: `deck.${id}.fxSend`,
      name: 'FX send',
      group,
      kind: 'continuous',
      read: (state) => state.decks[id].fxSend,
      apply: (v, ctx) => set(ctx, { fxSend: v }),
    },
    {
      id: `deck.${id}.rate`,
      name: 'Pitch',
      group,
      kind: 'continuous',
      read: (state) => unscale(state.decks[id].rate, 0.92, 1.08),
      // A pitch fader wants the useful ±8 %, not the engine's full range.
      apply: (v, ctx) => set(ctx, { rate: scale(v, 0.92, 1.08) }),
    },
    {
      id: `deck.${id}.play`,
      name: 'Play / pause',
      group,
      kind: 'button',
      apply: (v, ctx) => {
        if (v <= 0) return;
        ctx.send(ctx.state.decks[id].playing ? 'deck:pause' : 'deck:play', { deck: id });
      },
    },
    {
      id: `deck.${id}.cue`,
      name: 'Cue',
      group,
      kind: 'button',
      apply: (v, ctx) => {
        if (v > 0) ctx.send('deck:cue', { deck: id });
      },
    },
    {
      id: `deck.${id}.mute`,
      name: 'Mute',
      group,
      kind: 'button',
      apply: (v, ctx) => {
        if (v > 0) ctx.send('deck:set', { deck: id, muted: !ctx.state.decks[id].muted });
      },
    },
    {
      id: `deck.${id}.loop`,
      name: 'Loop in/out',
      group,
      kind: 'button',
      apply: (v, ctx) => {
        if (v <= 0) return;
        const deck = ctx.state.decks[id];
        ctx.send('deck:loop', { deck: id, active: !deck.loop.active });
      },
    },
  ];
}

const mixerTargets: MidiTarget[] = [
  {
    id: 'mixer.crossfader',
    name: 'Crossfader',
    group: 'Mixer',
    kind: 'continuous',
    read: (state) => unscale(state.mixer.crossfader, -1, 1),
    apply: (v, ctx) => ctx.throttled('mixer:set', { crossfader: scale(v, -1, 1) }),
  },
  {
    id: 'mixer.master',
    name: 'Master level',
    group: 'Mixer',
    kind: 'continuous',
    read: (state) => unscale(state.mixer.master, 0, 1.5),
    apply: (v, ctx) => ctx.throttled('mixer:set', { master: scale(v, 0, 1.5) }),
  },
  {
    id: 'mixer.balance',
    name: 'Balance',
    group: 'Mixer',
    kind: 'continuous',
    read: (state) => unscale(state.mixer.balance, -1, 1),
    apply: (v, ctx) => ctx.throttled('mixer:set', { balance: scale(v, -1, 1) }),
  },
  {
    id: 'mixer.curve',
    name: 'Crossfader curve',
    group: 'Mixer',
    kind: 'continuous',
    read: (state) => state.mixer.crossfaderCurve,
    apply: (v, ctx) => ctx.throttled('mixer:set', { crossfaderCurve: v }),
  },
  {
    id: 'mixer.padBus',
    name: 'Pad bus',
    group: 'Mixer',
    kind: 'continuous',
    read: (state) => unscale(state.mixer.padBus, 0, 1.5),
    apply: (v, ctx) => ctx.throttled('mixer:set', { padBus: scale(v, 0, 1.5) }),
  },
  {
    id: 'mixer.mono',
    name: 'Mono',
    group: 'Mixer',
    kind: 'button',
    apply: (v, ctx) => {
      if (v > 0) ctx.send('mixer:set', { mono: !ctx.state.mixer.mono });
    },
  },
  {
    id: 'mixer.limiter',
    name: 'Limiter',
    group: 'Mixer',
    kind: 'button',
    apply: (v, ctx) => {
      if (v > 0) ctx.send('mixer:set', { limiter: !ctx.state.mixer.limiter });
    },
  },
  {
    id: 'fx.mix',
    name: 'FX return',
    group: 'FX',
    kind: 'continuous',
    read: (state) => state.mixer.fx.mix,
    apply: (v, ctx) => ctx.throttled('mixer:set', { fx: { mix: v } }),
  },
  {
    id: 'fx.timeMs',
    name: 'FX time',
    group: 'FX',
    kind: 'continuous',
    read: (state) => unscale(state.mixer.fx.timeMs, 20, 2000),
    apply: (v, ctx) => ctx.throttled('mixer:set', { fx: { timeMs: scale(v, 20, 2000) } }),
  },
  {
    id: 'fx.feedback',
    name: 'FX feedback',
    group: 'FX',
    kind: 'continuous',
    read: (state) => unscale(state.mixer.fx.feedback, 0, 0.95),
    apply: (v, ctx) => ctx.throttled('mixer:set', { fx: { feedback: scale(v, 0, 0.95) } }),
  },
  {
    id: 'fx.tone',
    name: 'FX tone',
    group: 'FX',
    kind: 'continuous',
    read: (state) => state.mixer.fx.tone,
    apply: (v, ctx) => ctx.throttled('mixer:set', { fx: { tone: v } }),
  },
];

const padTargets: MidiTarget[] = Array.from({ length: PAD_COUNT }, (_, index) => ({
  id: `pad.${index}`,
  name: `Pad ${index + 1}`,
  group: 'Pads',
  kind: 'button' as const,
  apply: (v: number, ctx: MidiContext) => {
    const pad = ctx.state.pads[index];
    if (v > 0) ctx.send('pad:trigger', { index });
    else if (pad?.mode === 'gate') ctx.send('pad:stop', { index });
  },
}));

/** Everything a controller can be pointed at. */
export const MIDI_TARGETS: MidiTarget[] = [
  ...mixerTargets,
  ...DECK_IDS.flatMap(deckTargets),
  ...padTargets,
];

export const TARGETS_BY_ID = new Map(MIDI_TARGETS.map((target) => [target.id, target]));

/* ------------------------------------------------------------ bindings */

export type BindingMode = 'absolute' | 'relative' | 'pickup';

export interface MidiBinding {
  targetId: string;
  signal: MidiSignal;
  /**
   * `absolute` follows the control straight away, `pickup` waits until the
   * incoming value passes where the console already is (so a fader that is not
   * where the software is does not slam), and `relative` treats the message as
   * an endless-encoder tick.
   */
  mode: BindingMode;
}

export interface MidiSettings {
  enabled: boolean;
  /** Input ids to listen to. Empty means every input. */
  inputs: string[];
  bindings: MidiBinding[];
}

const STORAGE_KEY = 'deck.midi.v1';

export function defaultMidiSettings(): MidiSettings {
  return { enabled: false, inputs: [], bindings: [] };
}

export function loadMidiSettings(): MidiSettings {
  if (typeof window === 'undefined') return defaultMidiSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMidiSettings();
    const parsed = JSON.parse(raw) as MidiSettings;
    return {
      enabled: Boolean(parsed.enabled),
      inputs: Array.isArray(parsed.inputs) ? parsed.inputs.filter((id) => typeof id === 'string') : [],
      bindings: Array.isArray(parsed.bindings)
        ? parsed.bindings.filter(
            (binding) =>
              binding &&
              TARGETS_BY_ID.has(binding.targetId) &&
              binding.signal &&
              typeof binding.signal.number === 'number',
          )
        : [],
    };
  } catch {
    return defaultMidiSettings();
  }
}

export function saveMidiSettings(settings: MidiSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A blocked store costs the mapping on the next reload, nothing more.
  }
}

/**
 * Turns one message into a value for a target, or null when the binding is
 * waiting to be picked up.
 *
 * `held` carries the value the target had when the console last set it, which
 * is what pickup compares against and what a relative encoder adds to.
 */
export function resolveValue(
  binding: MidiBinding,
  message: MidiMessage,
  current: number,
): number | null {
  if (binding.mode === 'relative') {
    // Two's-complement encoders: 1..63 counts up, 65..127 counts down.
    const delta = message.raw < 64 ? message.raw : message.raw - 128;
    if (delta === 0) return null;
    return Math.max(0, Math.min(1, current + delta / 64));
  }
  if (binding.mode === 'pickup' && Math.abs(message.value - current) > 0.08) return null;
  return message.value;
}

/* ------------------------------------------------------------------ hub */

export interface MidiDevice {
  id: string;
  name: string;
}

type Listener = (message: MidiMessage, deviceId: string) => void;

/**
 * Wraps the browser's MIDI access: one place that owns the permission prompt,
 * the port list and the message fan-out, so components can subscribe without
 * each asking for access of their own.
 */
class MidiHub {
  private access: MidiAccess | null = null;
  private listeners = new Set<Listener>();
  private devicesChanged = new Set<() => void>();

  get ready(): boolean {
    return this.access !== null;
  }

  async enable(): Promise<void> {
    if (this.access) return;
    const request = (navigator as MidiCapableNavigator).requestMIDIAccess;
    if (!request) throw new Error('This browser has no Web MIDI support.');
    const access = await request.call(navigator, { sysex: false });
    this.access = access;
    access.onstatechange = () => {
      this.bind();
      for (const notify of this.devicesChanged) notify();
    };
    this.bind();
  }

  /** Attaches to every port; filtering by device happens on the way out. */
  private bind(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event) => {
        const message = decode(event.data);
        if (!message) return;
        for (const listener of this.listeners) listener(message, input.id);
      };
    }
  }

  devices(): MidiDevice[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((input) => ({
      id: input.id,
      name: [input.manufacturer, input.name].filter(Boolean).join(' ') || 'Unnamed input',
    }));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onDevicesChanged(listener: () => void): () => void {
    this.devicesChanged.add(listener);
    return () => {
      this.devicesChanged.delete(listener);
    };
  }
}

export const midiHub = new MidiHub();
