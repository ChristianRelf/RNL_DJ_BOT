import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { WidgetChrome } from './LayoutEditor';
import {
  GRID_COLUMNS,
  GRID_GAP,
  ROW_PX,
  DRAG_MIME,
  dragPayload,
  isWidgetId,
  layoutHeight,
  place,
  rowsForPx,
  spec,
  type Layout,
  type Placed,
  type Rect,
  type WidgetId,
} from '../lib/layout';

/**
 * The console grid.
 *
 * Twelve columns of equal width and a row of a fixed height: everything snaps
 * to that lattice, which is what makes a hand-arranged console line up rather
 * than nearly line up. Tiles carry an explicit cell, so two of them can never
 * occupy the same space - a drag that would overlap pushes the tile underneath
 * down instead, and the preview shows exactly where everything lands before the
 * pointer is released.
 *
 * A tile is a window onto its tool, not a crop of it: the body scrolls when the
 * tile is shorter than its panel, says so, and "fit" measures the panel and
 * sizes the tile to it exactly - so nothing is ever cut off with no way to
 * reach it.
 */

interface DragState {
  kind: 'move' | 'resize';
  id: WidgetId;
  /** Where the tile was when the gesture started. */
  from: Rect;
  /** Pointer position at the start, relative to the grid. */
  originX: number;
  originY: number;
  pointerId: number;
  /** True once the pointer has travelled far enough to be a drag, not a click. */
  live: boolean;
}

/** Pointer travel, in pixels, before a press on a tile counts as a drag. */
const DRAG_SLOP = 4;
/** Rows of empty grid kept below the lowest tile, as somewhere to drop things. */
const TRAILING_ROWS = 8;

export interface ConsoleGridProps {
  layout: Layout;
  arranging: boolean;
  /** True on a narrow screen, where the console stacks instead of gridding. */
  stacked: boolean;
  render: (id: WidgetId) => ReactNode;
  onChange: (layout: Layout) => void;
  onHide: (id: WidgetId) => void;
  /** Tools waiting to be sized to their own content, once it has been measured. */
  fitting: ReadonlySet<WidgetId>;
  /**
   * Sets one tile's height. Separate from `onChange` because several tiles can
   * report their measurements in the same tick, and each needs to build on the
   * last rather than on the layout they all started from.
   */
  onFitHeight: (id: WidgetId, rows: number) => void;
}

export function ConsoleGrid({
  layout,
  arranging,
  stacked,
  render,
  onChange,
  onHide,
  fitting,
  onFitHeight,
}: ConsoleGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<Layout | null>(null);
  /**
   * The same preview, for the drop to commit from. Pointer moves are not
   * discrete events, so React is free to leave the last one uncommitted when
   * the button comes up in the same frame - and dropping a tile a cell away
   * from where it was last shown would be its own kind of wrong.
   */
  const previewRef = useRef<Layout | null>(null);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [dropAt, setDropAt] = useState<Rect | null>(null);
  const [columnPx, setColumnPx] = useState(0);
  /** Natural content height of each tool, in pixels, as last measured. */
  const heights = useRef(new Map<WidgetId, number>());

  const active = preview ?? layout;
  const visible = useMemo(() => active.filter((item) => !item.hidden), [active]);

  // Column width is measured rather than assumed: the console sits inside a
  // page whose padding changes with the viewport.
  useEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    const measure = () => {
      const width = node.getBoundingClientRect().width;
      setColumnPx((width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stacked]);

  /** Grid-relative pixels to fractional cells. */
  const cellOf = useCallback(
    (px: number, py: number) => ({
      col: columnPx > 0 ? px / (columnPx + GRID_GAP) : 0,
      row: py / (ROW_PX + GRID_GAP),
    }),
    [columnPx],
  );

  /* ------------------------------------------------------------ gestures */

  const beginDrag = useCallback(
    (event: React.PointerEvent, id: WidgetId, kind: DragState['kind']) => {
      if (!arranging || stacked || event.button !== 0) return;
      const item = layout.find((entry) => entry.id === id);
      const rect = gridRef.current?.getBoundingClientRect();
      if (!item || !rect) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      drag.current = {
        kind,
        id,
        from: { x: item.x, y: item.y, w: item.w, h: item.h },
        originX: event.clientX - rect.left,
        originY: event.clientY - rect.top,
        pointerId: event.pointerId,
        live: false,
      };
    },
    [arranging, layout, stacked],
  );

  const moveDrag = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!state || !rect || event.pointerId !== state.pointerId) return;

      const dx = event.clientX - rect.left - state.originX;
      const dy = event.clientY - rect.top - state.originY;
      if (!state.live) {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        state.live = true;
        setDragging(state.id);
      }

      const { col, row } = cellOf(dx, dy);
      const next: Rect =
        state.kind === 'move'
          ? {
              x: state.from.x + Math.round(col),
              y: Math.max(0, state.from.y + Math.round(row)),
              w: state.from.w,
              h: state.from.h,
            }
          : {
              x: state.from.x,
              y: state.from.y,
              w: state.from.w + Math.round(col),
              h: state.from.h + Math.round(row),
            };

      previewRef.current = place(layout, state.id, next);
      setPreview(previewRef.current);
    },
    [cellOf, layout],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      // Capture releases itself when the pointer goes up; releasing it here
      // would have to find the element that took it, which is not this one.
      drag.current = null;
      const landed = previewRef.current;
      previewRef.current = null;
      setDragging(null);
      setPreview(null);
      if (state.live && landed) onChange(landed);
    },
    [onChange],
  );

  // Escape abandons a drag rather than committing it, like every other drag on
  // the platform.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      drag.current = null;
      previewRef.current = null;
      setDragging(null);
      setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragging]);

  // A tray drag that ends anywhere but on the grid still has to take its
  // landing rectangle with it.
  useEffect(() => {
    if (!dropAt) return;
    const clear = () => setDropAt(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, [dropAt]);

  /* ----------------------------------------------- dropping in from the tray */

  /** Where a tool dragged out of the palette would land, given a pointer. */
  const dropRect = useCallback(
    (id: WidgetId, clientX: number, clientY: number): Rect | null => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const widget = spec(id);
      const { col, row } = cellOf(clientX - rect.left, clientY - rect.top);
      // Dropped under the cursor rather than starting at it, so the tool lands
      // where it looked like it was going to.
      return {
        x: Math.round(col - widget.w / 2),
        y: Math.max(0, Math.round(row - 1)),
        w: widget.w,
        h: widget.h,
      };
    },
    [cellOf],
  );

  const onDragOver = (event: React.DragEvent) => {
    if (!arranging || stacked) return;
    const id = event.dataTransfer.types.includes(DRAG_MIME) ? dragPayload() : null;
    if (!id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const rect = dropRect(id, event.clientX, event.clientY);
    if (rect) setDropAt(rect);
  };

  const onDrop = (event: React.DragEvent) => {
    if (!arranging || stacked) return;
    const id = event.dataTransfer.getData(DRAG_MIME) || dragPayload();
    setDropAt(null);
    if (!isWidgetId(id)) return;
    event.preventDefault();
    const rect = dropRect(id, event.clientX, event.clientY);
    if (!rect) return;
    // `place` unhides whatever it is given, so a tool from the tray arrives on
    // the console at the cell it was dropped on.
    onChange(place(layout, id, rect));
  };

  /* --------------------------------------------------------------- edits */

  const update = useCallback(
    (id: WidgetId, patch: Partial<Rect>) => {
      const item = layout.find((entry) => entry.id === id);
      if (!item) return;
      onChange(place(layout, id, { x: item.x, y: item.y, w: item.w, h: item.h, ...patch }));
    },
    [layout, onChange],
  );

  /** Sizes a tile to the exact height of the panel inside it. */
  const fit = useCallback(
    (id: WidgetId) => {
      const px = heights.current.get(id);
      if (px) onFitHeight(id, rowsForPx(px));
    },
    [onFitHeight],
  );

  const measured = useCallback(
    (id: WidgetId, px: number) => {
      heights.current.set(id, px);
      if (fitting.has(id)) onFitHeight(id, rowsForPx(px));
    },
    [fitting, onFitHeight],
  );

  /* ------------------------------------------------------------- guides */

  // While a tile is being dragged, every edge it shares with another tile draws
  // a line. Everything snaps to the lattice anyway; this is the confirmation
  // that what looks aligned really is.
  const guides = useMemo(() => {
    if (!dragging || !preview) return { x: [] as number[], y: [] as number[] };
    const moving = preview.find((item) => item.id === dragging);
    if (!moving) return { x: [] as number[], y: [] as number[] };
    const x = new Set<number>();
    const y = new Set<number>();
    for (const other of preview) {
      if (other.hidden || other.id === dragging) continue;
      for (const edge of [moving.x, moving.x + moving.w]) {
        if (edge === other.x || edge === other.x + other.w) x.add(edge);
      }
      for (const edge of [moving.y, moving.y + moving.h]) {
        if (edge === other.y || edge === other.y + other.h) y.add(edge);
      }
    }
    return { x: [...x], y: [...y] };
  }, [dragging, preview]);

  /* -------------------------------------------------------------- render */

  if (stacked) {
    // Below the grid's minimum width there is no honest way to hold a
    // twelve-column arrangement, so the console stacks in reading order and
    // every tool sizes to its own content.
    const order = [...visible].sort((a, b) => a.y - b.y || a.x - b.x);
    return (
      <main className="console is-stacked">
        {order.map((item) => (
          <div className="tile" key={item.id}>
            <div className="tile-body">{render(item.id)}</div>
          </div>
        ))}
      </main>
    );
  }

  const rows = layoutHeight(active) + (arranging ? TRAILING_ROWS : 0);

  return (
    <main
      className={`console ${arranging ? 'is-arranging' : ''} ${dragging ? 'is-dragging' : ''}`}
      ref={gridRef}
      style={{
        ['--cols' as string]: GRID_COLUMNS,
        ['--row-px' as string]: `${ROW_PX}px`,
        ['--gap' as string]: `${GRID_GAP}px`,
        ['--rows' as string]: Math.max(rows, 1),
      }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDragOver={onDragOver}
      onDragLeave={() => setDropAt(null)}
      onDrop={onDrop}
    >
      {arranging && dropAt ? (
        <span
          className="grid-drop"
          aria-hidden="true"
          style={{
            gridColumn: `${Math.max(0, Math.min(GRID_COLUMNS - dropAt.w, dropAt.x)) + 1} / span ${dropAt.w}`,
            gridRow: `${dropAt.y + 1} / span ${dropAt.h}`,
          }}
        />
      ) : null}

      {arranging
        ? [
            ...guides.x.map((at) => (
              <span
                className="grid-guide is-vertical"
                key={`x${at}`}
                aria-hidden="true"
                style={{ left: `calc(${at} * (100% + var(--gap)) / var(--cols))` }}
              />
            )),
            ...guides.y.map((at) => (
              <span
                className="grid-guide is-horizontal"
                key={`y${at}`}
                aria-hidden="true"
                style={{ top: `${at * (ROW_PX + GRID_GAP)}px` }}
              />
            )),
          ]
        : null}

      {visible.map((item) => (
        <Tile
          key={item.id}
          item={item}
          arranging={arranging}
          dragging={dragging === item.id}
          onMeasure={measured}
          onGrab={(event) => beginDrag(event, item.id, 'move')}
          onResizeStart={(event) => beginDrag(event, item.id, 'resize')}
          onNudge={(patch) => update(item.id, patch)}
          onFit={() => fit(item.id)}
          onHide={() => onHide(item.id)}
        >
          {render(item.id)}
        </Tile>
      ))}
    </main>
  );
}

/* ---------------------------------------------------------------- tile */

interface TileProps {
  item: Placed;
  arranging: boolean;
  dragging: boolean;
  children: ReactNode;
  onMeasure: (id: WidgetId, px: number) => void;
  onGrab: (event: React.PointerEvent) => void;
  onResizeStart: (event: React.PointerEvent) => void;
  onNudge: (patch: Partial<Rect>) => void;
  onFit: () => void;
  onHide: () => void;
}

function Tile({
  item,
  arranging,
  dragging,
  children,
  onMeasure,
  onGrab,
  onResizeStart,
  onNudge,
  onFit,
  onHide,
}: TileProps) {
  const body = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const widget = spec(item.id);

  // The panel's natural height drives both the overflow hint and "fit". It is
  // measured rather than declared, because a media pool with forty tracks in it
  // is a different height from an empty one.
  useLayoutEffect(() => {
    const panel = body.current?.firstElementChild as HTMLElement | null;
    if (!panel) return;
    const measure = () => {
      const px = panel.scrollHeight;
      onMeasure(item.id, px);
      setOverflowing(px - (body.current?.clientHeight ?? 0) > 2);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [item.id, item.h, item.w, onMeasure]);

  return (
    <div
      className={`tile ${dragging ? 'is-dragging' : ''} ${overflowing ? 'is-clipped' : ''}`}
      style={{
        gridColumn: `${item.x + 1} / span ${item.w}`,
        gridRow: `${item.y + 1} / span ${item.h}`,
      }}
      data-widget={item.id}
    >
      {arranging ? (
        <WidgetChrome
          item={item}
          overflowing={overflowing}
          onGrab={onGrab}
          onNudge={onNudge}
          onFit={onFit}
          onHide={onHide}
        />
      ) : null}

      <div className="tile-body" ref={body}>
        {children}
      </div>

      {arranging ? (
        <>
          <span
            className="tile-resize is-right"
            onPointerDown={onResizeStart}
            title={`Drag to resize ${widget.name}`}
          />
          <span
            className="tile-resize is-bottom"
            onPointerDown={onResizeStart}
            title={`Drag to resize ${widget.name}`}
          />
          <span
            className="tile-resize is-corner"
            onPointerDown={onResizeStart}
            title={`Drag to resize ${widget.name}`}
          />
        </>
      ) : null}
    </div>
  );
}
