import { useCallback, useEffect, useRef, useState } from 'react';
import { meterBus, meterScale } from '../lib/meters';
import type { Meters } from '../protocol';

interface DragOptions {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** Pixels of travel for the full range. */
  travel?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}

/**
 * Shared pointer-drag behaviour for knobs and faders. While dragging we hold a
 * local value so the control tracks the finger even if the server echo is a
 * frame behind; on release we hand back to the authoritative state.
 */
function useDragValue({ value, min, max, disabled, travel = 160, onChange, onCommit }: DragOptions) {
  const [dragging, setDragging] = useState(false);
  const [local, setLocal] = useState(value);
  const origin = useRef({ y: 0, value: 0 });

  useEffect(() => {
    if (!dragging) setLocal(value);
  }, [value, dragging]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      origin.current = { y: event.clientY, value: local };
      setDragging(true);
    },
    [disabled, local],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!dragging || disabled) return;
      const fine = event.shiftKey ? 0.25 : 1;
      const delta = ((origin.current.y - event.clientY) / travel) * (max - min) * fine;
      const next = Math.min(max, Math.max(min, origin.current.value + delta));
      setLocal(next);
      onChange(next);
    },
    [dragging, disabled, travel, max, min, onChange],
  );

  const end = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!dragging) return;
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      setDragging(false);
      onCommit?.(local);
    },
    [dragging, local, onCommit],
  );

  return {
    dragging,
    display: dragging ? local : value,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  format: (value: number) => string;
  disabled?: boolean;
  accent?: 'default' | 'filter';
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
  onChange,
}: KnobProps) {
  const { dragging, display, handlers } = useDragValue({
    value,
    min,
    max,
    disabled,
    travel: 140,
    onChange,
  });

  const ratio = (display - min) / (max - min);
  // -135° to +135°, the usual travel of a hardware pot.
  const angle = -135 + ratio * 270;
  const centred = accent === 'filter' || (min < 0 && max > 0);
  const arcStart = centred ? 0.5 : 0;
  const sweepFrom = Math.min(arcStart, ratio);
  const sweepTo = Math.max(arcStart, ratio);

  return (
    <div className={`knob ${disabled ? 'is-disabled' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <div
        className="knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(display.toFixed(2))}
        onDoubleClick={() => !disabled && onChange(defaultValue)}
        onKeyDown={(event) => {
          if (disabled) return;
          const step = (max - min) / (event.shiftKey ? 200 : 40);
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            onChange(Math.min(max, display + step));
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            onChange(Math.max(min, display - step));
          } else if (event.key === 'Home') onChange(defaultValue);
          else return;
          event.preventDefault();
        }}
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
            <line className="knob-pointer" x1="24" y1="9" x2="24" y2="17" />
          </g>
        </svg>
      </div>
      <span className="knob-label">{label}</span>
      <span className="knob-value">{format(display)}</span>
    </div>
  );
}

interface FaderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
}

export function Fader({ label, value, min, max, disabled, onChange, className }: FaderProps) {
  const { dragging, display, handlers } = useDragValue({
    value,
    min,
    max,
    disabled,
    travel: 190,
    onChange,
  });
  const ratio = (display - min) / (max - min);

  return (
    <div className={`fader ${className ?? ''} ${disabled ? 'is-disabled' : ''}`}>
      <div
        className={`fader-track ${dragging ? 'is-dragging' : ''}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label ?? 'fader'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(display.toFixed(2))}
        onKeyDown={(event) => {
          if (disabled) return;
          const step = (max - min) / 40;
          if (event.key === 'ArrowUp') onChange(Math.min(max, display + step));
          else if (event.key === 'ArrowDown') onChange(Math.max(min, display - step));
          else return;
          event.preventDefault();
        }}
        {...handlers}
      >
        <div className="fader-fill" style={{ height: `${ratio * 100}%` }} />
        <div className="fader-cap" style={{ bottom: `calc(${ratio * 100}% - 9px)` }} />
      </div>
      {label ? <span className="fader-label">{label}</span> : null}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  centred?: boolean;
  onChange: (value: number) => void;
}

export function Slider({ label, value, min, max, disabled, centred, onChange }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const apply = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onChange(min + ratio * (max - min));
    },
    [max, min, onChange],
  );

  const ratio = (value - min) / (max - min);

  return (
    <div className={`hslider ${disabled ? 'is-disabled' : ''}`}>
      <div
        ref={ref}
        className={`hslider-track ${dragging ? 'is-dragging' : ''}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(2))}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          apply(event.clientX);
        }}
        onPointerMove={(event) => dragging && apply(event.clientX)}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          setDragging(false);
        }}
        onDoubleClick={() => !disabled && centred && onChange((min + max) / 2)}
        onKeyDown={(event) => {
          if (disabled) return;
          const step = (max - min) / 40;
          if (event.key === 'ArrowLeft') onChange(Math.max(min, value - step));
          else if (event.key === 'ArrowRight') onChange(Math.min(max, value + step));
          else return;
          event.preventDefault();
        }}
      >
        {centred ? <div className="hslider-centre" /> : null}
        <div className="hslider-cap" style={{ left: `calc(${ratio * 100}% - 14px)` }} />
      </div>
    </div>
  );
}

type MeterChannel = keyof Omit<Meters, 'clip'>;

/**
 * Level meter driven straight from the meter bus — it never re-renders, it
 * just writes transform styles, so 15 Hz updates cost nothing.
 */
export function Meter({ channel, vertical = true }: { channel: MeterChannel; vertical?: boolean }) {
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
    <div ref={wrap} className={`meter ${vertical ? 'is-vertical' : 'is-horizontal'}`}>
      <div className="meter-lane">
        <div ref={left} className="meter-fill" />
      </div>
      <div className="meter-lane">
        <div ref={right} className="meter-fill" />
      </div>
    </div>
  );
}
