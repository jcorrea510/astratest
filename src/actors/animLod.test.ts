import { describe, it, expect } from 'vitest';
import { animEvery } from './animLod';

describe('skeleton update rate', () => {
  it('is every frame up close, 30 Hz mid range, rarer far and off screen', () => {
    expect(animEvery(3, true, false)).toBe(0);
    expect(animEvery(3.9, true, false)).toBe(0);
    expect(animEvery(5, true, false)).toBeCloseTo(0.025);
    expect(animEvery(30, true, false)).toBeCloseTo(0.025);
    expect(animEvery(50, true, false)).toBeCloseTo(0.025);
    expect(animEvery(70, true, false)).toBeCloseTo(0.05);
    expect(animEvery(120, true, false)).toBeCloseTo(0.1);
    expect(animEvery(5, false, false)).toBeCloseTo(0.4);
  });
  it('a ragdoll keeps the on-screen rate even when off screen', () => {
    expect(animEvery(3, false, true)).toBe(0);
  });
  it('a 60 Hz game updates the mid range every 2nd frame', () => {
    let acc = 0, n = 0; for (let f = 0; f < 60; f++) { acc += 1 / 60; if (acc >= animEvery(30, true, false)) { acc = 0; n++; } }
    expect(n).toBe(30);
  });
});
