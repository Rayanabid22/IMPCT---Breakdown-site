import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Segment } from '../types';
import type { Thumbnails } from '../media/analyze';
import { Player } from '../store/player';
import { boundaryLimits, snapTargets, snapTime } from '../lib/segments';
import { formatTime } from '../lib/time';

interface Props {
  player: Player;
  segments: Segment[];
  duration: number;
  selected: number;
  onSelect: (i: number) => void;
  onMoveBoundary: (index: number, t: number, key: string) => void;
  snapping: boolean;
  onSnappingChange: (v: boolean) => void;
  thumbnails: Thumbnails | null;
  analyzing: boolean;
  locked: boolean;
}

const TRACK_H = 64;
const SNAP_PX = 8;

export function Timeline({ player, segments, duration, selected, onSelect, onMoveBoundary, snapping, onSnappingChange, thumbnails, analyzing, locked }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<{ index: number; time: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const toX = (t: number) => (duration > 0 ? (t / duration) * width : 0);
  const toTime = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };

  // Thumbnails, drawn once per size change.
  useEffect(() => {
    const c = thumbRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(TRACK_H * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#15161c';
    ctx.fillRect(0, 0, width, TRACK_H);
    if (!thumbnails || thumbnails.images.length === 0 || duration <= 0) return;
    const tileW = (thumbnails.width * TRACK_H) / thumbnails.height;
    const n = Math.ceil(width / tileW);
    let j = 0;
    for (let k = 0; k < n; k++) {
      const t = (((k + 0.5) * tileW) / width) * duration;
      while (j < thumbnails.times.length - 1 && Math.abs(thumbnails.times[j + 1] - t) <= Math.abs(thumbnails.times[j] - t)) j++;
      ctx.drawImage(thumbnails.images[j], k * tileW, 0, tileW, TRACK_H);
    }
  }, [thumbnails, width, duration]);

  // Playhead, moved directly for smoothness.
  useEffect(() => {
    const update = () => {
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${toX(player.time)}px)`;
    };
    update();
    return player.subscribe(update);
  });

  const startScrub = (e: React.PointerEvent) => {
    if (locked || duration <= 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const t = toTime(e.clientX);
    player.pause();
    player.seek(t);
    const idx = segments.findIndex((s) => t >= s.start && t < s.end);
    onSelect(idx === -1 ? segments.length - 1 : idx);
    const move = (ev: PointerEvent) => player.seek(toTime(ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const resolveTime = (index: number, raw: number, shift: boolean) => {
    let t = raw;
    if (snapping && !shift) {
      const tol = (SNAP_PX / Math.max(1, width)) * duration;
      t = snapTime(t, snapTargets(t, player.time), tol);
    }
    const [lo, hi] = boundaryLimits(segments, index);
    return Math.min(hi, Math.max(lo, t));
  };

  const startHandleDrag = (index: number) => (e: React.PointerEvent) => {
    if (locked) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const key = `drag-${index}-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const t = resolveTime(index, toTime(ev.clientX), ev.shiftKey);
      setDrag({ index, time: t });
      onMoveBoundary(index, t, key);
    };
    const up = () => {
      setDrag(null);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    setDrag({ index, time: segments[index].start });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onHandleKey = (index: number) => (e: React.KeyboardEvent) => {
    if (locked) return;
    const stepS = e.shiftKey ? 1 : 1 / player.fps;
    let dir = 0;
    if (e.key === 'ArrowLeft') dir = -1;
    else if (e.key === 'ArrowRight') dir = 1;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const [lo, hi] = boundaryLimits(segments, index);
    onMoveBoundary(index, Math.min(hi, Math.max(lo, segments[index].start + dir * stepS)), `key-${index}`);
  };

  const ticks: number[] = [];
  if (duration > 0) {
    const pxPerSec = width / duration;
    const step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * pxPerSec >= 60) ?? 120;
    for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);
  }

  return (
    <div className="timeline">
      <div className="timeline-head">
        <span className="panel-title">Timeline</span>
        <span className="hint">Drag the white handles between sections. Hold Shift to drag without snapping.</span>
        {analyzing && <span className="pill">Reading video frames…</span>}
        <label className="check">
          <input type="checkbox" checked={snapping} onChange={(e) => onSnappingChange(e.target.checked)} /> Snap to playhead and 0.5s
        </label>
      </div>
      <div ref={wrapRef} className={`timeline-track ${locked ? 'locked' : ''}`} style={{ height: TRACK_H }} onPointerDown={startScrub}>
        <canvas ref={thumbRef} className="thumbs" style={{ width, height: TRACK_H }} aria-hidden />
        {segments.map((s, i) => (
          <div
            key={s.id}
            className={`tl-seg ${i === selected ? 'selected' : ''}`}
            style={{ left: toX(s.start), width: Math.max(0, toX(s.end) - toX(s.start)) }}
          >
            <span className="tl-label">{s.label || 'Untitled'}</span>
          </div>
        ))}
        {segments.slice(1).map((s, k) => {
          const i = k + 1;
          return (
            <div
              key={`h-${s.id}`}
              className={`tl-handle ${drag?.index === i ? 'dragging' : ''}`}
              style={{ left: toX(s.start) }}
              onPointerDown={startHandleDrag(i)}
              onKeyDown={onHandleKey(i)}
              tabIndex={locked ? -1 : 0}
              role="slider"
              aria-label={`Boundary between ${segments[i - 1].label} and ${s.label}`}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={s.start}
              aria-valuetext={formatTime(s.start)}
            >
              <span className="grip" />
              {drag?.index === i && <span className="tooltip">{formatTime(drag.time)}</span>}
            </div>
          );
        })}
        <div ref={playheadRef} className="tl-playhead" aria-hidden />
      </div>
      <div className="ruler" style={{ width: '100%' }}>
        {ticks.map((t) => (
          <span key={t} style={{ left: toX(t) }}>
            {formatTime(t).replace(/\.\d+$/, '')}
          </span>
        ))}
      </div>
    </div>
  );
}
