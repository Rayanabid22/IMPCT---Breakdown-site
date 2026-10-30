import { describe, expect, it } from 'vitest';
import { clipTime, computeTemplateLayout, defaultTemplateState, evenClips, initTemplate, outputDuration, randomClips, rescaleClips, storyboardPosition, templateStyle, type Rect } from './templates';
import type { TemplateId } from '../types';

const inside = (r: Rect, W: number, H: number) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= W + 0.01 && r.y + r.h <= H + 0.01;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

function layoutFor(id: TemplateId, extra: Partial<ReturnType<typeof defaultTemplateState>> = {}, canvas?: { w: number; h: number }) {
  const style = templateStyle(id);
  if (canvas) style.canvas = canvas;
  const tpl = initTemplate({ ...defaultTemplateState(id), ...extra }, 40);
  return { L: computeTemplateLayout(style, tpl), style, tpl };
}

describe('template layouts', () => {
  const sizes = [
    { w: 1440, h: 1080 },
    { w: 1080, h: 1080 },
    { w: 1080, h: 1350 },
    { w: 1920, h: 1080 },
  ];
  for (const id of ['grid4', 'grid12', 'ring', 'launch2', 'storyboard', 'bts'] as TemplateId[]) {
    it(`${id}: every card fits on the canvas, is 16:9, no overlaps, at every size`, () => {
      for (const c of sizes) {
        const { L } = layoutFor(id, {}, c);
        const rects = [...L.tiles, ...(L.main ? [L.main] : []), ...(L.secondary ? [L.secondary] : []), ...(L.logo ? [L.logo] : [])];
        expect(rects.length).toBeGreaterThan(0);
        for (const r of rects) {
          expect(inside(r, c.w, c.h)).toBe(true);
          if (r !== L.logo) expect(r.h / r.w).toBeCloseTo(9 / 16);
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
      }
    });
  }

  it('highlight tiles are exactly 16:9 in whole pixels, at HD and 4K', () => {
    for (const id of ['grid4', 'grid12', 'ring'] as TemplateId[]) {
      for (const n of [6, 7, 8]) {
        for (const c of sizes) {
          const { L } = layoutFor(id, { ringCount: n }, c);
          for (const t of L.tiles) {
            expect(t.w * 9).toBe(t.h * 16);
            expect(Number.isInteger(t.x) && Number.isInteger(t.y) && Number.isInteger(t.w)).toBe(true);
          }
          // All tiles in a template are the same size.
          expect(new Set(L.tiles.map((t) => `${t.w}x${t.h}`)).size).toBe(1);
        }
      }
    }
  });

  it('6-8 Highlights: rows on top and bottom, logo band in the middle', () => {
    const rows = (n: number) => {
      const { L } = layoutFor('ring', { ringCount: n });
      const top = L.tiles.filter((t) => t.y < L.logo!.y).length;
      const bottom = L.tiles.filter((t) => t.y > L.logo!.y).length;
      return { top, bottom, L };
    };
    expect(rows(6)).toMatchObject({ top: 3, bottom: 3 });
    expect(rows(7)).toMatchObject({ top: 4, bottom: 3 });
    expect(rows(8)).toMatchObject({ top: 4, bottom: 4 });
    for (const n of [6, 7, 8]) {
      const { L } = rows(n);
      const xs = L.tiles.map((t) => t.x);
      const left = Math.min(...xs);
      const right = Math.max(...L.tiles.map((t) => t.x + t.w));
      // The band spans the rows, and rows are centered on the canvas.
      expect(L.logo!.x).toBe(left);
      expect(L.logo!.x + L.logo!.w).toBe(right);
      expect(Math.abs(left + right - 1920)).toBeLessThanOrEqual(1);
    }
  });

  it('tile counts match the template', () => {
    expect(layoutFor('grid4').L.tiles.length).toBe(4);
    expect(layoutFor('grid12').L.tiles.length).toBe(12);
    expect(layoutFor('launch2').L.tiles.length).toBe(2);
    for (const n of [6, 7, 8]) {
      const { L } = layoutFor('ring', { ringCount: n });
      expect(L.tiles.length).toBe(n);
      expect(L.logo).not.toBeNull();
    }
  });

  it('bts puts BTS on top by default and swaps with its label', () => {
    const a = layoutFor('bts').L;
    expect(a.secondary!.y).toBeLessThan(a.main!.y);
    expect(a.headings[0].text).toBe('BTS:');
    const b = layoutFor('bts', { swap: true }).L;
    expect(b.main!.y).toBeLessThan(b.secondary!.y);
    expect(b.headings[0].text).toBe('Result:');
  });

  it('bts cards are the same size; storyboard result is bigger than a storyboard frame', () => {
    const a = layoutFor('bts').L;
    expect(a.main!.w).toBeCloseTo(a.secondary!.w);
    const s = layoutFor('storyboard').L;
    expect(s.main!.w).toBeGreaterThan(s.strip!.frameW);
  });
});

describe('clips', () => {
  it('even split covers the video and sets duration', () => {
    const c = evenClips(4, 40);
    expect(c.map((x) => [x.start, x.end])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 40],
    ]);
    const t = initTemplate(defaultTemplateState('grid4'), 40);
    expect(t.duration).toBe(10);
    expect(outputDuration(t, 40)).toBe(10);
    expect(outputDuration(defaultTemplateState('bts'), 40)).toBe(40);
  });

  it('loops inside its range', () => {
    const clip = { id: 'a', sourceId: 'main', start: 10, end: 15 };
    expect(clipTime(clip, 0)).toBe(10);
    expect(clipTime(clip, 4.5)).toBeCloseTo(14.5);
    expect(clipTime(clip, 5)).toBeCloseTo(10);
    expect(clipTime(clip, 12)).toBeCloseTo(12);
  });

  it('random loops stay inside the video and have the asked length', () => {
    for (let k = 0; k < 50; k++) {
      for (const c of randomClips(2, 30, 5)) {
        expect(c.start).toBeGreaterThanOrEqual(0);
        expect(c.end).toBeLessThanOrEqual(30);
        expect(c.end - c.start).toBeCloseTo(5);
      }
    }
    const [a, b] = randomClips(2, 30, 5, () => 0.5);
    expect(a.start).not.toBe(b.start);
    expect(randomClips(1, 3, 5)[0].end).toBeLessThanOrEqual(3);
  });

  it('rescales main clips only', () => {
    const r = rescaleClips(
      [
        { id: 'a', sourceId: 'main', start: 10, end: 20 },
        { id: 'b', sourceId: 'asset_x', start: 1, end: 2 },
      ],
      40,
      80,
    );
    expect(r[0]).toMatchObject({ start: 20, end: 40 });
    expect(r[1]).toMatchObject({ start: 1, end: 2 });
  });
});

describe('storyboard position', () => {
  const starts = [0, 4, 8];
  it('holds each frame, then slides into the next right before it starts', () => {
    expect(storyboardPosition(starts, 0)).toBe(0);
    expect(storyboardPosition(starts, 3)).toBe(0);
    const mid = storyboardPosition(starts, 4 - 0.225);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(storyboardPosition(starts, 4)).toBe(1);
    expect(storyboardPosition(starts, 100)).toBe(2);
  });
});
