/** Format seconds as m:ss.ff (hundredths), e.g. 0:12.40 */
export function formatTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const totalHundredths = Math.round(t * 100);
  const m = Math.floor(totalHundredths / 6000);
  const s = Math.floor((totalHundredths % 6000) / 100);
  const h = totalHundredths % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(h).padStart(2, '0')}`;
}

/**
 * Parse a user typed time. Accepted:
 *   "12.4"      seconds
 *   "0:12.4"    minutes:seconds
 *   "00:12:12"  minutes:seconds:frames (frames at 30fps)
 * Returns null when the text can't be understood.
 */
export function parseTime(input: string, framesPerSecond = 30): number | null {
  const text = input.trim().replace(',', '.');
  if (!text) return null;
  const parts = text.split(':');
  if (parts.length > 3) return null;
  const num = (p: string) => (/^\d+(\.\d*)?$|^\.\d+$/.test(p) ? parseFloat(p) : NaN);

  let value: number;
  if (parts.length === 1) {
    value = num(parts[0]);
  } else if (parts.length === 2) {
    const m = num(parts[0]);
    const s = num(parts[1]);
    if (!Number.isInteger(m) || s >= 60) return null;
    value = m * 60 + s;
  } else {
    const m = num(parts[0]);
    const s = num(parts[1]);
    const f = num(parts[2]);
    if (!Number.isInteger(m) || !Number.isInteger(s) || !Number.isInteger(f)) return null;
    if (s >= 60 || f >= framesPerSecond) return null;
    value = m * 60 + s + f / framesPerSecond;
  }
  return Number.isFinite(value) ? value : null;
}

export function fpsValue(fps: 29.97 | 30): number {
  return fps === 29.97 ? 30000 / 1001 : 30;
}

/** Number of output frames for a duration. Frame i is shown at time i / fps. */
export function frameCount(duration: number, fps: number): number {
  return Math.max(1, Math.round(duration * fps));
}

/**
 * Time used for the playhead. Stretched slightly so the final frame lands exactly on the end of
 * the last box, instead of one frame short.
 */
export function playheadTime(t: number, duration: number, fps: number): number {
  if (duration <= 0) return 0;
  const lastFrameTime = (frameCount(duration, fps) - 1) / fps;
  if (lastFrameTime <= 0) return 0;
  return Math.min(duration, Math.max(0, (t * duration) / lastFrameTime));
}
