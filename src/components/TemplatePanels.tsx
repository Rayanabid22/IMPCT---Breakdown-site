import { useEffect, useState } from 'react';
import type { TemplateState } from '../types';
import { formatTime } from '../lib/time';
import { FileButton } from './controls';
import { VIDEO_ACCEPT } from './StartScreen';

interface BtsProps {
  tpl: TemplateState;
  onChange: (fn: (t: TemplateState) => TemplateState, key?: string) => void;
  onUploadBts: (f: File) => void;
  locked: boolean;
}

export function BtsPanel({ tpl, onChange, onUploadBts, locked }: BtsProps) {
  const src = tpl.secondary.sourceId ? tpl.sources[tpl.secondary.sourceId] : null;
  return (
    <div className="segment-list">
      <div className="panel-head">
        <span className="panel-title">BTS and result</span>
      </div>
      <div className="hl-settings">
        <div className="field">
          <div className="field-label">BTS video</div>
          <div className="row-gap">
            <FileButton label={src ? 'Replace BTS video' : 'Upload BTS video'} accept={VIDEO_ACCEPT} onFile={onUploadBts} className={src ? 'btn small' : 'btn small primary'} />
          </div>
          <p className="hint">{src ? `${src.name}, ${formatTime(src.duration)}` : 'The screen recording with the asset borders showing. The result is the video you dropped in first.'}</p>
        </div>
        <OffsetField value={tpl.secondary.offset} disabled={locked || !src} onCommit={(v) => onChange((t) => ({ ...t, secondary: { ...t.secondary, offset: v } }), 'bts-offset')} />
        <HeadingFields tpl={tpl} onChange={onChange} locked={locked} topLabel="BTS title" bottomLabel="Result title" />
        <div className="field">
          <div className="field-row">
            <label htmlFor="bts-swap">Result on top</label>
            <button id="bts-swap" type="button" role="switch" aria-checked={tpl.swap} className={`switch ${tpl.swap ? 'on' : ''}`} disabled={locked} onClick={() => onChange((t) => ({ ...t, swap: !t.swap }))}>
              <span />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OffsetField({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  return (
    <div className="field">
      <label htmlFor="bts-offset">Sync offset (seconds)</label>
      <div className="row-gap">
        <button type="button" className="btn small" disabled={disabled} onClick={() => onCommit(Math.round((value - 1 / 30) * 1000) / 1000)} aria-label="BTS one frame earlier">
          −1 frame
        </button>
        <input
          id="bts-offset"
          className="time-input"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = parseFloat(text.replace(',', '.'));
            if (Number.isFinite(v)) onCommit(Math.max(-600, Math.min(600, v)));
            else setText(value.toFixed(2));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button type="button" className="btn small" disabled={disabled} onClick={() => onCommit(Math.round((value + 1 / 30) * 1000) / 1000)} aria-label="BTS one frame later">
          +1 frame
        </button>
      </div>
      <p className="hint">If the BTS recording starts earlier or later than the result, shift it here until both line up. Positive skips into the BTS video.</p>
    </div>
  );
}

export function HeadingFields({ tpl, onChange, locked, topLabel, bottomLabel }: { tpl: TemplateState; onChange: BtsProps['onChange']; locked: boolean; topLabel: string; bottomLabel: string }) {
  return (
    <div className="field two-col">
      <div className="field">
        <label htmlFor="head-top">{topLabel}</label>
        <input id="head-top" value={tpl.headings.top} disabled={locked} onChange={(e) => onChange((t) => ({ ...t, headings: { ...t.headings, top: e.target.value } }), 'head-top')} />
      </div>
      <div className="field">
        <label htmlFor="head-bottom">{bottomLabel}</label>
        <input id="head-bottom" value={tpl.headings.bottom} disabled={locked} onChange={(e) => onChange((t) => ({ ...t, headings: { ...t.headings, bottom: e.target.value } }), 'head-bottom')} />
      </div>
    </div>
  );
}

export function StoryboardHead({ tpl, onChange, onAddFrames, locked, count }: { tpl: TemplateState; onChange: BtsProps['onChange']; onAddFrames: (files: File[]) => void; locked: boolean; count: number }) {
  return (
    <div className="segment-list">
      <div className="panel-head">
        <span className="panel-title">Storyboard</span>
        <label className={`btn small ${count === 0 ? 'primary' : ''}`} tabIndex={0} role="button" onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.currentTarget.querySelector('input') as HTMLInputElement).click()}>
          + Add frames
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="visually-hidden"
            disabled={locked}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
              if (files.length) onAddFrames(files);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="hint">
        {count === 0
          ? 'Add your storyboard frames (PNG or JPG). Pick several at once; they are ordered by file name and spread across the video.'
          : 'Each frame is a section below. Drag the handles on the timeline, or type times, so each frame lines up with its shot. Frames slide in right before their start time.'}
      </p>
      <HeadingFields tpl={tpl} onChange={onChange} locked={locked} topLabel="Top title" bottomLabel="Bottom title" />
    </div>
  );
}
