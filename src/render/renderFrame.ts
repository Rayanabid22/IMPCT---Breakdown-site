import type { FrameSource, RenderAssets, Segment, Style } from '../types';
import { computeLayout, type Layout } from '../lib/layout';
import { activeIndex, computeBoxes, playheadX, type BoxRect } from '../lib/segments';
import { playheadTime } from '../lib/time';

export interface RenderState {
  style: Style;
  segments: Segment[];
  duration: number;
  assets: RenderAssets;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
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

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draw an image into a rect with cover or contain fit. */
function drawFitted(ctx: Ctx, img: CanvasImageSource, iw: number, ih: number, r: { x: number; y: number; w: number; h: number }, fit: 'cover' | 'contain') {
  if (!iw || !ih) return;
  const scale = fit === 'cover' ? Math.max(r.w / iw, r.h / ih) : Math.min(r.w / iw, r.h / ih);
  if (fit === 'cover') {
    const sw = r.w / scale;
    const sh = r.h / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
  } else {
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  }
}

function imageSize(img: CanvasImageSource): [number, number] {
  const anyImg = img as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  if (anyImg.naturalWidth) return [anyImg.naturalWidth, anyImg.naturalHeight ?? 0];
  if (anyImg.videoWidth) return [anyImg.videoWidth, anyImg.videoHeight ?? 0];
  if (anyImg.displayWidth) return [anyImg.displayWidth, anyImg.displayHeight ?? 0];
  const w = typeof anyImg.width === 'number' ? anyImg.width : 0;
  const h = typeof anyImg.height === 'number' ? anyImg.height : 0;
  return [w, h];
}

export function fontString(px: number, family: string, weight = 400): string {
  return `${weight} ${px}px "${family}", Inter, system-ui, sans-serif`;
}

// ---------- static pieces ----------

function drawBackground(ctx: Ctx, style: Style, assets: RenderAssets, bgFrame: FrameSource | null) {
  const { w: W, h: H } = style.canvas;
  const bg = style.background;
  ctx.fillStyle = bg.color;
  ctx.fillRect(0, 0, W, H);
  if (bg.type === 'gradient') {
    const g = bg.gradient;
    let grad: CanvasGradient;
    if (g.kind === 'linear') {
      const a = ((g.angle - 90) * Math.PI) / 180;
      const len = Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a));
      const cx = W / 2;
      const cy = H / 2;
      grad = ctx.createLinearGradient(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
    } else {
      const cx = g.cx * W;
      const cy = g.cy * H;
      const r = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
      grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    }
    grad.addColorStop(0, g.from);
    grad.addColorStop(1, g.to);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else if (bg.type === 'image' && assets.bgImage) {
    const [iw, ih] = imageSize(assets.bgImage);
    drawFitted(ctx, assets.bgImage, iw, ih, { x: 0, y: 0, w: W, h: H }, bg.fit);
  } else if (bg.type === 'video' && bgFrame) {
    drawFitted(ctx, bgFrame.image, bgFrame.width, bgFrame.height, { x: 0, y: 0, w: W, h: H }, bg.fit);
  }
  if ((bg.type === 'image' || bg.type === 'video') && bg.overlay > 0) {
    ctx.fillStyle = `rgba(0,0,0,${bg.overlay})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawGlow(ctx: Ctx, style: Style, L: Layout) {
  const g = style.glow;
  if (!g.on || g.intensity <= 0) return;
  const cx = L.row.x + L.row.w / 2;
  const cy = L.row.y + L.row.h / 2 + g.offsetY * L.s;
  const r = g.radius * L.s;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(g.stretch, 1);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  const a = g.intensity;
  grad.addColorStop(0, hexToRgba(g.color, a));
  grad.addColorStop(0.35, hexToRgba(g.color, a * 0.6));
  grad.addColorStop(0.7, hexToRgba(g.color, a * 0.18));
  grad.addColorStop(1, hexToRgba(g.color, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

function drawGrid(ctx: Ctx, style: Style, L: Layout) {
  const g = style.grid;
  if (!g.on || g.opacity <= 0) return;
  const { w: W, h: H } = style.canvas;
  const sp = Math.max(4, g.spacing * L.s);
  const r = (g.size * L.s) / 2;
  ctx.fillStyle = `rgba(255,255,255,${g.opacity})`;
  ctx.beginPath();
  for (let y = sp / 2; y < H; y += sp) {
    for (let x = sp / 2; x < W; x += sp) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function drawLogo(ctx: Ctx, style: Style, assets: RenderAssets, L: Layout) {
  const lg = style.logo;
  const { x, y, size } = L.logo;
  if (lg.mode === 'image' && assets.logoImage) {
    const [iw, ih] = imageSize(assets.logoImage);
    if (!iw || !ih) return;
    const h = size;
    const w = (iw / ih) * h;
    ctx.drawImage(assets.logoImage, x, y - h / 2, w, h);
    return;
  }
  // Text fallback: solid triangle "A" mark + monospace wordmark.
  const triH = size;
  const triW = size * 1.08;
  const top = y - triH / 2;
  ctx.fillStyle = lg.color;
  ctx.beginPath();
  ctx.moveTo(x + triW / 2, top);
  ctx.lineTo(x + triW, top + triH);
  ctx.lineTo(x + triW * 0.62, top + triH);
  ctx.lineTo(x + triW / 2, top + triH * 0.74);
  ctx.lineTo(x + triW * 0.38, top + triH);
  ctx.lineTo(x, top + triH);
  ctx.closePath();
  ctx.fill();
  if (lg.text) {
    const fontPx = size / 0.73;
    ctx.font = `500 ${fontPx}px "JetBrains Mono", "IBM Plex Mono", monospace`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(lg.text, x + triW + size * 0.38, top + triH);
  }
}

function barValues(peaks: Float32Array | null, n: number): Float32Array {
  const out = new Float32Array(n);
  if (!peaks || peaks.length === 0) {
    out.fill(0.08);
    return out;
  }
  let max = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * peaks.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length));
    let sum = 0;
    for (let j = a; j < b; j++) sum += peaks[j] * peaks[j];
    const v = Math.sqrt(sum / (b - a));
    out[i] = v;
    if (v > max) max = v;
  }
  for (let i = 0; i < n; i++) out[i] = max > 0 ? Math.pow(out[i] / max, 0.8) : 0;
  return out;
}

interface WaveBars {
  xs: number[];
  hs: number[];
  w: number;
  cy: number;
}

function computeWave(style: Style, assets: RenderAssets, L: Layout): WaveBars {
  const wf = style.waveform;
  const bw = Math.max(1, wf.barWidth * L.s);
  const sp = Math.max(bw + 1, wf.spacing * L.s);
  const n = Math.max(1, Math.floor((L.wave.w - bw) / sp) + 1);
  const offset = (L.wave.w - ((n - 1) * sp + bw)) / 2;
  const vals = barValues(assets.peaks, n);
  const xs: number[] = [];
  const hs: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(L.wave.x + offset + i * sp);
    hs.push(Math.max(bw, vals[i] * L.wave.h));
  }
  return { xs, hs, w: bw, cy: L.wave.y + L.wave.h / 2 };
}

function drawBars(ctx: Ctx, bars: WaveBars, from: number, to: number) {
  ctx.beginPath();
  for (let i = from; i < to; i++) {
    const h = bars.hs[i];
    roundRectPath(ctx, bars.xs[i], bars.cy - h / 2, bars.w, h, bars.w / 2);
  }
  ctx.fill();
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const labelFitCache = new Map<string, { font: string; text: string }>();

/** Call after web fonts load, since text measurements change. */
export function clearLabelCache() {
  labelFitCache.clear();
}

function fitLabel(ctx: Ctx, label: string, family: string, sizePx: number, maxW: number, minPx: number): { font: string; text: string } {
  const key = `${label}|${family}|${sizePx.toFixed(2)}|${maxW.toFixed(1)}|${minPx.toFixed(2)}`;
  const hit = labelFitCache.get(key);
  if (hit) return hit;
  let px = sizePx;
  ctx.font = fontString(px, family);
  let w = ctx.measureText(label).width;
  if (w > maxW) {
    px = Math.max(minPx, (px * maxW) / w);
    ctx.font = fontString(px, family);
    w = ctx.measureText(label).width;
  }
  let text = label;
  if (w > maxW) {
    let lo = 0;
    let hi = label.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(label.slice(0, mid).trimEnd() + '…').width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    text = lo > 0 ? label.slice(0, lo).trimEnd() + '…' : '';
  }
  const result = { font: fontString(px, family), text };
  if (labelFitCache.size > 500) labelFitCache.clear();
  labelFitCache.set(key, result);
  return result;
}

function drawBox(ctx: Ctx, style: Style, L: Layout, seg: Segment, box: BoxRect, active: boolean) {
  const b = style.boxes;
  const r = b.radius * L.s;
  const lw = 1.5 * L.s;
  const fill = active ? Math.min(1, b.fillOpacity + 0.08) : b.fillOpacity;
  const border = active ? Math.max(b.borderOpacity, 0.7) : b.borderOpacity;
  roundRect(ctx, box.x + lw / 2, L.row.y + lw / 2, Math.max(0, box.w - lw), L.row.h - lw, r);
  ctx.fillStyle = `rgba(255,255,255,${fill})`;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = `rgba(255,255,255,${border})`;
  ctx.stroke();
  const pad = 12 * L.s;
  const maxW = box.w - pad * 2;
  if (maxW <= 4) return;
  const size = (seg.fontSize ?? b.labelSize) * L.s;
  const fit = fitLabel(ctx, seg.label, b.font, size, maxW, 12 * L.s);
  if (!fit.text) return;
  ctx.font = fit.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hexToRgba(b.labelColor, active ? 1 : b.labelOpacity);
  ctx.fillText(fit.text, box.x + box.w / 2, L.row.y + L.row.h / 2 + size * 0.04);
}

// ---------- cache ----------

export class StaticLayerCache {
  private canvas: AnyCanvas | null = null;
  private key: unknown[] = [];
  wave: WaveBars | null = null;

  invalidate() {
    this.key = [];
  }

  get(state: RenderState, scale: number, L: Layout, boxes: BoxRect[]): AnyCanvas {
    const key = [state.style, state.segments, state.duration, state.assets.peaks, state.assets.logoImage, state.assets.bgImage, scale];
    if (this.canvas && key.every((k, i) => k === this.key[i])) return this.canvas;
    this.key = key;
    const { style } = state;
    const w = Math.round(style.canvas.w * scale);
    const h = Math.round(style.canvas.h * scale);
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) this.canvas = makeCanvas(w, h);
    const ctx = this.canvas.getContext('2d') as Ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (style.background.type !== 'video') drawBackground(ctx, style, state.assets, null);
    drawGlow(ctx, style, L);
    drawGrid(ctx, style, L);
    if (style.card.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 48 * L.s * scale;
      ctx.shadowOffsetY = 14 * L.s * scale;
      ctx.fillStyle = '#000';
      roundRect(ctx, L.card.x, L.card.y, L.card.w, L.card.h, style.card.radius * L.s);
      ctx.fill();
      ctx.restore();
    }
    this.wave = null;
    if (style.waveform.on) {
      this.wave = computeWave(style, state.assets, L);
      ctx.fillStyle = hexToRgba(style.waveform.color, style.waveform.opacity);
      drawBars(ctx, this.wave, 0, this.wave.xs.length);
    }
    drawLogo(ctx, style, state.assets, L);
    state.segments.forEach((seg, i) => drawBox(ctx, style, L, seg, boxes[i], false));
    return this.canvas;
  }
}

// ---------- the one renderer ----------

/**
 * Draws one complete frame. Used by both the preview and the export, so they are identical.
 * `ctx` must already be sized to style.canvas * scale.
 */
export function renderFrame(
  ctx: Ctx,
  state: RenderState,
  time: number,
  video: FrameSource | null,
  cache: StaticLayerCache,
  scale = 1,
  bgVideo: FrameSource | null = null,
) {
  const { style, segments, duration } = state;
  const L = computeLayout(style);
  const boxes = computeBoxes(segments, L.row.x, L.row.w, style.boxes.gap * L.s);
  const fps = style.fps === 29.97 ? 30000 / 1001 : 30;
  const pt = playheadTime(time, duration, fps);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (style.background.type === 'video') {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackground(ctx, style, state.assets, bgVideo);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const layer = cache.get(state, scale, L, boxes);
  ctx.drawImage(layer, 0, 0);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Video card
  const cr = style.card.radius * L.s;
  ctx.save();
  roundRect(ctx, L.card.x, L.card.y, L.card.w, L.card.h, cr);
  ctx.clip();
  ctx.fillStyle = '#0b0b0f';
  ctx.fillRect(L.card.x, L.card.y, L.card.w, L.card.h);
  if (video) drawFitted(ctx, video.image, video.width, video.height, L.card, 'cover');
  ctx.restore();
  if (style.card.border) {
    const bw = style.card.borderWidth * L.s;
    roundRect(ctx, L.card.x + bw / 2, L.card.y + bw / 2, L.card.w - bw, L.card.h - bw, cr);
    ctx.lineWidth = bw;
    ctx.strokeStyle = hexToRgba(style.card.borderColor, style.card.borderOpacity);
    ctx.stroke();
  }

  if (segments.length === 0) return;
  const px = playheadX(segments, boxes, pt);

  // Waveform highlight near the playhead
  const wave = cache.wave;
  if (style.waveform.on && style.waveform.highlight && wave) {
    const reach = 60 * L.s;
    ctx.fillStyle = hexToRgba(style.waveform.color, Math.min(1, style.waveform.opacity + 0.4));
    for (let i = 0; i < wave.xs.length; i++) {
      const d = Math.abs(wave.xs[i] + wave.w / 2 - px);
      if (d > reach) continue;
      ctx.globalAlpha = 1 - d / reach;
      drawBars(ctx, wave, i, i + 1);
    }
    ctx.globalAlpha = 1;
  }

  // Active box highlight
  if (style.boxes.activeHighlight) {
    const i = activeIndex(segments, pt);
    if (i >= 0) drawBox(ctx, style, L, segments[i], boxes[i], true);
  }

  // Playhead
  const ph = style.playhead;
  const tw = ph.size * L.s;
  const th = tw * (20 / 24);
  const tipY = L.row.y - 3 * L.s;
  ctx.fillStyle = ph.color;
  ctx.beginPath();
  ctx.moveTo(px - tw / 2, tipY - th);
  ctx.lineTo(px + tw / 2, tipY - th);
  ctx.lineTo(px, tipY);
  ctx.closePath();
  ctx.fill();
  const lw = ph.lineWidth * L.s;
  ctx.fillRect(px - lw / 2, tipY - 1, lw, L.row.y + L.row.h - tipY + 1);
}
