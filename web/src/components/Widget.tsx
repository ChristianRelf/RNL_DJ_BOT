import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * One widget slot on the console grid.
 *
 * CSS Grid has no masonry mode: every item in a row shares that row's height,
 * so a short widget beside a tall one leaves dead space beneath it until the
 * next row starts. The way around it is to make the rows tiny — one pixel each,
 * with no row gap — and give every widget a row span measured from its own
 * content. Combined with `dense` auto-flow on the container, shorter widgets
 * backfill under their neighbours instead of waiting for the tallest one.
 *
 * The gutter is carried as padding on the inner element rather than as a row
 * gap, so a span works out to exactly the content height in pixels.
 */

/** Vertical space between stacked widgets, in pixels. */
export const WIDGET_GUTTER = 8;

interface WidgetProps {
  /** Requested width in grid columns. */
  span: number;
  /** Columns actually available, so a wide widget never overflows a narrow grid. */
  columns: number;
  /** Drop targets for reordering; the whole tile accepts, not just its chrome. */
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export function Widget({ span, columns, onDragOver, onDrop, children }: WidgetProps) {
  const [rows, setRows] = useState(1);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;

    // Rounded up, so a fractional height never clips the last pixel of a panel.
    const measure = () => setRows(Math.max(1, Math.ceil(el.getBoundingClientRect().height)));
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    // Safe from a feedback loop: the span changes the grid track, never the
    // natural height of the content being measured.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="widget"
      style={{ gridColumn: `span ${Math.min(span, columns)}`, gridRow: `span ${rows}` }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="widget-inner" ref={inner}>
        {children}
      </div>
    </div>
  );
}
