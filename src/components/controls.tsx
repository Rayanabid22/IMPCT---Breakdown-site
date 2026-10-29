import { useEffect, useId, useState, type ReactNode } from 'react';

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="chev" aria-hidden>
            ▸
          </span>
          {title}
        </button>
        {right}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <span className="field-value">{format ? format(value) : value}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

function normalizeHex(v: string): string | null {
  let h = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toUpperCase()}` : null;
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="field field-inline">
      <label htmlFor={id}>{label}</label>
      <div className="color-pair">
        <input type="color" aria-label={`${label} picker`} value={normalizeHex(value) ?? '#ffffff'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <input
          id={id}
          className="hex"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            const n = normalizeHex(e.target.value);
            if (n) onChange(n);
          }}
          onBlur={() => setText(value)}
        />
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <button id={id} type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
          <span />
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="field field-inline">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      {label && <div className="field-label">{label}</div>}
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FileButton({ label, accept, onFile, className = 'btn' }: { label: string; accept: string; onFile: (f: File) => void; className?: string }) {
  const id = useId();
  return (
    <>
      <input
        id={id}
        type="file"
        accept={accept}
        className="visually-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <label htmlFor={id} className={className} tabIndex={0} role="button" onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), (e.currentTarget.previousElementSibling as HTMLInputElement).click())}>
        {label}
      </label>
    </>
  );
}
