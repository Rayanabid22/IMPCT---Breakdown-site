import { useEffect, useRef, useState } from 'react';
import type { Segment } from '../types';
import { formatTime, parseTime } from '../lib/time';
import { MIN_SEGMENT, setSegmentEnd, setSegmentStart, type EditResult } from '../lib/segments';
import { Player } from '../store/player';

interface Props {
  player: Player;
  segments: Segment[];
  selected: number;
  onSelect: (i: number) => void;
  onChange: (segments: Segment[], key?: string) => void;
  onSplit: () => void;
  onDelete: (i: number) => void;
  locked: boolean;
  /** Storyboard: show each section's frame image (by asset id) with a button to replace it. */
  frames?: { urls: Record<string, string>; onPick: (i: number, f: File) => void };
  title?: string;
  addLabel?: string;
}

export function SegmentList({ player, segments, selected, onSelect, onChange, onSplit, onDelete, locked, frames, title = 'Sections', addLabel = '+ Add section' }: Props) {
  const [messages, setMessages] = useState<Record<string, string>>({});

  const report = (id: string, r: EditResult, key?: string) => {
    if (r.segments !== segments) onChange(r.segments, key);
    setMessages((m) => {
      const next = { ...m };
      if (r.message) next[id] = r.message;
      else delete next[id];
      return next;
    });
  };

  return (
    <div className="segment-list">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <button type="button" className="btn small" onClick={onSplit} disabled={locked || segments.length === 0} title="Split the selected section at the playhead (S)">
          {addLabel}
        </button>
      </div>
      <div className="seg-table" role="table" aria-label="Sections">
        <div className="seg-row seg-header" role="row">
          <span role="columnheader">Label</span>
          <span role="columnheader">Start</span>
          <span role="columnheader">End</span>
          <span role="columnheader">Length</span>
          <span role="columnheader">{frames ? 'Frame' : 'Size'}</span>
          <span role="columnheader" className="visually-hidden">
            Actions
          </span>
        </div>
        {segments.map((s, i) => (
          <div key={s.id} className={`seg-item ${i === selected ? 'selected' : ''}`} onFocusCapture={() => onSelect(i)} onClick={() => onSelect(i)}>
            <div className="seg-row" role="row">
              <input
                className="seg-label"
                value={s.label}
                aria-label={`Label for section ${i + 1}`}
                disabled={locked}
                onChange={(e) => onChange(segments.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)), `label-${s.id}`)}
              />
              <TimeInput
                label={`Start of ${s.label}`}
                value={s.start}
                disabled={locked || i === 0}
                onCommit={(t) => report(s.id, setSegmentStart(segments, i, t), `start-${s.id}`)}
                onInvalid={(msg) => setMessages((m) => ({ ...m, [s.id]: msg }))}
                buttonLabel="⇤ Playhead"
                buttonTitle="Set start to playhead ([)"
                onButton={() => report(s.id, setSegmentStart(segments, i, player.time))}
              />
              <TimeInput
                label={`End of ${s.label}`}
                value={s.end}
                disabled={locked || i === segments.length - 1}
                onCommit={(t) => report(s.id, setSegmentEnd(segments, i, t), `end-${s.id}`)}
                onInvalid={(msg) => setMessages((m) => ({ ...m, [s.id]: msg }))}
                buttonLabel="Playhead ⇥"
                buttonTitle="Set end to playhead (])"
                onButton={() => report(s.id, setSegmentEnd(segments, i, player.time))}
              />
              <span className="seg-dur">{(s.end - s.start).toFixed(2)}s</span>
              {frames ? (
                <label className="seg-frame" title="Replace this frame's image" tabIndex={0} role="button" onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.currentTarget.querySelector('input') as HTMLInputElement).click()}>
                  {s.assetId && frames.urls[s.assetId] ? <img src={frames.urls[s.assetId]} alt="" /> : <span>Image</span>}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="visually-hidden"
                    disabled={locked}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) frames.onPick(i, f);
                      e.target.value = '';
                    }}
                  />
                </label>
              ) : (
              <input
                className="seg-size"
                type="number"
                min={10}
                max={60}
                placeholder="Auto"
                aria-label={`Label size for ${s.label}, leave empty for automatic`}
                title="Label size override. Leave empty to use the style size (long labels shrink automatically)."
                value={s.fontSize ?? ''}
                disabled={locked}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Math.max(10, Math.min(60, Number(e.target.value)));
                  onChange(
                    segments.map((x, j) => {
                      if (j !== i) return x;
                      const { fontSize: _omit, ...rest } = x;
                      void _omit;
                      return v ? { ...rest, fontSize: v } : rest;
                    }),
                    `size-${s.id}`,
                  );
                }}
              />
              )}
              <button
                type="button"
                className="btn icon-btn danger"
                aria-label={`Delete ${s.label}`}
                title="Delete section (its time merges into the neighbor)"
                disabled={locked || segments.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(i);
                }}
              >
                ✕
              </button>
            </div>
            {messages[s.id] && <p className="inline-msg">{messages[s.id]}</p>}
          </div>
        ))}
      </div>
      <p className="hint">
        Times accept 12.4, 0:12.4 or 00:12:12 (minutes:seconds:frames). Sections are at least {MIN_SEGMENT}s long. Fastest way: play, pause where a section
        changes, click Playhead.
      </p>
    </div>
  );
}

function TimeInput({
  label,
  value,
  disabled,
  onCommit,
  onInvalid,
  buttonLabel,
  buttonTitle,
  onButton,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (t: number) => void;
  onInvalid: (msg: string) => void;
  buttonLabel: string;
  buttonTitle: string;
  onButton: () => void;
}) {
  const [text, setText] = useState(formatTime(value));
  const [editing, setEditing] = useState(false);
  const cancelRef = useRef(false);
  useEffect(() => {
    if (!editing) setText(formatTime(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    if (text.trim() === formatTime(value)) return;
    const t = parseTime(text);
    if (t === null) {
      onInvalid(`"${text}" isn't a time. Try 12.4, 0:12.4 or 00:12:12.`);
      setText(formatTime(value));
      return;
    }
    onCommit(t);
  };

  return (
    <span className="time-cell">
      <input
        className="time-input"
        aria-label={label}
        value={text}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            cancelRef.current = true;
            setText(formatTime(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button type="button" className="btn tiny" disabled={disabled} title={buttonTitle} onClick={onButton}>
        {buttonLabel}
      </button>
    </span>
  );
}
