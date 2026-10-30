import { useState } from 'react';
import type { Preset } from '../lib/presets';
import type { TemplateId } from '../types';
import { TEMPLATES, templateStyle } from '../lib/templates';
import type { RecentEntry } from '../store/storage';
import { formatTime } from '../lib/time';
import { FileButton } from './controls';
import { PresetThumb } from './PresetThumb';

interface Props {
  presets: Preset[];
  presetId: string | null;
  onPresetChange: (id: string | null) => void;
  template: TemplateId;
  onTemplateChange: (id: TemplateId) => void;
  onVideo: (f: File) => void;
  recent: RecentEntry[];
  onOpenRecent: (id: string) => void;
  onRemoveRecent: (id: string) => void;
  onImportJson: (f: File) => void;
  error: string | null;
  browserNote: string | null;
}

export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v';

const STORYBOARD_LABELS = ['Frame 1', 'Frame 2', 'Frame 3', 'Frame 4'];
const tplStyles = Object.fromEntries(TEMPLATES.map((t) => [t.id, templateStyle(t.id)]));

export function StartScreen({ presets, presetId, onPresetChange, template, onTemplateChange, onVideo, recent, onOpenRecent, onRemoveRecent, onImportJson, error, browserNote }: Props) {
  const [over, setOver] = useState(false);
  return (
    <div className="start">
      <header className="start-head">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          IMPCT Studio
        </div>
        <FileButton label="Open project file (.json)" accept="application/json,.json" onFile={onImportJson} className="btn ghost" />
      </header>
      {browserNote && <p className="banner">{browserNote}</p>}

      <label
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onVideo(f);
        }}
      >
        <input
          type="file"
          accept={VIDEO_ACCEPT}
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onVideo(f);
            e.target.value = '';
          }}
        />
        <span className="drop-title">Drop your launch video here</span>
        <span className="drop-sub">
          Making a <strong>{TEMPLATES.find((t) => t.id === template)?.name}</strong> post. Or click to choose a file. MP4, MOV or WebM. It stays on this computer.
        </span>
      </label>
      {error && (
        <p className="error-line" role="alert">
          {error}
        </p>
      )}

      <h2 className="start-h2">Template</h2>
      <div className="preset-grid template-grid" role="radiogroup" aria-label="Template">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={template === t.id} className={`preset-card ${template === t.id ? 'active' : ''}`} onClick={() => onTemplateChange(t.id)}>
            <PresetThumb style={t.id === 'breakdown' ? presets[0].style : tplStyles[t.id]} labels={t.id === 'storyboard' ? STORYBOARD_LABELS : presets[0].labels} template={t.id} />
            <span>{t.name}</span>
            <span className="muted small-text">{t.blurb}</span>
          </button>
        ))}
      </div>

      {template === 'breakdown' && (
      <>
      <h2 className="start-h2">Start from a look</h2>
      <p className="hint start-hint">
        {presetId ? 'The video will start with this look and its section names.' : 'Optional. With no look picked, you get the orange look with Hook, Body, Features, CTA.'}
      </p>
      <div className="preset-grid" role="radiogroup" aria-label="Preset">
        {presets.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={presetId === p.id} className={`preset-card ${presetId === p.id ? 'active' : ''}`} onClick={() => onPresetChange(presetId === p.id ? null : p.id)}>
            <PresetThumb style={p.style} labels={p.labels} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      </>
      )}

      {recent.length > 0 && (
        <>
          <h2 className="start-h2">Recent projects</h2>
          <ul className="recent">
            {recent.map((r) => (
              <li key={r.id}>
                <button type="button" className="recent-open" onClick={() => onOpenRecent(r.id)}>
                  <strong>{r.name}</strong>
                  <span className="muted">
                    {r.duration ? formatTime(r.duration) : 'no video'} · edited {new Date(r.updatedAt).toLocaleString()}
                  </span>
                </button>
                <button type="button" className="btn icon-btn" aria-label={`Remove ${r.name} from recent`} title="Remove from list" onClick={() => onRemoveRecent(r.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
