import { it, expect } from 'vitest';
import { aiPedal } from './trafficRules';
it('AI braking is progressive, not full brake for a small overspeed (Round 8: cars slammed on the brakes)', () => {
  expect(aiPedal(-3, 12, 9)).toBeGreaterThan(-0.45); expect(aiPedal(-3, 12, 9)).toBeLessThan(-0.25);
  expect(aiPedal(-10, 15, 5)).toBe(-1); // far too fast: full brake
  expect(aiPedal(4, 6, 10)).toBeCloseTo(1, 1);
  expect(aiPedal(-0.2, 0.2, 0)).toBe(0); // standing at the line
});
