import type { Style } from '../types';

/** Reference stage the specs were measured on. */
export const REF_W = 1440;
export const REF_H = 1080;
const SIDE = 78;
const TOP = 100;
const CARD_H = (1284 * 9) / 16;
/** Everything on the reference stage that is not the card, vertically. */
const NON_CARD = REF_H - CARD_H;
const WAVE_GAP = 12;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  /** Scale from reference px to canvas px. */
  s: number;
  card: Rect;
  row: Rect;
  wave: Rect;
  logo: { x: number; y: number; size: number };
}

export function computeLayout(style: Style): Layout {
  const { w: W, h: H } = style.canvas;
  const s = Math.min(W / REF_W, H / REF_H);
  const cardW = Math.min(W - 2 * SIDE * s, ((H - NON_CARD * s) * 16) / 9);
  const cardH = (cardW * 9) / 16;
  const extraY = Math.max(0, H - (cardH + NON_CARD * s));
  const cardX = (W - cardW) / 2;
  const cardY = TOP * s + extraY / 2;
  const rowY = cardY + cardH + style.rowOffset * s;
  const rowH = style.boxes.height * s;
  const waveY = rowY + rowH + WAVE_GAP * s;
  return {
    s,
    card: { x: cardX, y: cardY, w: cardW, h: cardH },
    row: { x: cardX, y: rowY, w: cardW, h: rowH },
    wave: { x: cardX, y: waveY, w: cardW, h: style.waveform.height * s },
    logo: { x: style.logo.x * s, y: style.logo.y * s, size: style.logo.size * s },
  };
}

export const CANVAS_SIZES: { label: string; w: number; h: number }[] = [
  { label: '1440 x 1080 (4:3)', w: 1440, h: 1080 },
  { label: '1080 x 1080 (1:1)', w: 1080, h: 1080 },
  { label: '1080 x 1350 (4:5)', w: 1080, h: 1350 },
  { label: '1920 x 1080 (16:9)', w: 1920, h: 1080 },
];
