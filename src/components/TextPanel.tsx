import { useEffect, useState } from 'react';
import type { CustomFont, TextLayer } from '../types';
import { TEXT_FONTS } from '../lib/presets';
import { formatTime, parseTime } from '../lib/time';
import { Player } from '../store/player';
import { ColorField, FileButton, Section, Segmented, Slider, Toggle, pct } from './controls';

interface Props {
  texts: TextLayer[];
  fonts: CustomFont[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<TextLayer>, key?: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onUploadFont: (f: File) => void;
  player: Player;
  duration: number;
}

export function TextPanel({ texts, fonts, selectedId, onSelect, onAdd, onChange, onDuplicate, onDelete, onUploadFont, player, duration }: Props) {
  const sel = texts.find((t) => t.id === selectedId) ?? null;
  const set = (patch: Partial<TextLayer>, key?: string) => sel && onChange(sel.id, patch, key ?? `text-${sel.id}-${Object.keys(patch).join(',')}`);
  return (
    <Section
      title="Text"
      right={
        <button type="button" className="btn small add-text" onClick={onAdd} style={{ marginRight: 14 }}>
          + Add text
        </button>
      }
    >
      {texts.length === 0 && <p className="hint">Add a title, a caption or a client name. Drag it on the preview to place it.</p>}
      {texts.length > 0 && (
        <div className="text-list" role="listbox" aria-label="Text layers">
          {texts.map((t) => (
            <button key={t.id} type="button" role="option" aria-selected={t.id === selectedId} className={`text-chip ${t.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(t.id === selectedId ? null : t.id)}>
              {t.text.split('\n')[0].trim() || 'Empty text'}
            </button>
          ))}
        </div>
      )}
      {sel && (
        <>
          <div className="field">
            <label htmlFor="text-body">Text</label>
            <textarea id="text-body" rows={2} value={sel.text} onChange={(e) => set({ text: e.target.value }, `text-${sel.id}-body`)} />
          </div>
          <div className="field field-inline">
            <label htmlFor="text-font">Font</label>
            <select id="text-font" value={sel.font} onChange={(e) => set({ font: e.target.value })}>
              {TEXT_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              {fonts.map((f) => (
                <option key={f.family} value={f.family}>
                  {f.name} (uploaded)
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <FileButton label="Upload a font file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onFile={onUploadFont} className="btn small" />
            <p className="hint">TTF, OTF or WOFF. It is saved with this project in your browser.</p>
          </div>
          <Segmented
            label="Weight"
            value={String(sel.weight) as '400' | '500' | '600' | '700' | '800'}
            options={[
              { value: '400', label: 'Regular' },
              { value: '500', label: 'Medium' },
              { value: '600', label: 'Semi' },
              { value: '700', label: 'Bold' },
              { value: '800', label: 'Black' },
            ]}
            onChange={(w) => set({ weight: Number(w) as TextLayer['weight'] })}
          />
          <Slider label="Size" min={12} max={260} value={sel.size} onChange={(size) => set({ size })} />
          <ColorField label="Color" value={sel.color} onChange={(color) => set({ color })} />
          <Slider label="Opacity" min={0} max={1} step={0.01} value={sel.opacity} format={pct} onChange={(opacity) => set({ opacity })} />
          <Segmented
            label="Align"
            value={sel.align}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(align) => set({ align })}
          />
          <Slider label="Letter spacing" min={-10} max={40} step={0.5} value={sel.letterSpacing} onChange={(letterSpacing) => set({ letterSpacing })} />
          <Slider label="Line height" min={0.8} max={2} step={0.05} value={sel.lineHeight} format={(v) => v.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
          <Slider label="Left / right" min={0} max={1} step={0.001} value={sel.x} format={pct} onChange={(x) => set({ x }, `text-${sel.id}-pos`)} />
          <Slider label="Up / down" min={0} max={1} step={0.001} value={sel.y} format={pct} onChange={(y) => set({ y }, `text-${sel.id}-pos`)} hint="Or drag the text on the preview." />
          <Toggle label="Background box" checked={sel.box.on} onChange={(on) => set({ box: { ...sel.box, on } })} />
          {sel.box.on && (
            <>
              <ColorField label="Box color" value={sel.box.color} onChange={(color) => set({ box: { ...sel.box, color } })} />
              <Slider label="Box opacity" min={0} max={1} step={0.01} value={sel.box.opacity} format={pct} onChange={(opacity) => set({ box: { ...sel.box, opacity } })} />
              <Slider label="Box padding" min={0} max={80} value={sel.box.padding} onChange={(padding) => set({ box: { ...sel.box, padding } })} />
              <Slider label="Box corners" min={0} max={80} value={sel.box.radius} onChange={(radius) => set({ box: { ...sel.box, radius } })} />
            </>
          )}
          <Toggle label="Shadow" checked={sel.shadow} onChange={(shadow) => set({ shadow })} />
          <Toggle label="Show the whole time" checked={sel.start <= 0 && sel.end === null} onChange={(whole) => set(whole ? { start: 0, end: null } : { start: 0, end: duration })} />
          {!(sel.start <= 0 && sel.end === null) && (
            <div className="two-col">
              <TimeField label="Appears at" value={sel.start} max={duration} onCommit={(start) => set({ start: Math.min(start, sel.end ?? duration) })} onPlayhead={() => set({ start: Math.min(player.time, sel.end ?? duration) })} />
              <TimeField label="Disappears at" value={sel.end ?? duration} max={duration} onCommit={(end) => set({ end: Math.max(end, sel.start) })} onPlayhead={() => set({ end: Math.max(player.time, sel.start) })} />
            </div>
          )}
          <div className="row-gap">
            <button type="button" className="btn small" onClick={() => onDuplicate(sel.id)}>
              Duplicate
            </button>
            <button type="button" className="btn small danger" onClick={() => onDelete(sel.id)}>
              Delete text
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

function TimeField({ label, value, max, onCommit, onPlayhead }: { label: string; value: number; max: number; onCommit: (v: number) => void; onPlayhead: () => void }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  const id = `tf-${label.replace(/\W+/g, '')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="time-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseTime(text);
          if (v === null) setText(formatTime(value));
          else onCommit(Math.max(0, Math.min(max, v)));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button type="button" className="btn tiny" onClick={onPlayhead}>
        Playhead
      </button>
    </div>
  );
}
