import { describe, it, expect } from 'vitest';
import { shouldSkipRaf, nearestLamps } from './frameUtil';

describe('shouldSkipRaf', () => {
  it('skips every other callback on a 120 Hz display only', () => {
    expect(shouldSkipRaf(8.3, 8.3)).toBe(true);
    expect(shouldSkipRaf(16.6, 8.3)).toBe(false);
    expect(shouldSkipRaf(8.3, 16.6)).toBe(false);
    expect(shouldSkipRaf(11.1, 11.1)).toBe(false); // 90 Hz untouched
  });
});
describe('nearestLamps', () => {
  it('returns the n nearest, nearest first, reusing the output array', () => {
    const heads = [10, 3, 7, 1, 20, 5].map(x => ({ x, y: 0, z: 0 }));
    const out: { i: number; d: number }[] = [];
    const r = nearestLamps(heads, { x: 0, y: 0, z: 0 }, 3, out);
    expect(r).toBe(out);
    expect(r.map(e => e.i)).toEqual([3, 1, 5]);
    expect(nearestLamps(heads.slice(0, 2), { x: 0, y: 0, z: 0 }, 8, out).map(e => e.i)).toEqual([1, 0]);
  });
});

// Lead review: the rAF-rate average must be fed callback-to-callback gaps, or a 120 Hz display alternates 8.3/16.7 ms
// gaps (skip, draw) whose average (12.5) switches the skip off again: it would flip between 60 and 120 fps.
it('a steady 120 Hz display keeps skipping every other callback', () => {
  let ema = 16.7, lastRaf = 0, last = 0, drawn = 0;
  for (let k = 1; k <= 240; k++) {
    const now = k * 8.333; ema = ema * 0.9 + (now - lastRaf) * 0.1; lastRaf = now;
    if (shouldSkipRaf(now - last, ema)) continue;
    last = now; if (k > 120) drawn++;
  }
  expect(drawn).toBeGreaterThanOrEqual(58); expect(drawn).toBeLessThanOrEqual(62);
});
