import { describe, expect, it } from 'vitest';
import { estimateBytes, outputSize, videoBitrate } from './export';

describe('export sizing', () => {
  it('4K doubles every canvas size and keeps dimensions even', () => {
    expect(outputSize({ w: 1440, h: 1080 }, 2)).toEqual({ w: 2880, h: 2160 });
    expect(outputSize({ w: 1920, h: 1080 }, 2)).toEqual({ w: 3840, h: 2160 });
    expect(outputSize({ w: 1080, h: 1350 }, 2)).toEqual({ w: 2160, h: 2700 });
    expect(outputSize({ w: 1440, h: 1080 }, 1)).toEqual({ w: 1440, h: 1080 });
  });

  it('keeps HD bitrates and grows 4K bitrate slower than pixel count', () => {
    expect(videoBitrate(1440, 1080, 'high')).toBe(14_000_000);
    const k = videoBitrate(2880, 2160, 'high');
    expect(k).toBeGreaterThan(2 * 14_000_000);
    expect(k).toBeLessThan(4 * 14_000_000);
    // A 60s 4K High export stays well under X's 512 MB limit.
    expect(estimateBytes(60, 2880, 2160, 'high')).toBeLessThan(400 * 1024 * 1024);
  });
});
