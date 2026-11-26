import { describe, it, expect } from 'vitest';
import { holdEvery, holdNow, animEvery } from './animLod';

describe('animation LOD rate policy', () => {
  it('solves the gun IK every frame close and on screen, thinner further out, rarely off screen', () => {
    expect(holdEvery(7 * 7, true)).toBe(1);
    expect(holdEvery(19 * 19, true)).toBe(2);
    expect(holdEvery(30 * 30, true)).toBe(4);
    expect(holdEvery(40 * 40, true)).toBe(4);
    expect(holdEvery(5 * 5, false)).toBe(24); // behind the camera: not even close ones pay
  });
  it('staggers solves by id: exactly one in `every` frames per character, and different characters land on different frames', () => {
    for (const every of [1, 2, 4, 8]) {
      let n = 0; for (let t = 0; t < 64; t++) if (holdNow(t, 3, every)) n++;
      expect(n).toBe(64 / every);
    }
    const frames = (id: number) => { const s: number[] = []; for (let t = 0; t < 8; t++) if (holdNow(t, id, 4)) s.push(t); return s.join(); };
    expect(frames(0)).not.toBe(frames(1));
  });
});

describe('skeleton update rate', () => {
  it('is every frame up close, 30 Hz mid range, rarer far and off screen', () => {
    expect(animEvery(8, true, false)).toBe(0);
    expect(animEvery(11.9, true, false)).toBe(0);
    expect(animEvery(30, true, false)).toBeCloseTo(0.025);
    expect(animEvery(50, true, false)).toBeCloseTo(0.025);
    expect(animEvery(70, true, false)).toBeCloseTo(0.05);
    expect(animEvery(120, true, false)).toBeCloseTo(0.1);
    expect(animEvery(5, false, false)).toBeCloseTo(0.4);
  });
  it('a ragdoll keeps the on-screen rate even when off screen', () => {
    expect(animEvery(5, false, true)).toBe(0);
  });
  it('a 60 Hz game updates the mid range every 2nd frame', () => {
    let acc = 0, n = 0; for (let f = 0; f < 60; f++) { acc += 1 / 60; if (acc >= animEvery(30, true, false)) { acc = 0; n++; } }
    expect(n).toBe(30);
  });
});
