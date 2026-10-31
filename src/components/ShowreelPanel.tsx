import { MAIN, type Clip, type TemplateState } from '../types';
import type { Thumbnails } from '../media/analyze';
import { outputDuration } from '../lib/templates';
import { formatTime } from '../lib/time';
import { ClipLane, SecondsField, sourceDuration } from './HighlightsPanel';
import { VIDEO_ACCEPT } from './StartScreen';

interface Props {
  tpl: TemplateState;
  mainDuration: number;
  mainName: string;
  thumbnails: Thumbnails | null;
  sourceThumbs: Record<string, Thumbnails>;
  onChange: (fn: (t: TemplateState) => TemplateState, key?: string) => void;
  onAddClips: (files: File[]) => void;
  onReplaceClip: (index: number, f: File) => void;
  adding: boolean;
  locked: boolean;
}

const move = (clips: Clip[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= clips.length) return clips;
  const out = [...clips];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

export function ShowreelPanel({ tpl, mainDuration, mainName, thumbnails, sourceThumbs, onChange, onAddClips, onReplaceClip, adding, locked }: Props) {
  const total = outputDuration(tpl, mainDuration);
  const setClip = (i: number, patch: Partial<Clip>, key?: string) => onChange((t) => ({ ...t, clips: t.clips.map((c, j) => (j === i ? { ...c, ...patch } : c)) }), key);
  return (
    <div className="segment-list highlights">
      <div className="panel-head">
        <span className="panel-title">Showreel</span>
        <label className={`btn small ${tpl.clips.length < 2 ? 'primary' : ''}`} tabIndex={0} role="button" onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.currentTarget.querySelector('input') as HTMLInputElement).click()}>
          {adding ? 'Adding clips…' : '+ Add clips'}
          <input
            type="file"
            accept={VIDEO_ACCEPT}
            multiple
            className="visually-hidden"
            disabled={locked || adding}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
              if (files.length) onAddClips(files);
              e.target.value = '';
            }}
          />
        </label>
        <span className="muted">
          {tpl.clips.length} clip{tpl.clips.length === 1 ? '' : 's'}, {formatTime(total)} total
        </span>
      </div>
      <div className="hl-settings">
        <SecondsField
          label="Cut length"
          hint="How long each clip shows. Sets every clip; trim single clips on their lane."
          value={tpl.loopLength}
          min={0.3}
          max={10}
          disabled={locked}
          onCommit={(v) =>
            onChange(
              (t) => ({
                ...t,
                loopLength: v,
                clips: t.clips.map((c) => {
                  const dur = sourceDuration(t, c.sourceId, mainDuration);
                  const mid = (c.start + c.end) / 2;
                  const start = Math.max(0, Math.min(dur - v, mid - v / 2));
                  return { ...c, start, end: Math.min(dur, start + v) };
                }),
              }),
              'cut',
            )
          }
        />
      </div>
      <div className="lanes">
        {tpl.clips.map((c, i) => (
          <ClipLane
            key={c.id}
            index={i}
            clip={c}
            sourceName={c.sourceId === MAIN ? mainName : (tpl.sources[c.sourceId]?.name ?? 'Missing clip')}
            sourceDuration={sourceDuration(tpl, c.sourceId, mainDuration)}
            thumbnails={c.sourceId === MAIN ? thumbnails : (sourceThumbs[c.sourceId] ?? null)}
            locked={locked}
            onChange={(patch, key) => setClip(i, patch, key)}
            onUpload={(f) => onReplaceClip(i, f)}
            uploadLabel="Replace"
            tools={
              <>
                <button type="button" className="btn tiny" aria-label={`Move clip ${i + 1} earlier`} disabled={locked || i === 0} onClick={() => onChange((t) => ({ ...t, clips: move(t.clips, i, -1) }))}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn tiny"
                  aria-label={`Move clip ${i + 1} later`}
                  disabled={locked || i === tpl.clips.length - 1}
                  onClick={() => onChange((t) => ({ ...t, clips: move(t.clips, i, 1) }))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn tiny danger"
                  aria-label={`Remove clip ${i + 1}`}
                  disabled={locked || tpl.clips.length <= 1}
                  onClick={() => onChange((t) => ({ ...t, clips: t.clips.filter((_, j) => j !== i) }))}
                >
                  ✕
                </button>
              </>
            }
          />
        ))}
      </div>
      <p className="hint">Clips play top to bottom with hard cuts. Drag each window to pick the moment, drag its edges to trim it.</p>
    </div>
  );
}
