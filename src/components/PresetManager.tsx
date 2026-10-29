import { useState } from 'react';
import { cloneStyle, type Preset } from '../lib/presets';
import { newId } from '../lib/segments';
import type { Style } from '../types';

interface Props {
  presets: Preset[];
  currentStyle: Style;
  currentLabels: string[];
  onChange: (userPresets: Preset[]) => void;
  onClose: () => void;
}

export function PresetManager({ presets, currentStyle, currentLabels, onChange, onClose }: Props) {
  const [name, setName] = useState('');
  const user = presets.filter((p) => !p.builtIn);

  const save = () => {
    const n = name.trim() || `My preset ${user.length + 1}`;
    onChange([...user, { id: newId('preset'), name: n, labels: currentLabels, style: cloneStyle(currentStyle) }]);
    setName('');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="presets-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal">
        <h2 id="presets-title">Presets</h2>
        <div className="field">
          <label htmlFor="preset-name">Save the current look as a preset</label>
          <div className="row-gap">
            <input id="preset-name" placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <button type="button" className="btn primary" onClick={save}>
              Save
            </button>
          </div>
          <p className="hint">Saves the style and the section names. Stored in this browser.</p>
        </div>
        <ul className="preset-list">
          {presets.map((p) => (
            <li key={p.id}>
              {p.builtIn ? (
                <span className="preset-name">
                  {p.name} <span className="muted">(built in)</span>
                </span>
              ) : (
                <input
                  className="preset-name-input"
                  aria-label={`Rename ${p.name}`}
                  value={p.name}
                  onChange={(e) => onChange(user.map((u) => (u.id === p.id ? { ...u, name: e.target.value } : u)))}
                />
              )}
              <button type="button" className="btn small" onClick={() => onChange([...user, { ...p, id: newId('preset'), name: `${p.name} copy`, builtIn: false, style: cloneStyle(p.style) }])}>
                Duplicate
              </button>
              {!p.builtIn && (
                <button type="button" className="btn small danger" onClick={() => onChange(user.filter((u) => u.id !== p.id))}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
