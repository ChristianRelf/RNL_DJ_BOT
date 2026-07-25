import { useEffect, useRef, useState } from 'react';
import { meterBus, meterScale } from '../lib/meters';
import type { Meters } from '../protocol';

/** Multiplier applied while shift is held or the right button is dragging. */
const FINE = 0.2;
/** Pointer travel below which a right-drag is treated as a right-click. */
const CLICK_SLOP = 4;
/** How long a control keeps showing its own value after the gesture ends. */
const SETTLE_MS = 260;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const GESTURE_HINT =
  'drag or scroll to set  ·  shift or right-drag for fine  ·  right-click to reset';

interface GestureOptions {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  disabled?: boolean;
  /** Axis the pointer travels along to raise the value. */
  axis?: 'x' | 'y';
  /** Pixels of travel that cover the full range at normal speed. */
  travel?: number;
  /** The range is divided by this for one wheel notch or arrow key. */
  steps?: number;
  /**
   * When set, a primary-button drag jumps straight to the pointer position
   * instead of tracking relative travel — the right behaviour for a crossfader
   * you throw, the wrong one for a knob.
   */
  absolute?: (event: React.PointerEvent<HTMLDivElement>) => number;
  onChange: (value: number) => void;
}

/**
 * One gesture model for every continuous control on the console.
 *
 * Pointer, wheel and keyboard all land in the same place, and while any of them
 * is active the control shows its own value so it never stutters waiting on the
 * server echo. Right-click resets to the default; right-drag (or shift) slows
 * the control down for fine work.
 */
function useValueGesture({
  value,
  min,
  max,
  defaultValue,
  disabled,
  axis = 'y',
  travel = 160,
  steps = 40,
  absolute,
  onChange,
}: GestureOptions) {
  const [live, setLive] = useState(false);
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef(value);
  const emit = useRef(onChange);
  const settle = useRef<number | undefined>(undefined);
  const drag = useRef({
    active: false,
    absolute: false,
    anchor: 0,
    from: 0,
    last: 0,
    moved: 0,
    fine: false,
    button: 0,
  });

  emit.current = onChange;

  // Once the gesture settles, the authoritative server value takes back over.
  useEffect(() => {
    if (live) return;
    latest.current = value;
    setLocal(value);
  }, [value, live]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  const push = (next: number) => {
    const clamped = clamp(next, min, max);
    latest.current = clamped;
    setLocal(clamped);
    setLive(true);
    window.clearTimeout(settle.current);
    settle.current = undefined;
    emit.current(clamped);
  };

  /** Hand the control back to the server value once the input goes quiet. */
  const release = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setLive(false), SETTLE_MS);
  };

  const nudge = (count: number, fine: boolean) => {
    if (disabled) return;
    push(latest.current + (count * (max - min)) / (fine ? steps * 5 : steps));
    release();
  };

  const reset = () => {
    if (disabled) return;
    push(defaultValue);
    release();
  };

  // React registers wheel listeners at the root as passive, so preventDefault
  // only works from a listener we attach ourselves — without it the page
  // scrolls out from under the control being adjusted.
  const wheel = useRef(nudge);
  wheel.current = nudge;
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY || event.deltaX;
      if (delta) wheel.current(delta > 0 ? -1 : 1, event.shiftKey);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [disabled]);

  const coord = (event: React.PointerEvent<HTMLDivElement>) =>
    axis === 'y' ? event.clientY : event.clientX;

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state.active) return;
    state.active = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    // A right-press that never travelled is a reset, not a fine drag.
    if (state.button === 2 && state.moved < CLICK_SLOP) push(defaultValue);
    release();
  };

  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || (event.button !== 0 && event.button !== 2)) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const at = coord(event);
      const jump = Boolean(absolute) && event.button === 0;
      drag.current = {
        active: true,
        absolute: jump,
        anchor: at,
        from: latest.current,
        last: at,
        moved: 0,
        fine: event.shiftKey || event.button === 2,
        button: event.button,
      };
      window.clearTimeout(settle.current);
      setLive(true);
      if (jump && absolute) push(absolute(event));
    },

    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state.active || disabled) return;
      const at = coord(event);
      state.moved += Math.abs(at - state.last);
      state.last = at;

      if (state.absolute && absolute) {
        push(absolute(event));
        return;
      }

      // Shift and the right button both slow the control down. Re-anchor on the
      // switch so toggling mid-drag eases in rather than jumping the value.
      const fine = event.shiftKey || state.button === 2;
      if (fine !== state.fine) {
        state.fine = fine;
        state.anchor = at;
        state.from = latest.current;
      }
      const travelled = axis === 'y' ? state.anchor - at : at - state.anchor;
      push(state.from + (travelled / travel) * (max - min) * (fine ? FINE : 1));
    },

    onPointerUp: end,
    onPointerCancel: end,
    // The console owns the right button, so no browser menu on a control.
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  };

  const keys = (event: React.KeyboardEvent) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        nudge(1, event.shiftKey);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        nudge(-1, event.shiftKey);
        break;
      case 'PageUp':
        nudge(5, false);
        break;
      case 'PageDown':
        nudge(-5, false);
        break;
      case 'Home':
      case 'Backspace':
      case 'Delete':
        reset();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return { live, display: live ? local : value, ref, handlers, keys, nudge, reset };
}

/* -------------------------------------------------------------------- knob */

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  format: (value: number) => string;
  disabled?: boolean;
  accent?: 'default' | 'filter';
  size?: 'md' | 'sm';
  /** Renders the label as a kill switch when supplied. */
  killed?: boolean;
  onKill?: () => void;
  onChange: (value: number) => void;
}

export function Knob({
  label,
  value,
  min,
  max,
  defaultValue,
  format,
  disabled,
  accent = 'default',
  size = 'md',
  killed,
  onKill,
  onChange,
}: KnobProps) {
  const { live, display, ref, handlers, keys, reset } = useValueGesture({
    value,
    min,
    max,
    defaultValue,
    disabled,
    travel: 150,
    onChange,
  });

  const ratio = (display - min) / (max - min);
  // -135° to +135°, the usual travel of a hardware pot.
  const angle = -135 + ratio * 270;
  const centred = accent === 'filter' || (min < 0 && max > 0);
  const arcStart = centred ? 0.5 : (defaultValue - min) / (max - min);
  const sweepFrom = Math.min(arcStart, ratio);
  const sweepTo = Math.max(arcStart, ratio);
  // Anything off its default reads at a glance, which is the whole point of a
  // mixer you scan rather than study.
  const moved = Math.abs(display - defaultValue) > (max - min) * 0.01;

  return (
    <div
      className={[
        'knob',
        `knob-${size}`,
        disabled ? 'is-disabled' : '',
        live ? 'is-live' : '',
        moved ? 'is-moved' : '',
        killed ? 'is-killed' : '',
      ].join(' ')}
    >
      <div
        ref={ref}
        className="knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(display.toFixed(2))}
        aria-valuetext={format(display)}
        title={`${label}  ·  ${GESTURE_HINT}`}
        onDoubleClick={reset}
        onKeyDown={keys}
        {...handlers}
      >
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle className="knob-track" cx="24" cy="24" r="19" />
          <circle
            className={`knob-arc ${accent === 'filter' ? 'is-filter' : ''}`}
            cx="24"
            cy="24"
            r="19"
            style={{
              strokeDasharray: `${(sweepTo - sweepFrom) * 0.75 * 119.4} 999`,
              strokeDashoffset: -sweepFrom * 0.75 * 119.4,
            }}
          />
          <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '24px 24px' }}>
            <line className="knob-pointer" x1="24" y1="8" x2="24" y2="17" />
          </g>
        </svg>
      </div>

      {onKill ? (
        <button
          type="button"
          className="knob-label knob-kill"
          disabled={disabled}
          aria-pressed={killed}
          title={killed ? `Restore ${label}` : `Kill ${label}`}
          onClick={onKill}
        >
          {label}
        </button>
      ) : (
        <span className="knob-label">{label}</span>
      )}

      <span className="knob-value">{format(display)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- fader */

interface FaderProps {
  /** Caption printed under the fader. Omit for a bare channel fader. */
  label?: string;
  /** Accessible name, for faders whose caption is a strip header instead. */
  name?: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  disabled?: boolean;
  /** Marks the default position on the scale — used by the pitch fader. */
  detent?: boolean;
  onChange: (value: number) => void;
  className?: string;
}

export function Fader({
  label,
  name,
  value,
  min,
  max,
  defaultValue,
  disabled,
  detent,
  onChange,
  className,
}: FaderProps) {
  const { live, display, ref, handlers, keys, reset } = useValueGesture({
    value,
    min,
    max,
    defaultValue,
    disabled,
    travel: 190,
    onChange,
  });
  const ratio = (display - min) / (max - min);

  return (
    <div className={`fader ${className ?? ''} ${disabled ? 'is-disabled' : ''}`}>
      <div
        ref={ref}
        className={`fader-track ${live ? 'is-live' : ''}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={name ?? label ?? 'fader'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(display.toFixed(2))}
        title={`${name ?? label ?? 'Level'}  ·  ${GESTURE_HINT}`}
        onDoubleClick={reset}
        onKeyDown={keys}
        {...handlers}
      >
        <div className="fader-fill" style={{ height: `${ratio * 100}%` }} />
        <div className="fader-ticks" aria-hidden="true" />
        {detent ? (
          <div
            className="fader-detent"
            aria-hidden="true"
            style={{ bottom: `${((defaultValue - min) / (max - min)) * 100}%` }}
          />
        ) : null}
        {/* Centred on the value rather than offset by half its own height, so
            the cap keeps tracking if the styling ever changes its size. */}
        <div className="fader-cap" style={{ bottom: `${ratio * 100}%` }} />
      </div>
      {label ? <span className="fader-label">{label}</span> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- slider */

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  disabled?: boolean;
  centred?: boolean;
  compact?: boolean;
  onChange: (value: number) => void;
}

export function Slider({
  label,
  value,
  min,
  max,
  defaultValue,
  disabled,
  centred,
  compact,
  onChange,
}: SliderProps) {
  const { live, display, ref, handlers, keys, reset } = useValueGesture({
    value,
    min,
    max,
    defaultValue,
    disabled,
    axis: 'x',
    travel: 260,
    onChange,
    // A crossfader is thrown, not dialled: the primary button jumps to where
    // you clicked. Right-drag still gives relative fine control.
    absolute: (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return min + clamp((event.clientX - rect.left) / rect.width, 0, 1) * (max - min);
    },
  });

  const ratio = (display - min) / (max - min);

  return (
    <div className={`hslider ${compact ? 'is-compact' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <div
        ref={ref}
        className={`hslider-track ${live ? 'is-live' : ''}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(display.toFixed(2))}
        title={`${label}  ·  ${GESTURE_HINT}`}
        onDoubleClick={reset}
        onKeyDown={keys}
        {...handlers}
      >
        {centred ? <div className="hslider-centre" /> : null}
        <div className="hslider-cap" style={{ left: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ meter */

type MeterChannel = keyof Omit<Meters, 'clip'>;

/**
 * Level meter driven straight from the meter bus — it never re-renders, it
 * just writes transform styles, so 15 Hz updates cost nothing.
 */
export function Meter({
  channel,
  vertical = true,
  className,
}: {
  channel: MeterChannel;
  vertical?: boolean;
  className?: string;
}) {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      meterBus.subscribe((meters) => {
        const value = meters[channel];
        const axis = vertical ? 'scaleY' : 'scaleX';
        if (left.current) left.current.style.transform = `${axis}(${meterScale(value[0])})`;
        if (right.current) right.current.style.transform = `${axis}(${meterScale(value[1])})`;
        if (wrap.current) wrap.current.classList.toggle('is-clipping', meters.clip);
      }),
    [channel, vertical],
  );

  return (
    <div
      ref={wrap}
      className={`meter ${vertical ? 'is-vertical' : 'is-horizontal'} ${className ?? ''}`}
    >
      <div className="meter-lane">
        <div ref={left} className="meter-fill" />
      </div>
      <div className="meter-lane">
        <div ref={right} className="meter-fill" />
      </div>
    </div>
  );
}

/**
 * Numeric peak readout with a hold, for the booth meter bridge. Like Meter it
 * writes to the DOM directly rather than re-rendering at meter rate.
 */
export function PeakReadout({ channel }: { channel: MeterChannel }) {
  const node = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let hold = 0;
    let holdUntil = 0;
    return meterBus.subscribe((meters) => {
      const peak = Math.max(meters[channel][0], meters[channel][1]);
      const now = performance.now();
      if (peak >= hold || now > holdUntil) {
        hold = peak;
        holdUntil = now + 1200;
      }
      if (!node.current) return;
      node.current.textContent = hold <= 0.0005 ? '-∞' : (20 * Math.log10(hold)).toFixed(1);
      node.current.classList.toggle('is-hot', hold > 0.89);
    });
  }, [channel]);

  return <span ref={node} className="peak-readout mono" />;
}

/** Clip lamp for the booth bridge — holds for a beat so brief clips register. */
export function ClipLamp() {
  const node = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    // Cleared on a timer rather than on the next meter frame, so a clip in the
    // last moment before a disconnect can't leave the lamp stuck on.
    const unsubscribe = meterBus.subscribe((meters) => {
      if (!meters.clip) return;
      node.current?.classList.add('is-lit');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => node.current?.classList.remove('is-lit'), 900);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return (
    <span ref={node} className="clip-lamp" title="Master output clipped">
      CLIP
    </span>
  );
}
