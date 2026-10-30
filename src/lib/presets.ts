import type { Style } from '../types';

export interface Preset {
  id: string;
  name: string;
  builtIn?: boolean;
  labels: string[];
  style: Style;
}

export const DEFAULT_LABELS = ['Hook', 'Body', 'Features', 'CTA'];

export const FONTS = ['Inter', 'DM Sans', 'Manrope', 'Space Grotesk', 'Poppins'];

const base: Style = {
  canvas: { w: 1440, h: 1080 },
  fps: 29.97,
  background: {
    type: 'solid',
    color: '#FF5A00',
    gradient: { from: '#FF5A00', to: '#FF9A3D', kind: 'linear', angle: 180, cx: 0.5, cy: 0.85 },
    assetId: null,
    fit: 'cover',
    overlay: 0,
  },
  glow: { on: true, color: '#FFD24A', intensity: 0.75, radius: 360, offsetY: 30, stretch: 2.2 },
  grid: { on: false, size: 2, spacing: 12, opacity: 0.06 },
  waveform: { on: true, color: '#FFFFFF', opacity: 0.45, barWidth: 3, spacing: 10, height: 100, highlight: true },
  logo: { show: true, mode: 'text', text: 'Impct.', assetId: null, size: 38, x: 54, y: 52, color: '#FFFFFF' },
  card: { radius: 14, border: false, borderColor: '#FFFFFF', borderOpacity: 0.35, borderWidth: 1.5, shadow: true },
  boxes: {
    fillColor: '#FFFFFF',
    fillOpacity: 0.1,
    borderColor: '#FFFFFF',
    borderOpacity: 0.4,
    borderWidth: 1.5,
    radius: 8,
    gap: 7,
    height: 76,
    font: 'Inter',
    labelSize: 28,
    labelWeight: 400,
    labelColor: '#FFFFFF',
    labelOpacity: 0.9,
    activeHighlight: false,
  },
  playhead: { color: '#FFFFFF', size: 24, lineWidth: 1.5 },
  layout: { gap: 14, margin: 28 },
  heading: { size: 44, color: '#FFFFFF', weight: 400, gap: 20 },
  rowOffset: 65,
};

export const ORANGE: Preset = {
  id: 'builtin-orange',
  name: 'Orange / Waveform',
  builtIn: true,
  labels: ['Intro', 'Features', 'Integration', 'Features', 'Outro'],
  style: base,
};

export const BLUE: Preset = {
  id: 'builtin-blue',
  name: 'Blue / Grid',
  builtIn: true,
  labels: ['Intro', 'Demo', 'Features', 'Pricing + Outro'],
  style: {
    ...base,
    background: { ...base.background, type: 'solid', color: '#05070D' },
    glow: { on: true, color: '#1E6BFF', intensity: 0.95, radius: 330, offsetY: 150, stretch: 2.6 },
    grid: { on: true, size: 2, spacing: 12, opacity: 0.06 },
    waveform: { ...base.waveform, on: false },
    card: { ...base.card, border: true, shadow: false },
    rowOffset: 86,
  },
};

export const BUILT_IN_PRESETS: Preset[] = [ORANGE, BLUE];

export function cloneStyle(style: Style): Style {
  return JSON.parse(JSON.stringify(style));
}

/** Fill in any fields missing from older saved styles. */
export function mergeStyle(partial: Partial<Style> | undefined): Style {
  const d = cloneStyle(base);
  if (!partial) return d;
  const out = { ...d } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(partial)) {
    const dv = (d as unknown as Record<string, unknown>)[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && dv && typeof dv === 'object') {
      out[k] = { ...(dv as object), ...(v as object) };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  const s = out as unknown as Style;
  s.background.gradient = { ...d.background.gradient, ...(partial.background?.gradient ?? {}) };
  return s;
}
