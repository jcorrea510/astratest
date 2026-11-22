import { it, expect } from 'vitest';
import { keepRight } from './npc';
it('walkers going opposite ways along a path end up on opposite sides (Round 8: they ran into each other)', () => {
  // walking +x: left normal is (0, 1) -> lateral z = keepRight; walking -x: left normal is (0, -1) -> z = -keepRight
  for (const a of [-0.8, -0.2, 0, 0.5]) for (const b of [-0.7, 0, 0.3, 0.8]) {
    const zA = keepRight(a), zB = -keepRight(b);
    expect(zA).toBeLessThan(0); expect(zB).toBeGreaterThan(0); expect(zB - zA).toBeGreaterThan(0.55);
  }
});
