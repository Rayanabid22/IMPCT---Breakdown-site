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
  { id: 'grid16', name: '16 Highlights', blurb: 'Sixteen moments in a full 4x4 grid.' },
  { id: 'storyboard', name: 'Storyboard + Result', blurb: 'Storyboard frames slide by in sync with the final video.' },
  { id: 'bts', name: 'BTS + Result', blurb: 'Behind the scenes and the final video, playing in sync.' },
];

export const templateName = (id: TemplateId) => TEMPLATES.find((t) => t.id === id)?.name ?? id;

/** Templates whose output is a set of looping highlight tiles of a chosen length. */
export const isHighlights = (id: TemplateId) => id === 'grid4' || id === 'grid16' || id === 'ring';
/** Templates whose tiles fill the frame edge to edge, separated only by thin lines. */
export const isEdgeToEdge = isHighlights;
/** Templates that use the section list (breakdown labels, storyboard frames). */
export const usesSegments = (id: TemplateId) => id === 'breakdown' || id === 'storyboard';

export function clipCount(tpl: Pick<TemplateState, 'id' | 'ringCount'>): number {
  switch (tpl.id) {
    case 'grid4':
      return 4;
    case 'grid16':
      return 16;
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
  s.layout = { ...s.layout, gap: 14, margin: 28 };
  switch (id) {
    case 'grid4':
    case 'grid16':
      s.canvas = { w: 1920, h: 1080 };
      s.card = { ...s.card, radius: 0, border: false, shadow: false };
      s.layout = { ...s.layout, line: 2, lineColor: '#000000' };
      break;
    case 'ring':
      // The middle is open background with the logo, styled like the breakdown look.
      s.canvas = { w: 1920, h: 1080 };
      s.background = { ...from.background };
      s.glow = { ...from.glow, on: true, offsetY: 0, radius: 300, stretch: 2.4 };
      s.card = { ...s.card, radius: 0, border: false, shadow: false };
      s.layout = { ...s.layout, line: 2, lineColor: '#000000' };
      s.logo = { ...s.logo, size: 110 };
      break;
    case 'launch2':
      s.canvas = { w: 1440, h: 1080 };
      s.card.radius = 18;
      s.layout = { ...s.layout, gap: 18, margin: 36 };
      break;
    case 'storyboard':
    case 'bts':
      s.canvas = { w: 1080, h: 1080 };
      s.card = { ...s.card, radius: 22, border: true, borderColor: '#FFFFFF', borderOpacity: 0.22, borderWidth: 1.5 };
      s.layout = { ...s.layout, gap: 24, margin: 36 };
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
  /** Divider lines between edge-to-edge tiles: x1, y1, x2, y2 (center line). */
  lines: [number, number, number, number][];
}

const AR = 9 / 16;

/** Splits 0..total into n whole-pixel pieces that add up exactly. */
const cuts = (total: number, n: number) => Array.from({ length: n + 1 }, (_, i) => Math.round((i * total) / n));

/**
 * Edge to edge grid: no margin, no gaps, tiles share edges. On a 16:9 canvas every tile is exactly
 * 16:9 (2x2 and 4x4 of 16:9 make 16:9); on other canvases clips are cover-fitted into the cells.
 */
function fillGrid(W: number, H: number, cols: number, rows: number) {
  const xs = cuts(W, cols);
  const ys = cuts(H, rows);
  const tiles: Rect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push({ x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r] });
  const lines: TemplateLayout['lines'] = [];
  for (let c = 1; c < cols; c++) lines.push([xs[c], 0, xs[c], H]);
  for (let r = 1; r < rows; r++) lines.push([0, ys[r], W, ys[r]]);
  return { tiles, lines };
}

/**
 * 6-8 Highlights: a row of 16:9 tiles across the top, another across the bottom, both edge to
 * edge; the logo band in the middle takes the remaining height. 6 = 3 + 3, 7 = 4 + 3, 8 = 4 + 4.
 */
function ring(W: number, H: number, n: number) {
  const top = n === 6 ? 3 : 4;
  const bottom = n - top;
  const row = (count: number, fromBottom: boolean) => {
    const xs = cuts(W, count);
    const h = Math.round((W / count) * AR);
    const y = fromBottom ? H - h : 0;
    return { h, tiles: Array.from({ length: count }, (_, i): Rect => ({ x: xs[i], y, w: xs[i + 1] - xs[i], h })), xs, y };
  };
  const t = row(top, false);
  const b = row(bottom, true);
  const lines: TemplateLayout['lines'] = [
    [0, t.h, W, t.h],
    [0, b.y, W, b.y],
  ];
  for (let i = 1; i < top; i++) lines.push([t.xs[i], 0, t.xs[i], t.h]);
  for (let i = 1; i < bottom; i++) lines.push([b.xs[i], b.y, b.xs[i], H]);
  return { tiles: [...t.tiles, ...b.tiles], logo: { x: 0, y: t.h, w: W, h: Math.max(0, b.y - t.h) } as Rect, lines };
}

export function computeTemplateLayout(style: Style, tpl: TemplateState): TemplateLayout {
  const { w: W, h: H } = style.canvas;
  const s = Math.min(W, H) / 1080;
  const m = style.layout.margin * s;
  const g = style.layout.gap * s;
  const out: TemplateLayout = { s, tiles: [], main: null, secondary: null, logo: null, headings: [], strip: null, lines: [] };
  const hs = style.heading.size * s;
  const hg = style.heading.gap * s;

  switch (tpl.id) {
    case 'grid4':
    case 'grid16': {
      const n = tpl.id === 'grid4' ? 2 : 4;
      Object.assign(out, fillGrid(W, H, n, n));
      break;
    }
    case 'ring': {
      Object.assign(out, ring(W, H, clipCount(tpl)));
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
