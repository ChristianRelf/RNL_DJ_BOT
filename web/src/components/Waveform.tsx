import { useCallback, useEffect, useRef } from 'react';
import type { BeatGrid, DeckLoop, HotCue } from '../protocol';

interface WaveformProps {
  peaks: number[];
  durationMs: number;
  positionMs: number;
  cueMs: number;
  loop: DeckLoop;
  beatGrid?: BeatGrid | null;
  hotCues?: (HotCue | null)[];
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
  beatGrid,
  hotCues = [],
  accent,
  disabled,
  onSeek,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<HTMLCanvasElement>(null);
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
      ctx.fillStyle = 'rgba(255, 156, 43, 0.12)';
      ctx.fillRect(from, 0, Math.max(1, to - from), height);
    }

    if (peaks.length === 0) {
      ctx.strokeStyle = 'rgba(133, 140, 147, 0.35)';
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
        ctx.fillStyle = x / width <= progress ? accent : 'rgba(120, 128, 136, 0.55)';
        ctx.fillRect(x, mid - amplitude, Math.max(1, barWidth - 0.5), amplitude * 2 || 1);
      }
    }

    if (durationMs > 0 && cueMs > 0) {
      const x = (cueMs / durationMs) * width;
      ctx.strokeStyle = '#ff9c2b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    if (durationMs > 0) {
      hotCues.forEach((cue, index) => {
        if (!cue) return;
        const x = (cue.ms / durationMs) * width;
        ctx.strokeStyle = '#f4d35e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillStyle = '#f4d35e';
        ctx.font = '10px monospace';
        ctx.fillText(String(index + 1), x + 3, 11);
      });
    }

    const px = progress * width;
    ctx.strokeStyle = '#dfe3e6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    const zoom = zoomRef.current;
    if (!zoom) return;
    const zctx = zoom.getContext('2d');
    if (!zctx) return;
    const zw = zoom.clientWidth;
    const zh = zoom.clientHeight;
    if (!zw || !zh) return;
    if (zoom.width !== Math.round(zw * dpr) || zoom.height !== Math.round(zh * dpr)) {
      zoom.width = Math.round(zw * dpr);
      zoom.height = Math.round(zh * dpr);
    }
    zctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    zctx.clearRect(0, 0, zw, zh);
    const spanMs = 16_000;
    const start = positionMs - spanMs * 0.4;
    const end = start + spanMs;
    const xFor = (ms: number) => ((ms - start) / spanMs) * zw;
    const midZ = zh / 2;
    const bars = Math.max(1, Math.floor(zw / 2));
    for (let i = 0; i < bars; i++) {
      const ms = start + (i / bars) * spanMs;
      const bucket = Math.floor((ms / durationMs) * peaks.length);
      const peak = bucket >= 0 && bucket < peaks.length ? peaks[bucket] : 0;
      const amplitude = Math.pow(peak, 0.7) * (midZ - 2);
      zctx.fillStyle = ms <= positionMs ? accent : 'rgba(120, 128, 136, 0.65)';
      zctx.fillRect((i / bars) * zw, midZ - amplitude, Math.max(1, zw / bars - 0.5), amplitude * 2 || 1);
    }
    if (beatGrid) {
      const beat = 60_000 / beatGrid.bpm;
      const first = Math.ceil((start - beatGrid.beatOffsetMs) / beat);
      for (let n = first; beatGrid.beatOffsetMs + n * beat < end; n++) {
        const ms = beatGrid.beatOffsetMs + n * beat;
        const bar = (((n + beatGrid.downbeat) % beatGrid.beatsPerBar) + beatGrid.beatsPerBar) % beatGrid.beatsPerBar === 0;
        zctx.strokeStyle = bar ? 'rgba(255, 156, 43, 0.62)' : 'rgba(210, 216, 221, 0.22)';
        zctx.lineWidth = bar ? 2 : 1;
        zctx.beginPath();
        zctx.moveTo(xFor(ms), 0);
        zctx.lineTo(xFor(ms), zh);
        zctx.stroke();
      }
    }
    hotCues.forEach((cue, index) => {
      if (!cue || cue.ms < start || cue.ms > end) return;
      const x = xFor(cue.ms);
      zctx.fillStyle = '#f4d35e';
      zctx.fillRect(x, 0, 2, zh);
      zctx.font = '10px monospace';
      zctx.fillText(String(index + 1), x + 4, 11);
    });
    zctx.strokeStyle = '#fff';
    zctx.lineWidth = 2;
    zctx.beginPath();
    zctx.moveTo(xFor(positionMs), 0);
    zctx.lineTo(xFor(positionMs), zh);
    zctx.stroke();
  }, [accent, beatGrid, cueMs, durationMs, hotCues, loop.active, loop.endMs, loop.startMs, peaks, positionMs]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    if (zoomRef.current) observer.observe(zoomRef.current);
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
    <div className="waveform-stack">
    <canvas
      ref={canvasRef}
      className={`waveform ${disabled ? 'is-disabled' : ''}`}
      role="slider"
      aria-label="Track position"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs)}
      aria-valuenow={Math.round(positionMs)}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          onSeek(Math.max(0, Math.min(durationMs, positionMs + (event.key === 'ArrowRight' ? 1000 : -1000))));
        }
      }}
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
    <canvas ref={zoomRef} className="waveform waveform-zoom" aria-label="Zoomed waveform around the playhead" role="img" />
    </div>
  );
}
