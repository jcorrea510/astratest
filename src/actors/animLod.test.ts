import { describe, it, expect } from 'vitest';
import { holdEvery, holdNow } from './animLod';

describe('animation LOD rate policy', () => {
  it('solves the gun IK every frame close and on screen, thinner further out, rarely off screen', () => {
    expect(holdEvery(10 * 10, true)).toBe(1);
    expect(holdEvery(19 * 19, true)).toBe(1);
    expect(holdEvery(25 * 25, true)).toBe(2);
    expect(holdEvery(40 * 40, true)).toBe(4);
    expect(holdEvery(5 * 5, false)).toBe(8); // behind the camera: not even close ones pay
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
