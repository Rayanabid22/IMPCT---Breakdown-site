import type { Segment } from '../types';

export const MIN_SEGMENT = 0.5;

let idCounter = 0;
export function newId(prefix = 'seg'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Split [0, duration] evenly between the given labels. */
export function makeEvenSegments(labels: string[], duration: number): Segment[] {
  const n = Math.max(1, labels.length);
  return labels.map((label, i) => ({
    id: newId(),
    label,
    start: (duration * i) / n,
    end: i === n - 1 ? duration : (duration * (i + 1)) / n,
  }));
}

/** Rescale all boundaries proportionally to a new duration. */
export function rescaleSegments(segments: Segment[], oldDuration: number, newDuration: number): Segment[] {
  if (segments.length === 0) return segments;
  const total = oldDuration > 0 ? oldDuration : segments[segments.length - 1].end;
  if (total <= 0) return makeEvenSegments(segments.map((s) => s.label), newDuration);
  const k = newDuration / total;
  const out = segments.map((s, i) => ({
    ...s,
    start: i === 0 ? 0 : s.start * k,
    end: i === segments.length - 1 ? newDuration : s.end * k,
  }));
  for (let i = 1; i < out.length; i++) out[i].start = out[i - 1].end;
  return out;
}

/** Bounds a boundary (between segment i-1 and i) can move within. */
export function boundaryLimits(segments: Segment[], index: number): [number, number] {
  const left = segments[index - 1];
  const right = segments[index];
  return [left.start + MIN_SEGMENT, right.end - MIN_SEGMENT];
}

/**
 * Move the boundary at `index` (start of segment `index`, end of segment `index - 1`).
 * Clamped so neither neighbor drops under the minimum length.
 */
export function moveBoundary(segments: Segment[], index: number, time: number): Segment[] {
  if (index <= 0 || index >= segments.length) return segments;
  const [lo, hi] = boundaryLimits(segments, index);
  const t = lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, time));
  return segments.map((s, i) => {
    if (i === index - 1) return { ...s, end: t };
    if (i === index) return { ...s, start: t };
    return s;
  });
}

export interface EditResult {
  segments: Segment[];
  /** Set when the requested value had to be changed to keep the timeline valid. */
  message?: string;
}

/** Set a segment's start. The first segment always starts at 0. */
export function setSegmentStart(segments: Segment[], index: number, time: number): EditResult {
  if (index === 0) {
    return { segments, message: time !== 0 ? 'The first section always starts at 0:00.00' : undefined };
  }
  const next = moveBoundary(segments, index, time);
  const actual = next[index].start;
  return { segments: next, message: Math.abs(actual - time) > 1e-6 ? clampMessage(actual) : undefined };
}

/** Set a segment's end. The last segment always ends at the video's end. */
export function setSegmentEnd(segments: Segment[], index: number, time: number): EditResult {
  if (index === segments.length - 1) {
    const end = segments[index].end;
    return { segments, message: Math.abs(time - end) > 1e-6 ? 'The last section always ends with the video.' : undefined };
  }
  const next = moveBoundary(segments, index + 1, time);
  const actual = next[index].end;
  return { segments: next, message: Math.abs(actual - time) > 1e-6 ? clampMessage(actual) : undefined };
}

function clampMessage(actual: number): string {
  return `Adjusted to ${actual.toFixed(2)}s so every section stays at least ${MIN_SEGMENT}s long.`;
}

/** Split a segment at time t. Falls back to the middle if t is outside or too close to an edge. */
export function splitSegment(segments: Segment[], index: number, t: number): Segment[] {
  const s = segments[index];
  if (!s) return segments;
  if (s.end - s.start < MIN_SEGMENT * 2) return segments;
  let at = t;
  if (!(at > s.start + MIN_SEGMENT - 1e-9 && at < s.end - MIN_SEGMENT + 1e-9)) {
    at = (s.start + s.end) / 2;
  }
  const a: Segment = { ...s, end: at };
  const b: Segment = { id: newId(), label: 'New', start: at, end: s.end };
  return [...segments.slice(0, index), a, b, ...segments.slice(index + 1)];
}

/** Delete a segment, merging its time into a neighbor (previous one if possible). */
export function deleteSegment(segments: Segment[], index: number): Segment[] {
  if (segments.length <= 1 || !segments[index]) return segments;
  const s = segments[index];
  const out = segments.filter((_, i) => i !== index);
  if (index > 0) {
    out[index - 1] = { ...out[index - 1], end: s.end };
  } else {
    out[0] = { ...out[0], start: 0 };
  }
  return out;
}

/** Index of the segment containing t (the last segment owns the very end). */
export function activeIndex(segments: Segment[], t: number): number {
  if (segments.length === 0) return -1;
  for (let i = 0; i < segments.length; i++) {
    if (t < segments[i].end) return i;
  }
  return segments.length - 1;
}

export interface BoxRect {
  x: number;
  w: number;
}

/** Box geometry along x. Width is proportional to duration, minus the cosmetic gap. */
export function computeBoxes(segments: Segment[], x0: number, width: number, gap: number): BoxRect[] {
  const n = segments.length;
  if (n === 0) return [];
  const total = segments[n - 1].end - segments[0].start;
  const usable = Math.max(0, width - gap * (n - 1));
  let x = x0;
  return segments.map((s) => {
    const w = total > 0 ? (usable * (s.end - s.start)) / total : usable / n;
    const r = { x, w };
    x += w + gap;
    return r;
  });
}

/** Playhead x: always inside the active box, never in a gap. */
export function playheadX(segments: Segment[], boxes: BoxRect[], t: number): number {
  const i = activeIndex(segments, t);
  if (i < 0) return boxes[0]?.x ?? 0;
  const s = segments[i];
  const b = boxes[i];
  const len = s.end - s.start;
  const p = len > 0 ? Math.min(1, Math.max(0, (t - s.start) / len)) : 0;
  return b.x + p * b.w;
}

/** Snap a time to the closest target within a tolerance. */
export function snapTime(t: number, targets: number[], tolerance: number): number {
  let best = t;
  let bestDist = tolerance;
  for (const target of targets) {
    const d = Math.abs(target - t);
    if (d <= bestDist) {
      bestDist = d;
      best = target;
    }
  }
  return best;
}

/** Snap candidates: the playhead plus every whole 0.5s mark near t. */
export function snapTargets(t: number, playhead: number | null): number[] {
  const half = Math.round(t * 2) / 2;
  const targets = [half, half - 0.5, half + 0.5];
  if (playhead !== null) targets.unshift(playhead);
  return targets;
}

/** Make sure segments are contiguous and cover [0, duration]. Used when loading saved data. */
export function normalizeSegments(segments: Segment[], duration: number): Segment[] {
  if (segments.length === 0) return segments;
  const sorted = [...segments].sort((a, b) => a.start - b.start).map((s) => ({ ...s }));
  sorted[0].start = 0;
  for (let i = 1; i < sorted.length; i++) sorted[i].start = sorted[i - 1].end;
  if (duration > 0) sorted[sorted.length - 1].end = duration;
  return sorted;
}
