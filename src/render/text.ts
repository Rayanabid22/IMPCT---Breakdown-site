import type { TextLayer } from '../types';
import { newId } from '../lib/segments';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function defaultTextLayer(partial: Partial<TextLayer> = {}): TextLayer {
  return {
    id: newId('text'),
    text: 'Your text',
    font: 'Inter',
    weight: 600,
    size: 72,
    color: '#FFFFFF',
    opacity: 1,
    align: 'center',
    x: 0.5,
    y: 0.5,
    letterSpacing: 0,
    lineHeight: 1.15,
    box: { on: false, color: '#000000', opacity: 0.6, padding: 18, radius: 12 },
    shadow: false,
    start: 0,
    end: null,
    ...partial,
  };
}

export const textVisible = (l: TextLayer, t: number) => t >= l.start && (l.end === null || t < l.end);

export const textFont = (l: TextLayer, px: number) => `${l.weight} ${px}px "${l.font}", Inter, system-ui, sans-serif`;

export interface TextBlock {
  lines: string[];
  widths: number[];
  px: number;
  lineH: number;
  /** Text block, without the background padding. */
  x: number;
  y: number;
  w: number;
  h: number;
  pad: number;
}

function setLetterSpacing(ctx: Ctx, px: number) {
  const c = ctx as Ctx & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

/** Measures a text layer on a canvas of W x H. */
export function measureText(ctx: Ctx, l: TextLayer, W: number, H: number): TextBlock {
  const u = Math.min(W, H) / 1080;
  const px = Math.max(1, l.size * u);
  ctx.font = textFont(l, px);
  setLetterSpacing(ctx, l.letterSpacing * u);
  const lines = (l.text || ' ').split('\n');
  const widths = lines.map((line) => ctx.measureText(line).width);
  const w = Math.max(1, ...widths);
  const lineH = px * l.lineHeight;
  const h = lineH * lines.length;
  const ax = l.x * W;
  const x = l.align === 'left' ? ax : l.align === 'center' ? ax - w / 2 : ax - w;
  setLetterSpacing(ctx, 0);
  return { lines, widths, px, lineH, x, y: l.y * H - h / 2, w, h, pad: l.box.on ? l.box.padding * u : 0 };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function rgba(hex: string, a: number) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Draws every text layer visible at time t, on top of everything else. ctx is in canvas units. */
export function drawTexts(ctx: Ctx, texts: TextLayer[] | undefined, W: number, H: number, t: number, scale: number) {
  if (!texts?.length) return;
  const u = Math.min(W, H) / 1080;
  const snap = (v: number) => Math.round(v * scale) / scale;
  for (const l of texts) {
    if (!textVisible(l, t) || !l.text.trim()) continue;
    const b = measureText(ctx, l, W, H);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, l.opacity));
    if (l.box.on && l.box.opacity > 0) {
      ctx.fillStyle = rgba(l.box.color, l.box.opacity);
      roundRect(ctx, b.x - b.pad, b.y - b.pad, b.w + 2 * b.pad, b.h + 2 * b.pad, l.box.radius * u);
      ctx.fill();
    }
    if (l.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 18 * u * scale;
      ctx.shadowOffsetY = 4 * u * scale;
    }
    ctx.font = textFont(l, b.px);
    setLetterSpacing(ctx, l.letterSpacing * u);
    ctx.fillStyle = l.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    b.lines.forEach((line, i) => {
      const lx = l.align === 'left' ? b.x : l.align === 'center' ? b.x + (b.w - b.widths[i]) / 2 : b.x + b.w - b.widths[i];
      ctx.fillText(line, snap(lx), snap(b.y + b.lineH * (i + 0.5)));
    });
    ctx.restore();
    setLetterSpacing(ctx, 0);
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Bounds of a text layer (with its background padding), for picking and dragging it in the preview. */
export function textBounds(l: TextLayer, W: number, H: number) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const b = measureText(measureCtx!, l, W, H);
  const pad = Math.max(b.pad, 6 * (Math.min(W, H) / 1080));
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}
