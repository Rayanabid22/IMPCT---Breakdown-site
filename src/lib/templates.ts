import { MAIN, type Clip, type Style, type TemplateId, type TemplateState } from '../types';
import { cloneStyle, ORANGE } from './presets';
import { newId } from './segments';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  blurb: string;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'breakdown', name: 'Breakdown', blurb: 'Video card with labeled sections and a moving playhead.' },
  { id: 'grid4', name: '4 Highlights', blurb: 'Four moments from the launch video in a 2x2 grid.' },
  { id: 'ring', name: '6-8 Highlights', blurb: 'Highlights above and below your logo, on a styled background.' },
  { id: 'launch2', name: 'Launch + 2 Highlights', blurb: 'The full video on top, two looping highlights below.' },
  { id: 'grid12', name: '12 Highlights', blurb: 'Twelve moments in a 4x3 grid.' },
  { id: 'storyboard', name: 'Storyboard + Result', blurb: 'Storyboard frames slide by in sync with the final video.' },
  { id: 'bts', name: 'BTS + Result', blurb: 'Behind the scenes and the final video, playing in sync.' },
];

export const templateName = (id: TemplateId) => TEMPLATES.find((t) => t.id === id)?.name ?? id;

/** Templates whose output is a set of looping highlight tiles of a chosen length. */
export const isHighlights = (id: TemplateId) => id === 'grid4' || id === 'grid12' || id === 'ring';
/** Templates that use the section list (breakdown labels, storyboard frames). */
export const usesSegments = (id: TemplateId) => id === 'breakdown' || id === 'storyboard';

export function clipCount(tpl: Pick<TemplateState, 'id' | 'ringCount'>): number {
  switch (tpl.id) {
    case 'grid4':
      return 4;
    case 'grid12':
      return 12;
    case 'ring':
      return Math.max(6, Math.min(8, tpl.ringCount));
    case 'launch2':
      return 2;
    default:
      return 0;
  }
}

export function defaultTemplateState(id: TemplateId = 'breakdown'): TemplateState {
  return {
    id,
    duration: 0,
    clips: [],
    ringCount: 8,
    loopLength: 5,
    audio: { sourceId: MAIN, offset: 0 },
    secondary: { sourceId: null, offset: 0 },
    headings: id === 'storyboard' ? { top: 'Storyboard:', bottom: 'Result:' } : { top: 'BTS:', bottom: 'Result:' },
    swap: false,
    sources: {},
  };
}

/** Evenly spaced pieces of the main video, one per tile. Each plays for duration/n. */
export function evenClips(n: number, mainDuration: number): Clip[] {
  const len = mainDuration / Math.max(1, n);
  return Array.from({ length: n }, (_, i) => ({ id: newId('clip'), sourceId: MAIN, start: i * len, end: (i + 1) * len }));
}

/** Random, non-identical loops of `len` seconds from the main video. */
export function randomClips(n: number, mainDuration: number, len: number, rand = Math.random): Clip[] {
  const l = Math.min(len, mainDuration);
  const room = Math.max(0, mainDuration - l);
  // Spread the picks over the video so the loops show different moments.
  return Array.from({ length: n }, (_, i) => {
    const start = room * ((i + rand()) / n);
    return { id: newId('clip'), sourceId: MAIN, start, end: start + l };
  });
}

/** Fresh tiles and duration for a template, given the main video length. */
export function initTemplate(tpl: TemplateState, mainDuration: number): TemplateState {
  const n = clipCount(tpl);
  if (tpl.id === 'launch2') return { ...tpl, clips: randomClips(2, mainDuration, tpl.loopLength) };
  if (isHighlights(tpl.id)) {
    const clips = evenClips(n, mainDuration);
    return { ...tpl, clips, duration: Math.max(1, mainDuration / n) };
  }
  return { ...tpl, clips: [] };
}

/** Output length of the post. */
export function outputDuration(tpl: TemplateState, mainDuration: number): number {
  return isHighlights(tpl.id) ? Math.max(0.5, tpl.duration) : mainDuration;
}

/** Where in its source a looping clip is at output time t. */
export function clipTime(clip: Clip, t: number): number {
  const len = clip.end - clip.start;
  if (len <= 0.0001) return clip.start;
  const m = t % len;
  return clip.start + (m < 0 ? m + len : m);
}

/** Rescale main-video clips to a new main duration (when a different launch video is uploaded). */
export function rescaleClips(clips: Clip[], oldDuration: number, newDuration: number): Clip[] {
  if (oldDuration <= 0) return clips;
  const k = newDuration / oldDuration;
  return clips.map((c) => (c.sourceId === MAIN ? { ...c, start: c.start * k, end: Math.min(newDuration, c.end * k) } : c));
}

/** Style a template starts with. Breakdown keeps its own presets. */
export function templateStyle(id: TemplateId, from: Style = ORANGE.style): Style {
  const s = cloneStyle(from);
  if (id === 'breakdown') return s;
  s.background = { ...s.background, type: 'solid', color: '#000000' };
  s.glow = { ...s.glow, on: false };
  s.grid = { ...s.grid, on: false };
  s.waveform = { ...s.waveform, on: false };
  s.logo = { ...s.logo, show: false };
  s.card = { ...s.card, shadow: false, border: false, radius: 14 };
  s.layout = { gap: 14, margin: 28 };
  switch (id) {
    case 'grid4':
    case 'grid12':
      s.canvas = { w: 1920, h: 1080 };
      s.card.radius = id === 'grid12' ? 10 : 14;
      s.layout = { gap: id === 'grid12' ? 12 : 16, margin: 24 };
      break;
    case 'ring':
      // The middle is open background with the logo, styled like the breakdown look.
      s.canvas = { w: 1920, h: 1080 };
      s.background = { ...from.background };
      s.glow = { ...from.glow, on: true, offsetY: 0, radius: 300, stretch: 2.4 };
      s.card.radius = 12;
      s.card.shadow = true;
      s.layout = { gap: 14, margin: 40 };
      s.logo = { ...s.logo, size: 90 };
      break;
    case 'launch2':
      s.canvas = { w: 1440, h: 1080 };
      s.card.radius = 18;
      s.layout = { gap: 18, margin: 36 };
      break;
    case 'storyboard':
    case 'bts':
      s.canvas = { w: 1080, h: 1080 };
      s.card = { ...s.card, radius: 22, border: true, borderColor: '#FFFFFF', borderOpacity: 0.22, borderWidth: 1.5 };
      s.layout = { gap: 24, margin: 36 };
      break;
  }
  return s;
}

// ---------------- layouts ----------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Heading {
  text: string;
  /** Center x and baseline y. */
  x: number;
  y: number;
  size: number;
}

export interface TemplateLayout {
  /** Scale from 1080-reference px to canvas px. */
  s: number;
  /** One rect per clip, in clip order (grids, ring, launch2 loops). */
  tiles: Rect[];
  /** Card for the main video (launch2, storyboard result, bts). */
  main: Rect | null;
  /** Card for the BTS recording. */
  secondary: Rect | null;
  /** Ring template: where the logo goes. */
  logo: Rect | null;
  headings: Heading[];
  /** Storyboard filmstrip: visible band, and the size of each frame. */
  strip: { band: Rect; frameW: number; frameH: number; gap: number; centerX: number } | null;
}

const AR = 9 / 16;

/**
 * Exactly 16:9 tiles, as big as fit, centered; the background shows around them. Tile size is a
 * whole multiple of 16x9 px and positions are whole pixels, so tiles stay exactly 16:9 in the
 * export at HD and 4K.
 */
function tileSize(W: number, H: number, cols: number, rows: number, m: number, g: number) {
  const maxW = Math.min((W - 2 * m - (cols - 1) * g) / cols, ((H - 2 * m - (rows - 1) * g) / rows) / AR);
  const k = Math.max(1, Math.floor(maxW / 16));
  return { w: 16 * k, h: 9 * k };
}

function grid(W: number, H: number, cols: number, rows: number, m: number, g: number) {
  const gap = Math.round(g);
  const { w: cellW, h: cellH } = tileSize(W, H, cols, rows, m, gap);
  const gw = cols * cellW + (cols - 1) * gap;
  const gh = rows * cellH + (rows - 1) * gap;
  const x0 = Math.round((W - gw) / 2);
  const y0 = Math.round((H - gh) / 2);
  const cell = (c: number, r: number, span = 1): Rect => ({ x: x0 + c * (cellW + gap), y: y0 + r * (cellH + gap), w: span * cellW + (span - 1) * gap, h: cellH });
  return { cell, cellW, cellH };
}

/**
 * 6-8 Highlights: a row of tiles on top, the logo band in the middle, a row at the bottom.
 * 6 = 3 + 3, 7 = 4 + 3 (bottom row centered), 8 = 4 + 4.
 */
function ring(W: number, H: number, n: number, m: number, g: number) {
  const top = n === 6 ? 3 : 4;
  const bottom = n - top;
  const cols = Math.max(top, bottom);
  const gap = Math.round(g);
  const { w, h } = tileSize(W, H, cols, 3, m, gap);
  const gw = cols * w + (cols - 1) * gap;
  const gh = 3 * h + 2 * gap;
  const x0 = Math.round((W - gw) / 2);
  const y0 = Math.round((H - gh) / 2);
  const row = (count: number, y: number) => {
    const rw = count * w + (count - 1) * gap;
    const rx = Math.round((W - rw) / 2);
    return Array.from({ length: count }, (_, i): Rect => ({ x: rx + i * (w + gap), y, w, h }));
  };
  return {
    tiles: [...row(top, y0), ...row(bottom, y0 + 2 * (h + gap))],
    logo: { x: x0, y: y0 + h + gap, w: gw, h } as Rect,
  };
}

export function computeTemplateLayout(style: Style, tpl: TemplateState): TemplateLayout {
  const { w: W, h: H } = style.canvas;
  const s = Math.min(W, H) / 1080;
  const m = style.layout.margin * s;
  const g = style.layout.gap * s;
  const out: TemplateLayout = { s, tiles: [], main: null, secondary: null, logo: null, headings: [], strip: null };
  const hs = style.heading.size * s;
  const hg = style.heading.gap * s;

  switch (tpl.id) {
    case 'grid4': {
      const G = grid(W, H, 2, 2, m, g);
      out.tiles = [G.cell(0, 0), G.cell(1, 0), G.cell(0, 1), G.cell(1, 1)];
      break;
    }
    case 'grid12': {
      const G = grid(W, H, 4, 3, m, g);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) out.tiles.push(G.cell(c, r));
      break;
    }
    case 'ring': {
      const R = ring(W, H, clipCount(tpl), m, g);
      out.tiles = R.tiles;
      out.logo = R.logo;
      break;
    }
    case 'launch2': {
      const w = Math.min(W - 2 * m, ((H - 2 * m - g * (23 / 32)) * 32) / 27);
      const total = w * (27 / 32) + g * (23 / 32);
      const x = (W - w) / 2;
      const y = (H - total) / 2;
      out.main = { x, y, w, h: w * AR };
      const bw = (w - g) / 2;
      const by = y + w * AR + g;
      out.tiles = [
        { x, y: by, w: bw, h: bw * AR },
        { x: x + bw + g, y: by, w: bw, h: bw * AR },
      ];
      break;
    }
    case 'storyboard': {
      // Center storyboard frame is 62% of the unit width, the result card 78%.
      const fixed = 2 * (hs + hg) + g;
      const u = Math.min((W - 2 * m) / 0.78, (H - 2 * m - fixed) / ((0.62 + 0.78) * AR));
      const fw = 0.62 * u;
      const rw = 0.78 * u;
      const total = fixed + (fw + rw) * AR;
      let y = (H - total) / 2;
      out.headings.push({ text: tpl.headings.top, x: W / 2, y: y + hs * 0.8, size: hs });
      y += hs + hg;
      out.strip = { band: { x: m, y, w: W - 2 * m, h: fw * AR }, frameW: fw, frameH: fw * AR, gap: g, centerX: W / 2 };
      y += fw * AR + g;
      out.headings.push({ text: tpl.headings.bottom, x: W / 2, y: y + hs * 0.8, size: hs });
      y += hs + hg;
      out.main = { x: (W - rw) / 2, y, w: rw, h: rw * AR };
      break;
    }
    case 'bts': {
      const fixed = 2 * (hs + hg) + g;
      const cw = Math.min(W - 2 * m, (H - 2 * m - fixed) / (2 * AR));
      const total = fixed + 2 * cw * AR;
      let y = (H - total) / 2;
      const x = (W - cw) / 2;
      const top: Rect = { x, y: y + hs + hg, w: cw, h: cw * AR };
      const bottom: Rect = { x, y: top.y + top.h + g + hs + hg, w: cw, h: cw * AR };
      // headings.top labels the BTS card and headings.bottom the result, wherever they sit.
      out.headings.push({ text: tpl.swap ? tpl.headings.bottom : tpl.headings.top, x: W / 2, y: y + hs * 0.8, size: hs });
      y = top.y + top.h + g;
      out.headings.push({ text: tpl.swap ? tpl.headings.top : tpl.headings.bottom, x: W / 2, y: y + hs * 0.8, size: hs });
      // Top shows BTS by default; swap puts the result on top.
      out.secondary = tpl.swap ? bottom : top;
      out.main = tpl.swap ? top : bottom;
      break;
    }
    case 'breakdown':
      break;
  }
  return out;
}

/** Storyboard: continuous position along the strip (0 = first frame centered), easing into each frame. */
export function storyboardPosition(starts: number[], t: number, transition = 0.45): number {
  if (starts.length === 0) return 0;
  let i = 0;
  while (i + 1 < starts.length && t >= starts[i + 1]) i++;
  const next = starts[i + 1];
  if (next === undefined) return i;
  // Slide during the last `transition` seconds before the next frame starts.
  const p = (t - (next - transition)) / transition;
  if (p <= 0) return i;
  const e = p >= 1 ? 1 : p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  return i + e;
}
