import { describe, it, expect } from 'vitest';
import { sweepEvery, sweepNow, sweepSubsteps } from './sweepLod';

describe('sweep rate policy', () => {
  it('sweeps every frame when very near and on screen', () => {
    expect(sweepEvery(2 * 2, true)).toBe(1);
    expect(sweepEvery(2.9 * 2.9, true)).toBe(1);
  });
  it('thins out off screen and with distance', () => {
    expect(sweepEvery(10 * 10, true)).toBe(2);
    expect(sweepEvery(30 * 30, true)).toBe(2);
    expect(sweepEvery(60 * 60, true)).toBe(3);
    expect(sweepEvery(10 * 10, false)).toBe(2);
    expect(sweepEvery(30 * 30, false)).toBe(4);
    expect(sweepEvery(60 * 60, false)).toBe(6);
    expect(sweepEvery(100 * 100, true)).toBe(6);
  });
  it('never sweeps less often off screen than on screen at the same distance', () => {
    for (let d = 1; d < 120; d += 1) expect(sweepEvery(d * d, false)).toBeGreaterThanOrEqual(sweepEvery(d * d, true));
  });
  it('staggers by id so the work spreads evenly', () => {
    for (const every of [2, 4]) {
      const counts = new Array(every).fill(0);
      for (let id = 0; id < 8; id++) for (let t = 0; t < every; t++) if (sweepNow(t, id, every)) counts[t]++;
      expect(Math.max(...counts) - Math.min(...counts)).toBe(0);
      for (let id = 0; id < 8; id++) { let n = 0; for (let t = 0; t < 40; t++) if (sweepNow(t, id, every)) n++; expect(n).toBe(40 / every); }
    }
    // every 6th: 12 fighters spread two per frame
    for (let t = 0; t < 6; t++) { let n = 0; for (let id = 0; id < 12; id++) if (sweepNow(t, id, 6)) n++; expect(n).toBe(2); }
    expect(sweepNow(5, 3, 1)).toBe(true);
  });
});

describe('no-tunnel clamp', () => {
  it('never lets one sub-sweep travel more than maxTravel', () => {
    for (const speed of [1.5, 6, 9, 14]) for (const dt of [1 / 60, 2 / 60, 4 / 60, 0.1]) {
      const n = sweepSubsteps(dt, speed, 0.25);
      expect(n).toBeGreaterThanOrEqual(1);
      if (n < 6) expect(dt * speed / n).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });
  it('does not split a slow or single step, and caps the count', () => {
    expect(sweepSubsteps(1 / 60, 3, 0.25)).toBe(1);
    expect(sweepSubsteps(0, 9, 0.25)).toBe(1);
    expect(sweepSubsteps(1, 100, 0.25)).toBe(6);
    expect(sweepSubsteps(4 / 60, 9, 0.25)).toBe(3);
  });
});
