import { useCallback, useEffect, useRef } from 'react';
import type { DeckLoop } from '../protocol';

interface WaveformProps {
  peaks: number[];
  durationMs: number;
  positionMs: number;
  cueMs: number;
  loop: DeckLoop;
  accent: string;
  disabled?: boolean;
  onSeek: (ms: number) => void;
}

/**
 * Overview waveform. Rendered on a canvas rather than SVG because the playhead
 * moves ten times a second and the envelope is ~1200 bars wide.
 */
export function Waveform({
  peaks,
  durationMs,
  positionMs,
  cueMs,
  loop,
  accent,
  disabled,
  onSeek,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

    if (loop.active && durationMs > 0) {
      const from = (loop.startMs / durationMs) * width;
      const to = (loop.endMs / durationMs) * width;
      ctx.fillStyle = 'rgba(250, 204, 21, 0.14)';
      ctx.fillRect(from, 0, Math.max(1, to - from), height);
    }

    if (peaks.length === 0) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();
    } else {
      const bars = Math.max(1, Math.floor(width / 2));
      const barWidth = width / bars;
      for (let i = 0; i < bars; i++) {
        const from = Math.floor((i / bars) * peaks.length);
        const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * peaks.length));
        let peak = 0;
        for (let j = from; j < to && j < peaks.length; j++) {
          if (peaks[j] > peak) peak = peaks[j];
        }
        // Slight compression so quiet passages stay visible.
        const amplitude = Math.pow(peak, 0.7) * (mid - 2);
        const x = i * barWidth;
        ctx.fillStyle = x / width <= progress ? accent : 'rgba(148, 163, 184, 0.45)';
        ctx.fillRect(x, mid - amplitude, Math.max(1, barWidth - 0.5), amplitude * 2 || 1);
      }
    }

    if (durationMs > 0 && cueMs > 0) {
      const x = (cueMs / durationMs) * width;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    const px = progress * width;
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }, [accent, cueMs, durationMs, loop.active, loop.endMs, loop.startMs, peaks, positionMs]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const seekFrom = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas || durationMs <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeek(ratio * durationMs);
    },
    [durationMs, onSeek],
  );

  return (
    <canvas
      ref={canvasRef}
      className={`waveform ${disabled ? 'is-disabled' : ''}`}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        seekFrom(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seekFrom(event.clientX);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    />
  );
}
