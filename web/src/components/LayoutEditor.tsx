import { ChevronLeft, ChevronRight, GripVertical, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { GRID_COLUMNS, PRESETS, spec, type Layout, type Preset, type WidgetId } from '../lib/layout';

/**
 * Edit chrome for the console layout.
 *
 * Reordering works by drag *and* by button. Drag is faster once you know it is
 * there, but it is invisible, awkward on a trackpad, and impossible from a
 * keyboard — so every move is also a control you can see and tab to.
 */

interface ChromeProps {
  index: number;
  id: WidgetId;
  span: number;
  /** Columns actually available, so the editor never offers a width that is a lie. */
  columns: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: number) => void;
  onResize: (span: number) => void;
  onHide: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

export function WidgetChrome({
  id,
  span,
  columns,
  isFirst,
  isLast,
  onMove,
  onResize,
  onHide,
  onDragStart,
  onDragEnd,
}: ChromeProps) {
  const widget = spec(id);
  const effective = Math.min(span, columns);

  return (
    <div className="wchrome">
      <span
        className="wchrome-grip"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          // Firefox will not start a drag without payload on the transfer.
          event.dataTransfer.setData('text/plain', id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
      >
        <GripVertical size={13} />
      </span>

      <span className="wchrome-name">{widget.name}</span>

      <span className="wchrome-group">
        <button
          type="button"
          className="wchrome-btn"
          disabled={isFirst}
          title="Move earlier"
          aria-label={`Move ${widget.name} earlier`}
          onClick={() => onMove(-1)}
        >
          <ChevronLeft size={12} />
        </button>
        <button
          type="button"
          className="wchrome-btn"
          disabled={isLast}
          title="Move later"
          aria-label={`Move ${widget.name} later`}
          onClick={() => onMove(1)}
        >
          <ChevronRight size={12} />
        </button>
      </span>

      <span className="wchrome-group">
        <button
          type="button"
          className="wchrome-btn"
          disabled={span <= widget.min}
          title="Narrower"
          aria-label={`Make ${widget.name} narrower`}
          onClick={() => onResize(span - 1)}
        >
          <Minus size={12} />
        </button>
        <span className="wchrome-span mono" title={`${effective} of ${columns} columns`}>
          {effective}
        </span>
        <button
          type="button"
          className="wchrome-btn"
          disabled={span >= GRID_COLUMNS}
          title="Wider"
          aria-label={`Make ${widget.name} wider`}
          onClick={() => onResize(span + 1)}
        >
          <Plus size={12} />
        </button>
      </span>

      <button
        type="button"
        className="wchrome-btn wchrome-hide"
        title="Remove from the console"
        aria-label={`Remove ${widget.name}`}
        onClick={onHide}
      >
        <X size={12} />
      </button>
    </div>
  );
}

interface PaletteProps {
  layout: Layout;
  columns: number;
  onShow: (id: WidgetId) => void;
  onPreset: (preset: Preset) => void;
  onReset: () => void;
  onDone: () => void;
}

/** Presets, plus the tray of widgets not currently on the console. */
export function LayoutPalette({
  layout,
  columns,
  onShow,
  onPreset,
  onReset,
  onDone,
}: PaletteProps) {
  const hidden = layout.filter((placed) => placed.hidden);

  return (
    <div className="palette">
      <div className="palette-head">
        <div>
          <h2>Arranging the console</h2>
          <p>
            Drag a widget by its handle to move it, or use the arrows. The grid is{' '}
            {GRID_COLUMNS} columns wide and currently fitting {columns} — widths clamp to that, so
            nothing ends up a sliver.
          </p>
        </div>
        <div className="palette-actions">
          <button type="button" className="btn tiny" onClick={onReset}>
            <RotateCcw size={12} />
            RESET
          </button>
          <button type="button" className="btn tiny primary" onClick={onDone}>
            DONE
          </button>
        </div>
      </div>

      <div className="palette-tray">
        <span className="tool-label">Start from a preset</span>
        <div className="palette-presets">
          {PRESETS.map((preset) => (
            <button
              type="button"
              className="palette-preset"
              key={preset.id}
              title={preset.hint}
              onClick={() => onPreset(preset)}
            >
              <span className="palette-preset-shape" aria-hidden="true">
                {preset.place.map(([id, span]) => (
                  <span
                    key={id}
                    // The gap has to come out of the basis, or a row that fills
                    // the grid exactly wraps its last bar onto a second line.
                    style={{ flexBasis: `calc(${(span / GRID_COLUMNS) * 100}% - 2px)` }}
                  />
                ))}
              </span>
              <strong>{preset.name}</strong>
              <em>{preset.hint}</em>
            </button>
          ))}
        </div>
      </div>

      {hidden.length > 0 ? (
        <div className="palette-tray">
          <span className="tool-label">Not on the console</span>
          <div className="palette-chips">
            {hidden.map((placed) => {
              const widget = spec(placed.id);
              return (
                <button
                  type="button"
                  className="palette-chip"
                  key={placed.id}
                  title={widget.hint}
                  onClick={() => onShow(placed.id)}
                >
                  <Plus size={12} />
                  <span>
                    <strong>{widget.name}</strong>
                    <em>{widget.hint}</em>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="palette-empty">Every widget is on the console.</p>
      )}
    </div>
  );
}
