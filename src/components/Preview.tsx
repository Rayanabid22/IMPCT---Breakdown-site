import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { renderFrame, StaticLayerCache, clearLabelCache, type Frames, type RenderState } from '../render/renderFrame';
import { Player, usePlayerTime, usePlaying } from '../store/player';
import { formatTime } from '../lib/time';
import { textBounds, textVisible } from '../render/text';

export interface PreviewHandle {
  showExternalFrame: (canvas: CanvasImageSource) => void;
}

interface Props {
  player: Player;
  state: RenderState;
  half: boolean;
  onHalfChange: (half: boolean) => void;
  locked: boolean;
  hasVideo: boolean;
  onVideoFile: (f: File) => void;
  /** The current frame of every video the template shows. */
  getFrames: () => Frames;
  projectName: string;
  selectedTextId: string | null;
  onSelectText: (id: string | null) => void;
  /** Move a text layer to (x, y) as fractions of the canvas. */
  onMoveText: (id: string, x: number, y: number, key: string) => void;
}

function fileSafe(name: string) {
  return (name.trim() || 'project').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'project';
}

/** Renders the current frame at 2x (4K) and downloads it as a PNG. */
export async function downloadScreenshot(state: RenderState, time: number, frames: Frames, name: string) {
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = Math.round(state.style.canvas.w * scale);
  c.height = Math.round(state.style.canvas.h * scale);
  const ctx = c.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a drawing surface.');
  await document.fonts.ready;
  renderFrame(ctx, state, time, frames, new StaticLayerCache(), scale);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not create the image.');
  const stamp = formatTime(time).replace(':', 'm').replace('.', 's');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileSafe(name)}_${stamp}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { player, state, half, onHalfChange, locked, hasVideo, onVideoFile, getFrames, projectName, selectedTextId, onSelectText, onMoveText },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new StaticLayerCache());
  const [fontsVersion, setFontsVersion] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => player.subscribe(() => setBusy(!player.playing && player.busy)), [player]);
  const scale = half ? 0.5 : 1;
  const W = Math.round(state.style.canvas.w * scale);
  const H = Math.round(state.style.canvas.h * scale);
  const suppressClick = useRef(false);
  const [, setLayoutTick] = useState(0);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setLayoutTick((n) => n + 1));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  // Re-render when the playhead moves, so the selection outline follows text that appears and disappears.
  usePlayerTime(player, 250);

  /** Canvas units under the pointer. */
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * state.style.canvas.w, y: ((e.clientY - r.top) / r.height) * state.style.canvas.h };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (locked || !state.texts?.length) return;
    const { w: W, h: H } = state.style.canvas;
    const p = toCanvas(e);
    const hit = [...state.texts].reverse().find((l) => {
      if (!textVisible(l, player.time)) return false;
      const b = textBounds(l, W, H);
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });
    if (!hit) return;
    suppressClick.current = true;
    onSelectText(hit.id);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const dx = p.x - hit.x * W;
    const dy = p.y - hit.y * H;
    const key = `drag-text-${hit.id}-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const q = toCanvas(ev);
      onMoveText(hit.id, Math.max(0, Math.min(1, (q.x - dx) / W)), Math.max(0, Math.min(1, (q.y - dy) / H)), key);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // Outline around the selected text, drawn as an overlay so it never ends up in the export.
  let outline: React.CSSProperties | null = null;
  const selText = state.texts?.find((t) => t.id === selectedTextId);
  const canvasEl = canvasRef.current;
  if (selText && canvasEl && !locked && textVisible(selText, player.time)) {
    const b = textBounds(selText, state.style.canvas.w, state.style.canvas.h);
    const k = canvasEl.clientWidth / state.style.canvas.w;
    outline = { left: canvasEl.offsetLeft + b.x * k, top: canvasEl.offsetTop + b.y * k, width: b.w * k, height: b.h * k };
  }

  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const onFonts = () => {
      clearLabelCache();
      cache.current.invalidate();
      setFontsVersion((v) => v + 1);
    };
    document.fonts.addEventListener('loadingdone', onFonts);
    return () => document.fonts.removeEventListener('loadingdone', onFonts);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || lockedRef.current) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    renderFrame(ctx, state, player.time, getFrames(), cache.current, scale);
    // fontsVersion is read so a font load triggers a redraw.
    void fontsVersion;
  }, [player, state, scale, fontsVersion, getFrames]);

  useEffect(() => {
    draw();
    return player.subscribe(draw);
  }, [draw, player, W, H, locked]);

  // A looping background video needs redraws even while paused.
  useEffect(() => {
    if (state.style.background.type !== 'video') return;
    let raf = 0;
    const tick = () => {
      if (!player.playing) draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.style.background.type, draw, player]);

  useImperativeHandle(ref, () => ({
    showExternalFrame: (img) => {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0, W, H);
      }
    },
  }));

  return (
    <div className="preview">
      <div
        className={`stage ${dragOver ? 'drag-over' : ''}`}
        data-busy={busy ? 'true' : undefined}
        onDragOver={(e) => {
          if (locked) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !locked) onVideoFile(f);
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ aspectRatio: `${state.style.canvas.w} / ${state.style.canvas.h}` }}
          onPointerDown={onPointerDown}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (!locked) player.toggle();
          }}
          aria-label="Post preview. Click to play or pause."
        />
        {outline && <div className="text-outline" style={outline} aria-hidden />}
        {busy && hasVideo && !locked && <div className="stage-busy">Loading frames…</div>}
        {!hasVideo && !locked && <div className="stage-note">Drop the video for this project here, or use Replace video in the top bar.</div>}
      </div>
      <Transport
        player={player}
        duration={state.duration}
        disabled={locked || !hasVideo}
        half={half}
        onHalfChange={onHalfChange}
        onScreenshot={() => downloadScreenshot(state, player.time, getFrames(), projectName)}
      />
    </div>
  );
});

function Transport({
  player,
  duration,
  disabled,
  half,
  onHalfChange,
  onScreenshot,
}: {
  player: Player;
  duration: number;
  disabled: boolean;
  half: boolean;
  onHalfChange: (h: boolean) => void;
  onScreenshot: () => Promise<void>;
}) {
  const t = usePlayerTime(player);
  const playing = usePlaying(player);
  const [shooting, setShooting] = useState(false);
  return (
    <div className="transport">
      <button type="button" className="btn icon-btn" onClick={() => player.toggle()} disabled={disabled} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="timecode">
        {formatTime(t)} <span className="muted">/ {formatTime(duration)}</span>
      </span>
      <input
        className="scrub"
        type="range"
        min={0}
        max={duration || 1}
        step={0.001}
        value={Math.min(t, duration || 1)}
        disabled={disabled}
        aria-label="Scrub"
        onChange={(e) => player.seek(parseFloat(e.target.value))}
      />
      <button
        type="button"
        className="btn icon-btn camera"
        disabled={disabled || shooting}
        aria-label="Save this frame as a 4K PNG"
        title="Save this frame as a 4K PNG"
        onClick={async () => {
          setShooting(true);
          try {
            await onScreenshot();
          } finally {
            setShooting(false);
          }
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
          <circle cx="12" cy="13.5" r="3.5" />
        </svg>
      </button>
      <div className="segmented small" role="radiogroup" aria-label="Preview quality">
        <button type="button" role="radio" aria-checked={!half} className={!half ? 'active' : ''} onClick={() => onHalfChange(false)} title="Preview at full resolution">
          Full
        </button>
        <button type="button" role="radio" aria-checked={half} className={half ? 'active' : ''} onClick={() => onHalfChange(true)} title="Lighter preview for slower laptops. Export is always full quality.">
          Half
        </button>
      </div>
    </div>
  );
}
