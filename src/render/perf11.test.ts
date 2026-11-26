import { it, expect } from 'vitest';
import { adaptStep, newDyn } from './renderer';
import { QUALITY } from '../core/settings';

// Round 11 (owner: "even medium graphics is 30 FPS" on an M1 Air)
it('a game stuck at 30 fps is allowed below native resolution (the floor held it at native down to 26 fps)', () => {
  const s = newDyn(); let now = 0;
  for (let i = 0; i < 60 * 20; i++) { now += 33; adaptStep(s, 33, now, true); }
  expect(s.scale).toBeLessThan(1);
});
it('presets: few real point lights, Medium shadows every other frame', () => {
  expect(QUALITY.low.lightPool).toBeLessThanOrEqual(2);
  expect(QUALITY.medium.lightPool).toBeLessThanOrEqual(4);
  expect(QUALITY.medium.shadowEvery).toBe(2);
  expect(QUALITY.high.shadowEvery).toBe(1);
});
