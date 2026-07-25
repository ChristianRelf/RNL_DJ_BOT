import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Rows3,
  X,
} from 'lucide-react';
import {
  DRAG_MIME,
  GRID_COLUMNS,
  PRESETS,
  WIDGET_GROUPS,
  setDragPayload,
  spec,
  type Layout,
  type Placed,
  type Preset,
  type Rect,
  type WidgetId,
} from '../lib/layout';

/**
 * Edit chrome for the console.
 *
 * Everything here can also be done by dragging — that is the fast way once you
 * know it is there — but a drag is invisible, awkward on a trackpad and
 * impossible from a keyboard, so every move and every resize is also a control
 * you can see and tab to.
 */

interface ChromeProps {
  item: Placed;
  /** True when the panel is taller than the tile it has been given. */
  overflowing: boolean;
  onGrab: (event: React.PointerEvent) => void;
  onNudge: (patch: Partial<Rect>) => void;
  onFit: () => void;
  onHide: () => void;
}

export function WidgetChrome({ item, overflowing, onGrab, onNudge, onFit, onHide }: ChromeProps) {
  const widget = spec(item.id);

  return (
    <div className="wchrome">
      <span
        className="wchrome-grip"
        onPointerDown={onGrab}
        role="button"
        tabIndex={-1}
        title={`Drag to move ${widget.name}`}
      >
        <GripVertical size={13} />
      </span>

      <span className="wchrome-name">{widget.name}</span>

      <span className="wchrome-group" role="group" aria-label={`Move ${widget.name}`}>
        <button
          type="button"
          className="wchrome-btn"
          disabled={item.x <= 0}
          title="Move left"
          aria-label={`Move ${widget.name} left`}
          onClick={() => onNudge({ x: item.x - 1 })}
        >
          <ChevronLeft size={12} />
        </button>
        <button
          type="button"
          className="wchrome-btn"
          disabled={item.x + item.w >= GRID_COLUMNS}
          title="Move right"
          aria-label={`Move ${widget.name} right`}
          onClick={() => onNudge({ x: item.x + 1 })}
        >
          <ChevronRight size={12} />
        </button>
        <button
          type="button"
          className="wchrome-btn"
          disabled={item.y <= 0}
          title="Move up"
          aria-label={`Move ${widget.name} up`}
          onClick={() => onNudge({ y: item.y - 1 })}
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          className="wchrome-btn"
          title="Move down"
          aria-label={`Move ${widget.name} down`}
          onClick={() => onNudge({ y: item.y + 1 })}
        >
          <ChevronDown size={12} />
        </button>
      </span>

      <span className="wchrome-group" role="group" aria-label={`Width of ${widget.name}`}>
        <button
          type="button"
          className="wchrome-btn"
          disabled={item.w <= widget.minW}
          title="Narrower"
          aria-label={`Make ${widget.name} narrower`}
          onClick={() => onNudge({ w: item.w - 1 })}
        >
          <Minus size={12} />
        </button>
        <span className="wchrome-span mono" title={`${item.w} of ${GRID_COLUMNS} columns`}>
          {item.w}
        </span>
        <button
          type="button"
          className="wchrome-btn"
          disabled={item.w >= GRID_COLUMNS}
          title="Wider"
          aria-label={`Make ${widget.name} wider`}
          onClick={() => onNudge({ w: item.w + 1 })}
        >
          <Plus size={12} />
        </button>
      </span>

      <span className="wchrome-group" role="group" aria-label={`Height of ${widget.name}`}>
        <button
          type="button"
          className="wchrome-btn"
          disabled={item.h <= widget.minH}
          title="Shorter"
          aria-label={`Make ${widget.name} shorter`}
          onClick={() => onNudge({ h: item.h - 2 })}
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          className="wchrome-btn"
          title="Taller"
          aria-label={`Make ${widget.name} taller`}
          onClick={() => onNudge({ h: item.h + 2 })}
        >
          <ChevronDown size={12} />
        </button>
      </span>

      <button
        type="button"
        className={`wchrome-btn ${overflowing ? 'is-urgent' : ''}`}
        title={
          overflowing
            ? 'This panel is taller than its tile — fit the tile to it'
            : 'Fit the tile to the panel'
        }
        aria-label={`Fit ${widget.name} to its contents`}
        onClick={onFit}
      >
        <Maximize2 size={12} />
      </button>

      <button
        type="button"
        className="wchrome-btn wchrome-hide"
        title="Take off the console"
        aria-label={`Remove ${widget.name}`}
        onClick={onHide}
      >
        <X size={12} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- palette */

interface PaletteProps {
  layout: Layout;
  onAdd: (id: WidgetId) => void;
  onPreset: (preset: Preset) => void;
  onCompact: () => void;
  onReset: () => void;
  onDone: () => void;
}

/** Presets, plus the tray of tools not currently on the console. */
export function LayoutPalette({
  layout,
  onAdd,
  onPreset,
  onCompact,
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
            Drag a tool by its handle to move it, or drag its right or bottom edge to size it.
            Everything snaps to a {GRID_COLUMNS}-column grid and nothing can sit on top of anything
            else — whatever you drop onto gets pushed down. Drag a tool out of the tray below to
            put it wherever you like.
          </p>
        </div>
        <div className="palette-actions">
          <button type="button" className="btn tiny" onClick={onCompact} title="Pull everything up into the gaps">
            <Rows3 size={12} />
            TIDY
          </button>
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
              <PresetShape preset={preset} />
              <strong>{preset.name}</strong>
              <em>{preset.hint}</em>
            </button>
          ))}
        </div>
      </div>

      {hidden.length > 0 ? (
        <div className="palette-tray">
          <span className="tool-label">Not on the console — drag one in, or click to add</span>
          {WIDGET_GROUPS.map((group) => {
            const inGroup = hidden.filter((placed) => spec(placed.id).group === group.id);
            if (inGroup.length === 0) return null;
            return (
              <div className="palette-group" key={group.id}>
                <span className="tool-label-sm">{group.name}</span>
                <div className="palette-chips">
                  {inGroup.map((placed) => {
                    const widget = spec(placed.id);
                    return (
                      <button
                        type="button"
                        className="palette-chip"
                        key={placed.id}
                        title={widget.hint}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'copy';
                          event.dataTransfer.setData(DRAG_MIME, placed.id);
                          // Firefox will not start a drag without a plain-text
                          // payload on the transfer.
                          event.dataTransfer.setData('text/plain', widget.name);
                          setDragPayload(placed.id);
                        }}
                        onDragEnd={() => setDragPayload(null)}
                        onClick={() => onAdd(placed.id)}
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
            );
          })}
        </div>
      ) : (
        <p className="palette-empty">Every tool is on the console.</p>
      )}
    </div>
  );
}

/** A thumbnail of the arrangement: one block per tool, placed as it will be. */
function PresetShape({ preset }: { preset: Preset }) {
  const rows = preset.place.reduce((max, [, , y, , h]) => Math.max(max, y + h), 1);
  return (
    <span className="palette-preset-shape" aria-hidden="true">
      {preset.place.map(([id, x, y, w, h]) => (
        <span
          key={id}
          style={{
            left: `${(x / GRID_COLUMNS) * 100}%`,
            width: `${(w / GRID_COLUMNS) * 100}%`,
            top: `${(y / rows) * 100}%`,
            height: `${(h / rows) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}
