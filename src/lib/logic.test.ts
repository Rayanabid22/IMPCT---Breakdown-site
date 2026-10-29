import { describe, expect, it } from 'vitest';
import { formatTime, frameCount, parseTime, playheadTime } from './time';
import {
  activeIndex,
  computeBoxes,
  deleteSegment,
  makeEvenSegments,
  moveBoundary,
  normalizeSegments,
  playheadX,
  rescaleSegments,
  setSegmentEnd,
  setSegmentStart,
  snapTargets,
  snapTime,
  splitSegment,
} from './segments';
import { computeLayout } from './layout';
import { BLUE, mergeStyle, ORANGE } from './presets';

const contiguous = (segs: { start: number; end: number }[], duration: number) => {
  expect(segs[0].start).toBe(0);
  expect(segs[segs.length - 1].end).toBeCloseTo(duration, 9);
  for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end);
};

describe('time parsing', () => {
  it('parses plain seconds', () => {
    expect(parseTime('12.4')).toBeCloseTo(12.4);
    expect(parseTime('7')).toBe(7);
    expect(parseTime('.5')).toBe(0.5);
    expect(parseTime('12,5')).toBe(12.5);
  });
  it('parses m:ss.s', () => {
    expect(parseTime('0:12.4')).toBeCloseTo(12.4);
    expect(parseTime('1:05')).toBe(65);
  });
  it('parses mm:ss:ff at 30fps', () => {
    expect(parseTime('00:12:12')).toBeCloseTo(12.4);
    expect(parseTime('01:00:15')).toBeCloseTo(60.5);
  });
  it('rejects junk', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('0:75')).toBeNull();
    expect(parseTime('00:01:30')).toBeNull();
    expect(parseTime('1:2:3:4')).toBeNull();
    expect(parseTime('-3')).toBeNull();
  });
  it('formats m:ss.ff', () => {
    expect(formatTime(12.4)).toBe('0:12.40');
    expect(formatTime(65.256)).toBe('1:05.26');
    expect(formatTime(59.999)).toBe('1:00.00');
    expect(formatTime(0)).toBe('0:00.00');
  });
});

describe('segments', () => {
  it('splits evenly across the duration', () => {
    const s = makeEvenSegments(['Hook', 'Body', 'Features', 'CTA'], 30);
    expect(s.map((x) => x.end)).toEqual([7.5, 15, 22.5, 30]);
    contiguous(s, 30);
  });

  it('moves a boundary, resizing both neighbors', () => {
    const s = makeEvenSegments(['A', 'B', 'C'], 30);
    const m = moveBoundary(s, 1, 12);
    expect(m[0].end).toBe(12);
    expect(m[1].start).toBe(12);
    contiguous(m, 30);
  });

  it('enforces the 0.5s minimum and never crosses', () => {
    const s = makeEvenSegments(['A', 'B', 'C'], 30);
    expect(moveBoundary(s, 1, 25)[1].start).toBe(19.5);
    expect(moveBoundary(s, 1, -4)[0].end).toBe(0.5);
    expect(moveBoundary(s, 2, 5)[2].start).toBe(10.5);
  });

  it('keeps neighbors contiguous when typing start/end', () => {
    const s = makeEvenSegments(['A', 'B', 'C', 'D'], 40);
    const r1 = setSegmentEnd(s, 1, 22);
    expect(r1.segments[1].end).toBe(22);
    expect(r1.segments[2].start).toBe(22);
    expect(r1.message).toBeUndefined();
    contiguous(r1.segments, 40);
    const r2 = setSegmentStart(r1.segments, 3, 31);
    expect(r2.segments[2].end).toBe(31);
    contiguous(r2.segments, 40);
    const r3 = setSegmentEnd(s, 0, 100);
    expect(r3.message).toBeTruthy();
    expect(r3.segments[0].end).toBe(19.5);
    expect(setSegmentStart(s, 0, 3).message).toBeTruthy();
    expect(setSegmentEnd(s, 3, 3).message).toBeTruthy();
  });

  it('rescales proportionally', () => {
    const s = moveBoundary(makeEvenSegments(['A', 'B'], 30), 1, 10);
    const r = rescaleSegments(s, 30, 60);
    expect(r[0].end).toBe(20);
    contiguous(r, 60);
  });

  it('splits at the playhead, or in half when outside', () => {
    const s = makeEvenSegments(['A', 'B'], 20);
    const a = splitSegment(s, 0, 4);
    expect(a.length).toBe(3);
    expect(a[0].end).toBe(4);
    contiguous(a, 20);
    const b = splitSegment(s, 0, 15);
    expect(b[0].end).toBe(5);
  });

  it('deletes and merges into the neighbor', () => {
    const s = makeEvenSegments(['A', 'B', 'C'], 30);
    const d = deleteSegment(s, 1);
    expect(d.map((x) => x.label)).toEqual(['A', 'C']);
    contiguous(d, 30);
    const d0 = deleteSegment(s, 0);
    contiguous(d0, 30);
    expect(deleteSegment([s[0]], 0).length).toBe(1);
  });

  it('snaps to playhead and half seconds', () => {
    expect(snapTime(4.93, snapTargets(4.93, null), 0.1)).toBe(5);
    expect(snapTime(4.93, snapTargets(4.93, 4.9), 0.1)).toBe(4.9);
    expect(snapTime(4.7, snapTargets(4.7, null), 0.1)).toBe(4.7);
  });

  it('normalizes saved segments', () => {
    const n = normalizeSegments(
      [
        { id: 'b', label: 'B', start: 9, end: 20 },
        { id: 'a', label: 'A', start: 0.2, end: 10 },
      ],
      21,
    );
    expect(n.map((x) => x.id)).toEqual(['a', 'b']);
    contiguous(n, 21);
  });
});

describe('playhead', () => {
  const segs = makeEvenSegments(['A', 'B', 'C', 'D'], 40);
  const boxes = computeBoxes(segs, 78, 1284, 7);

  it('box widths are proportional and fill the row', () => {
    const last = boxes[boxes.length - 1];
    expect(last.x + last.w).toBeCloseTo(78 + 1284);
    expect(boxes[0].w).toBeCloseTo(boxes[1].w);
  });

  it('stays inside the active box, never in a gap', () => {
    for (let t = 0; t <= 40; t += 0.01) {
      const i = activeIndex(segs, t);
      const x = playheadX(segs, boxes, t);
      expect(x).toBeGreaterThanOrEqual(boxes[i].x - 1e-9);
      expect(x).toBeLessThanOrEqual(boxes[i].x + boxes[i].w + 1e-9);
    }
  });

  it('starts at the left of the first box and ends at the right of the last', () => {
    expect(playheadX(segs, boxes, 0)).toBe(78);
    expect(playheadX(segs, boxes, 40)).toBeCloseTo(1362);
  });

  it('lands exactly on the end at the final frame', () => {
    const fps = 30000 / 1001;
    const d = 31.2;
    const n = frameCount(d, fps);
    const lastT = (n - 1) / fps;
    expect(playheadTime(lastT, d, fps)).toBeCloseTo(d, 9);
    expect(playheadTime(0, d, fps)).toBe(0);
    // Monotonic and within a frame of real time.
    expect(Math.abs(playheadTime(10, d, fps) - 10)).toBeLessThan(1 / fps);
  });

  it('moves the playhead within a box linearly', () => {
    const x = playheadX(segs, boxes, 5);
    expect(x).toBeCloseTo(boxes[0].x + boxes[0].w / 2);
  });
});

describe('layout', () => {
  it('matches the reference measurements at 1440x1080', () => {
    const L = computeLayout(ORANGE.style);
    expect(L.card).toEqual({ x: 78, y: 100, w: 1284, h: 722.25 });
    expect(L.row.y).toBeCloseTo(887.25);
    expect(L.row.h).toBe(76);
    const B = computeLayout(BLUE.style);
    expect(B.row.y).toBeCloseTo(908.25);
  });

  it('keeps the card 16:9 and inside the canvas for every size', () => {
    for (const [w, h] of [
      [1080, 1080],
      [1080, 1350],
      [1920, 1080],
    ]) {
      const L = computeLayout({ ...ORANGE.style, canvas: { w, h } });
      expect(L.card.w / L.card.h).toBeCloseTo(16 / 9);
      expect(L.card.x).toBeGreaterThan(0);
      expect(L.wave.y + L.wave.h).toBeLessThanOrEqual(h);
    }
  });
});

describe('saved styles', () => {
  it('projects saved before border colors existed get the defaults', () => {
    const old = { boxes: { fillOpacity: 0.2, borderOpacity: 0.5 } } as unknown as Parameters<typeof mergeStyle>[0];
    const s = mergeStyle(old);
    expect(s.boxes.fillOpacity).toBe(0.2);
    expect(s.boxes.borderColor).toBe('#FFFFFF');
    expect(s.boxes.fillColor).toBe('#FFFFFF');
    expect(s.boxes.borderWidth).toBe(1.5);
    expect(s.boxes.labelWeight).toBe(400);
  });
});
