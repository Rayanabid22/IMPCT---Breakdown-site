import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { renderFrame, StaticLayerCache, clearLabelCache, type RenderState } from '../render/renderFrame';
import { Player, usePlayerTime, usePlaying } from '../store/player';
import { formatTime } from '../lib/time';

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
}

export const Preview = forwardRef<PreviewHandle, Props>(function Preview({ player, state, half, onHalfChange, locked, hasVideo, onVideoFile }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new StaticLayerCache());
  const [fontsVersion, setFontsVersion] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const scale = half ? 0.5 : 1;
  const W = Math.round(state.style.canvas.w * scale);
  const H = Math.round(state.style.canvas.h * scale);
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
    const v = player.video;
    const src = player.hasVideo && v.readyState >= 2 ? { image: v, width: v.videoWidth, height: v.videoHeight } : null;
    const bgv = player.bgVideo;
    const bg = bgv && bgv.readyState >= 2 ? { image: bgv, width: bgv.videoWidth, height: bgv.videoHeight } : null;
    renderFrame(ctx, state, player.time, src, cache.current, scale, bg);
    // fontsVersion is read so a font load triggers a redraw.
    void fontsVersion;
  }, [player, state, scale, fontsVersion]);

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
          onClick={() => !locked && player.toggle()}
          aria-label="Post preview. Click to play or pause."
        />
        {!hasVideo && !locked && <div className="stage-note">Drop the video for this project here, or use Replace video in the top bar.</div>}
      </div>
      <Transport player={player} duration={state.duration} disabled={locked || !hasVideo} half={half} onHalfChange={onHalfChange} />
    </div>
  );
});

function Transport({ player, duration, disabled, half, onHalfChange }: { player: Player; duration: number; disabled: boolean; half: boolean; onHalfChange: (h: boolean) => void }) {
  const t = usePlayerTime(player);
  const playing = usePlaying(player);
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
