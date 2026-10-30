import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAIN, type Clip, type TemplateState } from '../types';
import type { Thumbnails } from '../media/analyze';
import { clipCount, evenClips, isHighlights, randomClips } from '../lib/templates';
import { formatTime, parseTime } from '../lib/time';
import { FileButton } from './controls';
import { VIDEO_ACCEPT } from './StartScreen';

const MIN_CLIP = 0.5;

interface Props {
  tpl: TemplateState;
  mainDuration: number;
  thumbnails: Thumbnails | null;
  onChange: (fn: (t: TemplateState) => TemplateState, key?: string) => void;
  onUploadClip: (index: number, f: File) => void;
  onUploadAudio: (f: File) => void;
  locked: boolean;
}

export function sourceDuration(tpl: TemplateState, sourceId: string, mainDuration: number) {
  return sourceId === MAIN ? mainDuration : (tpl.sources[sourceId]?.duration ?? 0);
}

/** Adds or removes ring tiles, keeping the ones already there. */
export function setRingCount(tpl: TemplateState, n: number, mainDuration: number): TemplateState {
  const count = Math.max(6, Math.min(8, n));
  let clips = tpl.clips.slice(0, count);
  if (clips.length < count) {
    const extra = evenClips(count, mainDuration).slice(clips.length);
    clips = [...clips, ...extra.map((c) => ({ ...c, end: Math.min(c.end, c.start + Math.max(tpl.duration, MIN_CLIP)) }))];
  }
  return { ...tpl, ringCount: count, clips };
}

export function HighlightsPanel({ tpl, mainDuration, thumbnails, onChange, onUploadClip, onUploadAudio, locked }: Props) {
  const highlights = isHighlights(tpl.id);
  const n = clipCount(tpl);
  const ownSources = Object.entries(tpl.sources);
  const setClip = (i: number, patch: Partial<Clip>, key?: string) =>
    onChange((t) => ({ ...t, clips: t.clips.map((c, j) => (j === i ? { ...c, ...patch } : c)) }), key);

  return (
    <div className="segment-list highlights">
      <div className="panel-head">
        <span className="panel-title">{tpl.id === 'launch2' ? 'Highlights under the video' : 'Highlights'}</span>
        {highlights ? (
          <button type="button" className="btn small" disabled={locked} onClick={() => onChange((t) => ({ ...t, clips: evenClips(n, mainDuration), duration: Math.max(1, mainDuration / n) }))} title="Cut the launch video into equal pieces, one per tile">
            Split video evenly
          </button>
        ) : (
          <button type="button" className="btn small" disabled={locked} onClick={() => onChange((t) => ({ ...t, clips: randomClips(2, mainDuration, t.loopLength) }))} title="Pick two new random moments">
            Shuffle
          </button>
        )}
      </div>

      <div className="hl-settings">
        {highlights && (
          <SecondsField
            label="Post length"
            hint="How long the exported video is. Shorter clips loop."
            value={tpl.duration}
            min={1}
            max={180}
            disabled={locked}
            onCommit={(v) => onChange((t) => ({ ...t, duration: v }), 'duration')}
          />
        )}
        {tpl.id === 'launch2' && (
          <SecondsField
            label="Loop length"
            hint="Length of each highlight. They loop while the main video plays."
            value={tpl.loopLength}
            min={MIN_CLIP}
            max={Math.max(MIN_CLIP, mainDuration)}
            disabled={locked}
            onCommit={(v) =>
              onChange(
                (t) => ({
                  ...t,
                  loopLength: v,
                  clips: t.clips.map((c) => {
                    const dur = sourceDuration(t, c.sourceId, mainDuration);
                    const start = Math.max(0, Math.min(c.start, dur - v));
                    return { ...c, start, end: Math.min(dur, start + v) };
                  }),
                }),
                'loop',
              )
            }
          />
        )}
        {tpl.id === 'ring' && (
          <div className="field">
            <div className="field-row">
              <label htmlFor="ring-count">Number of highlights</label>
              <span className="field-value">{n}</span>
            </div>
            <input id="ring-count" type="range" min={6} max={8} step={1} value={n} disabled={locked} onChange={(e) => onChange((t) => setRingCount(t, Number(e.target.value), mainDuration))} />
            <p className="hint">With 6 or 7, the logo gets a wider space.</p>
          </div>
        )}
        {highlights && (
          <div className="field">
            <label htmlFor="audio-src">Sound</label>
            <div className="row-gap">
              <select
                id="audio-src"
                value={tpl.audio.sourceId ?? ''}
                disabled={locked}
                onChange={(e) => onChange((t) => ({ ...t, audio: { ...t.audio, sourceId: e.target.value || null } }))}
              >
                <option value="">No sound</option>
                <option value={MAIN}>Launch video</option>
                {ownSources.map(([id, s]) => (
                  <option key={id} value={id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <FileButton label="Upload audio" accept="audio/*,video/*,.mp3,.wav,.m4a,.aac" onFile={onUploadAudio} className="btn small" />
            </div>
            {tpl.audio.sourceId && (
              <SecondsField
                label="Start sound at"
                value={tpl.audio.offset}
                min={0}
                max={Math.max(0, sourceDuration(tpl, tpl.audio.sourceId, mainDuration) - 0.5)}
                disabled={locked}
                onCommit={(v) => onChange((t) => ({ ...t, audio: { ...t.audio, offset: v } }), 'audio-offset')}
              />
            )}
          </div>
        )}
      </div>

      <div className="lanes">
        {tpl.clips.map((c, i) => (
          <ClipLane
            key={c.id}
            index={i}
            clip={c}
            sourceName={c.sourceId === MAIN ? 'Launch video' : (tpl.sources[c.sourceId]?.name ?? 'Missing clip')}
            sourceDuration={sourceDuration(tpl, c.sourceId, mainDuration)}
            thumbnails={c.sourceId === MAIN ? thumbnails : null}
            locked={locked}
            onChange={(patch, key) => setClip(i, patch, key)}
            onUpload={(f) => onUploadClip(i, f)}
            onUseMain={() => {
              const len = Math.min(mainDuration, Math.max(MIN_CLIP, tpl.id === 'launch2' ? tpl.loopLength : tpl.duration));
              const start = Math.max(0, Math.min(mainDuration - len, (mainDuration * i) / Math.max(1, n)));
              setClip(i, { sourceId: MAIN, start, end: start + len });
            }}
          />
        ))}
      </div>
      <p className="hint">
        Drag a highlight window to move it, drag its edges to trim it. {highlights ? 'Use Own clip on any tile to build a compilation from separate videos.' : ''}
      </p>
    </div>
  );
}

function SecondsField({ label, hint, value, min, max, disabled, onCommit }: { label: string; hint?: string; value: number; min: number; max: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatTime(value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(formatTime(value)), [value]);
  const id = `sec-${label.replace(/\W+/g, '-')}`;
  const commit = () => {
    const v = parseTime(text);
    if (v === null) {
      setErr(`"${text}" isn't a time. Try 8 or 0:08.5.`);
      setText(formatTime(value));
      return;
    }
    const c = Math.max(min, Math.min(max, v));
    setErr(c !== v ? `Kept between ${formatTime(min)} and ${formatTime(max)}.` : null);
    if (Math.abs(c - value) > 1e-6) onCommit(c);
    setText(formatTime(c));
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="time-input" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      {hint && <p className="hint">{hint}</p>}
      {err && <p className="inline-msg">{err}</p>}
    </div>
  );
}

interface LaneProps {
  index: number;
  clip: Clip;
  sourceName: string;
  sourceDuration: number;
  thumbnails: Thumbnails | null;
  locked: boolean;
  onChange: (patch: Partial<Clip>, key?: string) => void;
  onUpload: (f: File) => void;
  onUseMain: () => void;
}

function ClipLane({ index, clip, sourceName, sourceDuration: dur, thumbnails, locked, onChange, onUpload, onUseMain }: LaneProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(400);
  const [drag, setDrag] = useState<string | null>(null);
  const H = 30;

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = thumbRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1c24';
    ctx.fillRect(0, 0, width, H);
    if (!thumbnails || thumbnails.images.length === 0 || dur <= 0) return;
    const tileW = (thumbnails.width * H) / thumbnails.height;
    let j = 0;
    for (let k = 0; k < Math.ceil(width / tileW); k++) {
      const t = (((k + 0.5) * tileW) / width) * dur;
      while (j < thumbnails.times.length - 1 && Math.abs(thumbnails.times[j + 1] - t) <= Math.abs(thumbnails.times[j] - t)) j++;
      ctx.drawImage(thumbnails.images[j], k * tileW, 0, tileW, H);
    }
  }, [thumbnails, width, dur]);

  const toX = (t: number) => (dur > 0 ? (t / dur) * width : 0);
  const start = (mode: 'start' | 'end' | 'move') => (e: React.PointerEvent) => {
    if (locked || dur <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const rect = barRef.current!.getBoundingClientRect();
    const x0 = e.clientX;
    const s0 = clip.start;
    const e0 = clip.end;
    const key = `lane-${clip.id}-${Date.now()}`;
    setDrag(mode);
    const move = (ev: PointerEvent) => {
      const dt = ((ev.clientX - x0) / rect.width) * dur;
      if (mode === 'move') {
        const len = e0 - s0;
        const s = Math.max(0, Math.min(dur - len, s0 + dt));
        onChange({ start: s, end: s + len }, key);
      } else if (mode === 'start') {
        onChange({ start: Math.max(0, Math.min(e0 - MIN_CLIP, s0 + dt)) }, key);
      } else {
        onChange({ end: Math.min(dur, Math.max(s0 + MIN_CLIP, e0 + dt)) }, key);
      }
    };
    const up = () => {
      setDrag(null);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const setTime = (which: 'start' | 'end', text: string) => {
    const v = parseTime(text);
    if (v === null) return;
    if (which === 'start') onChange({ start: Math.max(0, Math.min(clip.end - MIN_CLIP, v)) });
    else onChange({ end: Math.min(dur, Math.max(clip.start + MIN_CLIP, v)) });
  };

  return (
    <div className="lane">
      <span className="lane-num">{index + 1}</span>
      <div className="lane-main">
        <div className="lane-bar" ref={barRef} style={{ height: H }}>
          <canvas ref={thumbRef} className="thumbs" style={{ width, height: H }} aria-hidden />
          <div
            className={`lane-window ${drag ? 'dragging' : ''}`}
            style={{ left: toX(clip.start), width: Math.max(4, toX(clip.end) - toX(clip.start)) }}
            onPointerDown={start('move')}
            role="group"
            aria-label={`Highlight ${index + 1}, ${formatTime(clip.start)} to ${formatTime(clip.end)}`}
          >
            <span className="lane-edge left" onPointerDown={start('start')} />
            <span className="lane-edge right" onPointerDown={start('end')} />
          </div>
        </div>
        <div className="lane-meta">
          <span className="muted lane-src" title={sourceName}>
            {sourceName}
          </span>
          <LaneTime label={`Start of highlight ${index + 1}`} value={clip.start} disabled={locked} onCommit={(t) => setTime('start', t)} />
          <span className="muted">to</span>
          <LaneTime label={`End of highlight ${index + 1}`} value={clip.end} disabled={locked} onCommit={(t) => setTime('end', t)} />
          <span className="seg-dur">{(clip.end - clip.start).toFixed(2)}s</span>
          <FileButton label="Own clip" accept={VIDEO_ACCEPT} onFile={onUpload} className="btn tiny" />
          {clip.sourceId !== MAIN && (
            <button type="button" className="btn tiny" onClick={onUseMain} disabled={locked}>
              Use launch video
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LaneTime({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (text: string) => void }) {
  const [text, setText] = useState(formatTime(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(formatTime(value));
  }, [value, focus]);
  return (
    <input
      className="time-input small"
      aria-label={label}
      value={text}
      disabled={disabled}
      onFocus={() => setFocus(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocus(false);
        onCommit(text);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
