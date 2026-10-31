import { useEffect, useRef, useState } from 'react';
import { MAIN, type TemplateState } from '../types';
import type { MusicTrack } from '../store/storage';
import { assetKey, getBlob } from '../store/storage';
import { isHighlights } from '../lib/templates';
import { formatTime, parseTime } from '../lib/time';
import { Section, Toggle } from './controls';

interface Props {
  tpl: TemplateState;
  library: MusicTrack[];
  /** Length of the main video, for the start-at limit. */
  mainDuration: number;
  onChange: (audio: Partial<TemplateState['audio']>, key?: string) => void;
  onPickTrack: (t: MusicTrack) => void;
  onOpenLibrary: () => void;
}

export function SoundPanel({ tpl, library, mainDuration, onChange, onPickTrack, onOpenLibrary }: Props) {
  const a = tpl.audio;
  const showreel = tpl.id === 'showreel';
  const isMusic = !!a.sourceId && a.sourceId !== MAIN;
  const others = Object.entries(tpl.sources).filter(([id]) => id === a.sourceId && !library.some((t) => t.id === id));
  const srcDur = !a.sourceId ? 0 : a.sourceId === MAIN ? mainDuration : (tpl.sources[a.sourceId]?.duration ?? 0);
  const canOffset = isMusic || (a.sourceId === MAIN && isHighlights(tpl.id));
  return (
    <Section title="Sound">
      <div className="field">
        <label htmlFor="sound-src">Soundtrack</label>
        <select
          id="sound-src"
          value={a.sourceId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            const track = library.find((t) => t.id === v);
            if (track) onPickTrack(track);
            else onChange({ sourceId: v || null, offset: 0 });
          }}
        >
          {!showreel && <option value={MAIN}>{isHighlights(tpl.id) ? 'Launch video sound' : "The video's own sound"}</option>}
          {library.map((t) => (
            <option key={t.id} value={t.id}>
              ♪ {t.name}
            </option>
          ))}
          {others.map(([id, s]) => (
            <option key={id} value={id}>
              ♪ {s.name}
            </option>
          ))}
          <option value="">No sound</option>
        </select>
      </div>
      <button type="button" className="btn small" onClick={onOpenLibrary}>
        Music library ({library.length})
      </button>
      {canOffset && (
        <StartAt value={a.offset} max={Math.max(0, srcDur - 0.5)} onCommit={(offset) => onChange({ offset }, 'audio-offset')} />
      )}
      {(isMusic || (a.sourceId === MAIN && isHighlights(tpl.id))) && (
        <Toggle label="Fade out at the end" checked={a.fade} onChange={(fade) => onChange({ fade })} />
      )}
      {isMusic && srcDur > 0 && <p className="hint">Track length {formatTime(srcDur)}. It stops when the post ends.</p>}
    </Section>
  );
}

function StartAt({ value, max, onCommit }: { value: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  return (
    <div className="field">
      <label htmlFor="sound-start">Start the track at</label>
      <input
        id="sound-start"
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
      <p className="hint">Skip an intro, or start on the drop.</p>
    </div>
  );
}

interface LibraryProps {
  library: MusicTrack[];
  currentId: string | null;
  onUpload: (files: File[]) => void;
  onUse: (t: MusicTrack) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  busy: boolean;
}

export function MusicLibrary({ library, currentId, onUpload, onUse, onRemove, onClose, busy }: LibraryProps) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (audio.current) {
        audio.current.pause();
        URL.revokeObjectURL(audio.current.src);
      }
    },
    [],
  );
  const toggle = async (t: MusicTrack) => {
    if (audio.current) {
      audio.current.pause();
      URL.revokeObjectURL(audio.current.src);
      audio.current = null;
    }
    if (playing === t.id) return setPlaying(null);
    const stored = await getBlob(assetKey(t.id)).catch(() => null);
    if (!stored) return;
    const el = new Audio(URL.createObjectURL(stored.blob));
    el.onended = () => setPlaying(null);
    audio.current = el;
    el.play().catch(() => {});
    setPlaying(t.id);
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="music-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal">
        <h2 id="music-title">Music library</h2>
        <p className="hint" style={{ marginTop: -6 }}>
          Tracks you add here are available in every project in this browser.
        </p>
        <label className="btn primary" tabIndex={0} role="button" onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.currentTarget.querySelector('input') as HTMLInputElement).click()}>
          {busy ? 'Adding…' : '+ Upload music'}
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,video/mp4"
            multiple
            className="visually-hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) onUpload(files);
              e.target.value = '';
            }}
          />
        </label>
        {library.length === 0 ? (
          <p className="hint">No music yet. Upload MP3, WAV or M4A files.</p>
        ) : (
          <ul className="music-list">
            {library.map((t) => (
              <li key={t.id} className={t.id === currentId ? 'current' : ''}>
                <button type="button" className="btn icon-btn" aria-label={playing === t.id ? `Stop ${t.name}` : `Play ${t.name}`} onClick={() => toggle(t)}>
                  {playing === t.id ? '❚❚' : '▶'}
                </button>
                <span className="music-name" title={t.name}>
                  {t.name}
                </span>
                <span className="muted">{formatTime(t.duration).replace(/\.\d+$/, '')}</span>
                <button type="button" className="btn small" disabled={t.id === currentId} onClick={() => onUse(t)}>
                  {t.id === currentId ? 'In use' : 'Use'}
                </button>
                <button type="button" className="btn icon-btn danger" aria-label={`Remove ${t.name} from the library`} title="Remove from library" onClick={() => onRemove(t.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
