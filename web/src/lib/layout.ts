/**
 * Console layout: which widgets are on the deck page, in what order, and how
 * wide each one is.
 *
 * This is a personal preference rather than rig state. Two operators on
 * different screens want different arrangements, and somebody tidying their
 * console should not rearrange everyone else's mid-set — so it lives in this
 * browser and never goes near the server.
 */

export type WidgetId =
  | 'pool'
  | 'deckA'
  | 'mixer'
  | 'deckB'
  | 'pads'
  | 'output'
  | 'crew'
  | 'nowPlaying'
  | 'transport'
  | 'crossfader'
  | 'onAir'
  | 'clock'
  | 'shortcuts';

export interface WidgetSpec {
  id: WidgetId;
  name: string;
  hint: string;
  /** Default width, in columns of the twelve-column grid. */
  span: number;
  /** Narrowest this stays usable. The editor will not go below it. */
  min: number;
}

/** The grid every span is measured against. */
export const GRID_COLUMNS = 12;
/** Roughly the narrowest a column can be before panels start to look silly. */
const MIN_COLUMN_PX = 108;

/**
 * The widget palette, in the order they appear on a fresh console. The default
 * spans add up to a full row at a time, so an untouched layout lands as two
 * tidy rows rather than a ragged wrap.
 */
export const WIDGETS: WidgetSpec[] = [
  { id: 'pool', name: 'Media pool', hint: 'Upload, search and drag tracks out', span: 3, min: 2 },
  { id: 'deckA', name: 'Deck A', hint: 'Waveform, transport, loops and pitch', span: 3, min: 3 },
  { id: 'mixer', name: 'Mixer', hint: 'Trim, EQ, filter, faders and crossfader', span: 3, min: 2 },
  { id: 'deckB', name: 'Deck B', hint: 'Waveform, transport, loops and pitch', span: 3, min: 3 },
  { id: 'output', name: 'Booth output', hint: 'Meter bridge, peak levels and clip', span: 3, min: 2 },
  { id: 'crew', name: 'Crew', hint: 'Who has control, who is waiting, who is on', span: 3, min: 2 },
  { id: 'pads', name: 'Sample pads', hint: 'Eight trigger pads and the pad bus', span: 6, min: 2 },
  {
    id: 'nowPlaying',
    name: 'Now playing',
    hint: 'What the room is actually hearing, in large type',
    span: 3,
    min: 2,
  },
  {
    id: 'transport',
    name: 'Transport',
    hint: 'Cue, play and sync for both decks in one strip',
    span: 3,
    min: 2,
  },
  {
    id: 'crossfader',
    name: 'Crossfader',
    hint: 'The crossfader and auto-fade, on their own',
    span: 3,
    min: 2,
  },
  { id: 'onAir', name: 'Broadcast', hint: 'Live or not, and who is listening', span: 3, min: 2 },
  { id: 'clock', name: 'Session', hint: 'Wall clock and how long you have been on', span: 3, min: 2 },
  {
    id: 'shortcuts',
    name: 'Shortcuts',
    hint: 'Keyboard and gesture reference',
    span: 3,
    min: 2,
  },
];

/**
 * Widgets that are off on a fresh console. They either duplicate something a
 * default panel already shows, or are only wanted on a particular kind of
 * screen — so they are in the palette rather than in the way.
 */
const OFF_BY_DEFAULT = new Set<WidgetId>([
  'nowPlaying',
  'transport',
  'crossfader',
  'onAir',
  'clock',
  'shortcuts',
]);

const BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));

export function spec(id: WidgetId): WidgetSpec {
  // Callers only ever pass ids that came from a validated layout.
  return BY_ID.get(id) as WidgetSpec;
}

export interface Placed {
  id: WidgetId;
  span: number;
  hidden?: boolean;
}

export type Layout = Placed[];

const STORAGE_KEY = 'deck.layout.v1';

export function defaultLayout(): Layout {
  return WIDGETS.map((widget) => ({
    id: widget.id,
    span: widget.span,
    hidden: OFF_BY_DEFAULT.has(widget.id),
  }));
}

export function clampSpan(id: WidgetId, span: number): number {
  const min = spec(id)?.min ?? 1;
  return Math.max(min, Math.min(GRID_COLUMNS, Math.round(span)));
}

/**
 * Reads a stored layout, keeping what still makes sense and repairing the rest.
 * Widgets added to the palette after a layout was saved get appended rather
 * than silently going missing.
 */
export function loadLayout(): Layout {
  if (typeof window === 'undefined') return defaultLayout();
  let stored: unknown;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    stored = JSON.parse(raw);
  } catch {
    return defaultLayout();
  }
  if (!Array.isArray(stored)) return defaultLayout();

  const seen = new Set<WidgetId>();
  const layout: Layout = [];
  for (const entry of stored) {
    const id = (entry as Placed)?.id;
    if (!BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    layout.push({
      id,
      span: clampSpan(id, Number((entry as Placed).span) || spec(id).span),
      hidden: Boolean((entry as Placed).hidden),
    });
  }

  for (const widget of WIDGETS) {
    if (seen.has(widget.id)) continue;
    layout.push({ id: widget.id, span: widget.span, hidden: OFF_BY_DEFAULT.has(widget.id) });
  }

  return layout.length > 0 ? layout : defaultLayout();
}

export function saveLayout(layout: Layout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A full or blocked store is not worth interrupting a set over.
  }
}

/**
 * How many columns fit at this width.
 *
 * The grid is nominally twelve columns, but on a laptop twelve of them are too
 * narrow to hold anything — so the count comes down and every span is clamped
 * against it. That is what stops a three-column widget becoming a sliver.
 */
export function columnsFor(width: number): number {
  if (width <= 0) return GRID_COLUMNS;
  return Math.max(1, Math.min(GRID_COLUMNS, Math.floor(width / MIN_COLUMN_PX)));
}

/* --------------------------------------------------------------- presets */

export interface Preset {
  id: string;
  name: string;
  hint: string;
  /** Widgets on the console, in order, with their widths. */
  place: Array<[WidgetId, number]>;
}

/**
 * Builds a full layout from a preset: the listed widgets in the order given,
 * then everything else appended and hidden. Keeping the unlisted widgets in the
 * array is what lets the palette still offer them afterwards.
 */
export function fromPreset(preset: Preset): Layout {
  const placed: Layout = preset.place.map(([id, span]) => ({
    id,
    span: clampSpan(id, span),
    hidden: false,
  }));
  const used = new Set(placed.map((entry) => entry.id));
  for (const widget of WIDGETS) {
    if (used.has(widget.id)) continue;
    placed.push({ id: widget.id, span: widget.span, hidden: true });
  }
  return placed;
}

/**
 * Starting points, each shaped for a different job. Spans add up to whole rows
 * so a preset lands tidily rather than leaving a ragged edge.
 */
export const PRESETS: Preset[] = [
  {
    id: 'full',
    name: 'Full console',
    hint: 'Everything, in the default arrangement',
    place: [
      ['pool', 3],
      ['deckA', 3],
      ['mixer', 3],
      ['deckB', 3],
      ['output', 3],
      ['crew', 3],
      ['pads', 6],
    ],
  },
  {
    id: 'compact',
    name: 'Compact',
    hint: 'Decks, mixer and pool only — for a laptop screen',
    place: [
      ['deckA', 4],
      ['mixer', 4],
      ['deckB', 4],
      ['pool', 6],
      ['pads', 6],
    ],
  },
  {
    id: 'performance',
    name: 'Performance',
    hint: 'Big readouts and the essentials, for playing off a small screen',
    place: [
      ['nowPlaying', 6],
      ['onAir', 3],
      ['clock', 3],
      ['transport', 6],
      ['crossfader', 6],
      ['pads', 12],
    ],
  },
  {
    id: 'monitor',
    name: 'Booth monitor',
    hint: 'Read-only display for a second screen — nothing to knock',
    place: [
      ['nowPlaying', 6],
      ['output', 6],
      ['onAir', 4],
      ['clock', 4],
      ['crew', 4],
    ],
  },
  {
    id: 'library',
    name: 'Library',
    hint: 'A wide pool for tagging and prepping between sets',
    place: [
      ['pool', 6],
      ['deckA', 3],
      ['deckB', 3],
      ['nowPlaying', 4],
      ['crew', 4],
      ['shortcuts', 4],
    ],
  },
];

/** Moves a widget within the layout, keeping the array immutable. */
export function move(layout: Layout, index: number, delta: number): Layout {
  const target = index + delta;
  if (target < 0 || target >= layout.length) return layout;
  const next = [...layout];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Moves the widget at `from` to sit at `to` — the drag-and-drop path. */
export function reorder(layout: Layout, from: number, to: number): Layout {
  if (from === to || from < 0 || to < 0 || from >= layout.length || to >= layout.length) {
    return layout;
  }
  const next = [...layout];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
