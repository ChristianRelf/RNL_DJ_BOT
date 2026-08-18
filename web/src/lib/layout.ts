/**
 * Console layout: which tools are on the deck page, where each one sits, and
 * how big it is.
 *
 * This is a personal preference rather than rig state. Two operators on
 * different screens want different arrangements, and somebody tidying their
 * console should not rearrange everyone else's mid-set — so it lives in this
 * browser and never goes near the server.
 *
 * The console is a free grid rather than a flow: every tool carries an explicit
 * column and row, so it stays exactly where it was put. Nothing is ever allowed
 * to sit on top of anything else — a move or a resize pushes whatever it lands
 * on downwards — which is what keeps panels from clipping each other.
 */

export type WidgetId =
  | 'pool'
  | 'queue'
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
  | 'shortcuts'
  | 'mixerAdvanced'
  | 'fx'
  | 'midi'
  | 'library';

/** Groups the palette sorts tools into. */
export type WidgetGroup = 'decks' | 'mix' | 'library' | 'info';

export interface WidgetSpec {
  id: WidgetId;
  name: string;
  hint: string;
  group: WidgetGroup;
  /** Default size, in grid cells. */
  w: number;
  h: number;
  /** Narrowest and shortest this stays usable. The editor will not go below it. */
  minW: number;
  minH: number;
}

/** Transfer type used when a tool is dragged out of the palette onto the grid. */
export const DRAG_MIME = 'application/x-rnl-widget';

/**
 * What is currently being dragged out of the palette.
 *
 * A `dragover` handler is not allowed to read the transfer's data — only its
 * types — and the grid needs the id to draw the landing rectangle under the
 * cursor. One module-level value covers it: a pointer can only drag one thing
 * at a time.
 */
let dragged: WidgetId | null = null;

export function setDragPayload(id: WidgetId | null): void {
  dragged = id;
}

export function dragPayload(): WidgetId | null {
  return dragged;
}

/** The grid every position is measured against. */
export const GRID_COLUMNS = 12;
/** Height of one grid row, in pixels. */
export const ROW_PX = 16;
/** Gap between cells, in pixels. Also the gutter between tiles. */
export const GRID_GAP = 8;
/**
 * Below this the grid stops being a grid: columns would be too narrow to hold
 * a knob row, so the console stacks instead and every tool sizes to its own
 * content. Arranging is a desktop job.
 */
export const STACK_WIDTH_PX = 860;

/** Pixel height of a tile `rows` cells tall. */
export function pxForRows(rows: number): number {
  return rows * ROW_PX + (rows - 1) * GRID_GAP;
}

/** Rows needed to hold `px` pixels of content without cutting any of it off. */
export function rowsForPx(px: number): number {
  return Math.max(1, Math.ceil((px + GRID_GAP) / (ROW_PX + GRID_GAP)));
}

/**
 * The tool palette. Sizes are the ones each panel wants when it lands on an
 * empty console; the editor is free to take them anywhere above the minimum,
 * and "fit" measures the panel and sizes the tile to its content exactly.
 */
export const WIDGETS: WidgetSpec[] = [
  {
    id: 'library',
    name: 'Music folder',
    hint: 'Where the audio comes from - a folder on your machine',
    group: 'library',
    w: 3,
    h: 12,
    minW: 2,
    minH: 8,
  },
  {
    id: 'pool',
    name: 'Media pool',
    hint: 'Upload, search and drag tracks out',
    group: 'library',
    w: 3,
    h: 26,
    minW: 2,
    minH: 10,
  },
  {
    id: 'queue',
    name: 'Queue',
    hint: 'What is lined up next, and who asked for it',
    group: 'library',
    w: 3,
    h: 18,
    minW: 2,
    minH: 8,
  },
  {
    id: 'deckA',
    name: 'Deck A',
    hint: 'Waveform, transport, loops and pitch',
    group: 'decks',
    w: 3,
    h: 25,
    minW: 3,
    minH: 14,
  },
  {
    id: 'mixer',
    name: 'Mixer',
    hint: 'Trim, EQ, filter, faders and crossfader',
    group: 'mix',
    w: 3,
    h: 22,
    minW: 2,
    minH: 14,
  },
  {
    id: 'deckB',
    name: 'Deck B',
    hint: 'Waveform, transport, loops and pitch',
    group: 'decks',
    w: 3,
    h: 25,
    minW: 3,
    minH: 14,
  },
  {
    id: 'mixerAdvanced',
    name: 'Advanced mixer',
    hint: 'Full channel strips, sends, master EQ and bus routing',
    group: 'mix',
    w: 6,
    h: 24,
    minW: 4,
    minH: 16,
  },
  {
    id: 'fx',
    name: 'FX rack',
    hint: 'Echo, reverb and flanger on the send bus',
    group: 'mix',
    w: 3,
    h: 17,
    minW: 2,
    minH: 10,
  },
  {
    id: 'midi',
    name: 'MIDI control',
    hint: 'Map a hardware controller onto the console',
    group: 'mix',
    w: 4,
    h: 19,
    minW: 3,
    minH: 10,
  },
  {
    id: 'output',
    name: 'Booth output',
    hint: 'Meter bridge, peak levels and clip',
    group: 'info',
    w: 3,
    h: 9,
    minW: 2,
    minH: 6,
  },
  {
    id: 'crew',
    name: 'Crew',
    hint: 'Who has control, who is waiting, who is on',
    group: 'info',
    w: 3,
    h: 10,
    minW: 2,
    minH: 5,
  },
  {
    id: 'pads',
    name: 'Sample pads',
    hint: 'Eight trigger pads and the pad bus',
    group: 'decks',
    w: 6,
    h: 13,
    minW: 2,
    minH: 7,
  },
  {
    id: 'nowPlaying',
    name: 'Now playing',
    hint: 'What the room is actually hearing, in large type',
    group: 'info',
    w: 3,
    h: 7,
    minW: 2,
    minH: 4,
  },
  {
    id: 'transport',
    name: 'Transport',
    hint: 'Cue, play and sync for both decks in one strip',
    group: 'decks',
    w: 3,
    h: 6,
    minW: 2,
    minH: 4,
  },
  {
    id: 'crossfader',
    name: 'Crossfader',
    hint: 'The crossfader and auto-fade, on their own',
    group: 'mix',
    w: 3,
    h: 5,
    minW: 2,
    minH: 3,
  },
  {
    id: 'onAir',
    name: 'Broadcast',
    hint: 'Live or not, and who is listening',
    group: 'info',
    w: 3,
    h: 7,
    minW: 2,
    minH: 4,
  },
  {
    id: 'clock',
    name: 'Session',
    hint: 'Wall clock and how long you have been on',
    group: 'info',
    w: 3,
    h: 6,
    minW: 2,
    minH: 4,
  },
  {
    id: 'shortcuts',
    name: 'Shortcuts',
    hint: 'Keyboard and gesture reference',
    group: 'info',
    w: 3,
    h: 10,
    minW: 2,
    minH: 5,
  },
];

export const WIDGET_GROUPS: Array<{ id: WidgetGroup; name: string }> = [
  { id: 'decks', name: 'Decks' },
  { id: 'mix', name: 'Mixing' },
  { id: 'library', name: 'Library' },
  { id: 'info', name: 'Readouts' },
];

const BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));

export function spec(id: WidgetId): WidgetSpec {
  // Callers only ever pass ids that came from a validated layout.
  return BY_ID.get(id) as WidgetSpec;
}

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === 'string' && BY_ID.has(value as WidgetId);
}

/** A tool on the console: its cell, its size, and whether it is shown at all. */
export interface Placed {
  id: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
}

export type Layout = Placed[];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = 'deck.layout.v2';
/** The pre-grid layout, kept only long enough to convert it. */
const LEGACY_KEY = 'deck.layout.v1';

/* ------------------------------------------------------------- geometry */

export function clampRect(id: WidgetId, rect: Rect): Rect {
  const { minW, minH } = spec(id);
  const w = Math.max(minW, Math.min(GRID_COLUMNS, Math.round(rect.w)));
  const h = Math.max(minH, Math.round(rect.h));
  return {
    w,
    h,
    x: Math.max(0, Math.min(GRID_COLUMNS - w, Math.round(rect.x))),
    y: Math.max(0, Math.round(rect.y)),
  };
}

function collides(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Reading order: top to bottom, then left to right. */
function inReadingOrder(layout: Layout): Placed[] {
  return layout.filter((item) => !item.hidden).sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Places one tool at `rect` and shoves whatever it lands on out of the way,
 * downwards, recursively.
 *
 * Pushing only ever increases a y, so the walk always terminates; the guard is
 * there for the pathological case of a console full of full-width tools where
 * one move cascades through every one of them.
 */
export function place(layout: Layout, id: WidgetId, rect: Rect): Layout {
  const next: Layout = layout.map((item) =>
    item.id === id ? { ...item, ...clampRect(id, rect), hidden: false } : { ...item },
  );

  const moved = next.find((item) => item.id === id);
  if (!moved) return next;

  const queue: Placed[] = [moved];
  let guard = next.length * next.length + 16;
  while (queue.length > 0 && guard-- > 0) {
    const above = queue.shift() as Placed;
    for (const other of next) {
      if (other === above || other.hidden || other.id === id) continue;
      if (!collides(above, other)) continue;
      other.y = above.y + above.h;
      queue.push(other);
    }
  }

  return next;
}

/** Pulls every tool up into the space above it, keeping columns and widths. */
export function compact(layout: Layout): Layout {
  const next = layout.map((item) => ({ ...item }));
  const settled: Placed[] = [];
  for (const item of inReadingOrder(next)) {
    let y = item.y;
    while (y > 0) {
      const probe = { ...item, y: y - 1 };
      if (settled.some((other) => collides(probe, other))) break;
      y -= 1;
    }
    item.y = y;
    settled.push(item);
  }
  return next;
}

/** The first row with room for a `w` × `h` tool at column `x`. */
export function firstFreeRow(layout: Layout, x: number, w: number, h: number): number {
  const others = layout.filter((item) => !item.hidden);
  for (let y = 0; y < 400; y++) {
    const probe = { x, y, w, h };
    if (!others.some((other) => collides(probe, other))) return y;
  }
  return 0;
}

/** How many rows tall the console currently is. */
export function layoutHeight(layout: Layout): number {
  return layout.reduce((max, item) => (item.hidden ? max : Math.max(max, item.y + item.h)), 0);
}

/* ------------------------------------------------------------ defaults */

/**
 * A fresh console is the first preset. Everything the preset does not place —
 * the readouts, the advanced mixer, the FX rack, MIDI — waits in the palette
 * tray rather than being in the way from the start.
 */
export function defaultLayout(): Layout {
  return fromPreset(PRESETS[0]);
}

/**
 * Reads a stored layout, keeping what still makes sense and repairing the rest.
 * Tools added to the palette after a layout was saved get parked in the tray
 * rather than silently going missing, and anything that has drifted into an
 * overlap is separated on the way in.
 */
/**
 * Whether this browser has an arrangement of its own yet. A console that has
 * never been arranged gets its tiles fitted to their contents on the first
 * render, which is more honest than the sizes in the palette — those are
 * guesses about panels whose height depends on what is in them.
 */
export function hasStoredLayout(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function loadLayout(): Layout {
  if (typeof window === 'undefined') return defaultLayout();

  let stored: unknown;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateLegacy() ?? defaultLayout();
    stored = JSON.parse(raw);
  } catch {
    return defaultLayout();
  }
  if (!Array.isArray(stored)) return defaultLayout();

  const seen = new Set<WidgetId>();
  const layout: Layout = [];
  for (const entry of stored as Placed[]) {
    if (!isWidgetId(entry?.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const fallback = spec(entry.id);
    layout.push({
      id: entry.id,
      hidden: Boolean(entry.hidden),
      ...clampRect(entry.id, {
        x: Number(entry.x) || 0,
        y: Number(entry.y) || 0,
        w: Number(entry.w) || fallback.w,
        h: Number(entry.h) || fallback.h,
      }),
    });
  }

  for (const widget of WIDGETS) {
    if (seen.has(widget.id)) continue;
    layout.push({ id: widget.id, x: 0, y: 0, w: widget.w, h: widget.h, hidden: true });
  }

  return layout.length > 0 ? separate(layout) : defaultLayout();
}

/** Re-seats a whole layout so that nothing overlaps, keeping reading order. */
export function separate(layout: Layout): Layout {
  let next = layout.map((item) => ({ ...item }));
  for (const item of inReadingOrder(next)) {
    next = place(next, item.id, item);
  }
  return next;
}

/**
 * Converts a layout saved by the old flow-based console: the tools kept their
 * order and their width in columns, and heights come from the palette.
 */
function migrateLegacy(): Layout | null {
  let stored: unknown;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(stored)) return null;

  const layout: Layout = [];
  const seen = new Set<WidgetId>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const entry of stored as Array<{ id: WidgetId; span?: number; hidden?: boolean }>) {
    if (!isWidgetId(entry?.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const widget = spec(entry.id);
    if (entry.hidden) {
      layout.push({ id: entry.id, x: 0, y: 0, w: widget.w, h: widget.h, hidden: true });
      continue;
    }
    const w = Math.max(widget.minW, Math.min(GRID_COLUMNS, Math.round(Number(entry.span) || widget.w)));
    if (x + w > GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    layout.push({ id: entry.id, x, y, w, h: widget.h });
    x += w;
    rowHeight = Math.max(rowHeight, widget.h);
  }

  for (const widget of WIDGETS) {
    if (seen.has(widget.id)) continue;
    layout.push({ id: widget.id, x: 0, y: 0, w: widget.w, h: widget.h, hidden: true });
  }

  return layout.length > 0 ? separate(layout) : null;
}

export function saveLayout(layout: Layout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A full or blocked store is not worth interrupting a set over.
  }
}

/* --------------------------------------------------------------- presets */

export interface Preset {
  id: string;
  name: string;
  hint: string;
  /** Tools on the console, with where each one sits. */
  place: Array<[WidgetId, number, number, number, number]>;
}

/**
 * Builds a full layout from a preset: the listed tools where the preset puts
 * them, then everything else parked in the tray. Keeping the unlisted tools in
 * the array is what lets the palette still offer them afterwards.
 */
export function fromPreset(preset: Preset): Layout {
  const placed: Layout = preset.place.map(([id, x, y, w, h]) => ({
    id,
    ...clampRect(id, { x, y, w, h }),
    hidden: false,
  }));
  const used = new Set(placed.map((entry) => entry.id));
  for (const widget of WIDGETS) {
    if (used.has(widget.id)) continue;
    placed.push({ id: widget.id, x: 0, y: 0, w: widget.w, h: widget.h, hidden: true });
  }
  return separate(placed);
}

/** Starting points, each shaped for a different job. */
export const PRESETS: Preset[] = [
  {
    id: 'full',
    name: 'Full console',
    hint: 'Pool, both decks and the mixer across the top',
    place: [
      ['pool', 0, 0, 3, 26],
      ['deckA', 3, 0, 3, 25],
      ['mixer', 6, 0, 3, 22],
      ['deckB', 9, 0, 3, 25],
      ['pads', 0, 26, 6, 13],
      ['output', 6, 26, 3, 9],
      ['crew', 9, 26, 3, 10],
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    hint: 'The advanced mixer and the FX rack, with both decks above',
    place: [
      ['deckA', 0, 0, 4, 25],
      ['pool', 4, 0, 4, 26],
      ['deckB', 8, 0, 4, 25],
      ['mixerAdvanced', 0, 26, 6, 24],
      ['fx', 6, 26, 3, 17],
      ['midi', 9, 26, 3, 19],
      ['pads', 6, 50, 6, 13],
    ],
  },
  {
    id: 'compact',
    name: 'Compact',
    hint: 'Decks, mixer and pool only — for a laptop screen',
    place: [
      ['deckA', 0, 0, 4, 25],
      ['mixer', 4, 0, 4, 22],
      ['deckB', 8, 0, 4, 25],
      ['pool', 0, 25, 6, 20],
      ['pads', 6, 25, 6, 13],
    ],
  },
  {
    id: 'performance',
    name: 'Performance',
    hint: 'Big readouts and the essentials, for playing off a small screen',
    place: [
      ['nowPlaying', 0, 0, 6, 7],
      ['onAir', 6, 0, 3, 7],
      ['clock', 9, 0, 3, 6],
      ['transport', 0, 7, 6, 6],
      ['crossfader', 6, 7, 6, 5],
      ['pads', 0, 13, 8, 13],
      ['fx', 8, 13, 4, 17],
    ],
  },
  {
    id: 'monitor',
    name: 'Booth monitor',
    hint: 'Read-only display for a second screen — nothing to knock',
    place: [
      ['nowPlaying', 0, 0, 6, 8],
      ['output', 6, 0, 6, 9],
      ['onAir', 0, 9, 4, 7],
      ['clock', 4, 9, 4, 6],
      ['crew', 8, 9, 4, 10],
    ],
  },
  {
    id: 'library',
    name: 'Library',
    hint: 'A wide pool for tagging and prepping between sets',
    place: [
      ['pool', 0, 0, 5, 30],
      ['queue', 5, 0, 3, 30],
      ['deckA', 8, 0, 4, 25],
      ['nowPlaying', 8, 25, 4, 7],
      ['deckB', 8, 32, 4, 25],
      ['crew', 0, 30, 5, 10],
      ['shortcuts', 5, 30, 3, 10],
    ],
  },
];
