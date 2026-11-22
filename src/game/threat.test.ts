import { it, expect } from 'vitest';
import { isThreatening } from './playerCombat';
it('reloading or carrying a gun is not aiming at people; aiming or a recent shot is (Round 8: random hands up)', () => {
  expect(isThreatening(false, false, 9)).toBe(false);
  expect(isThreatening(true, false, 9)).toBe(true);
  expect(isThreatening(false, true, 9)).toBe(true);
  expect(isThreatening(false, false, 0.5)).toBe(true);
});
