import { it, expect, describe } from 'vitest';
import { isThreatening, needsAimTrace } from './playerCombat';
it('reloading or carrying a gun is not aiming at people; aiming or a recent shot is (Round 8: random hands up)', () => {
  expect(isThreatening(false, false, 9)).toBe(false);
  expect(isThreatening(true, false, 9)).toBe(true);
  expect(isThreatening(false, true, 9)).toBe(true);
  expect(isThreatening(false, false, 0.5)).toBe(true);
});

describe('needsAimTrace', () => {
  it('skips the dry aim ray only while seated in a car without drive-by aim', () => {
    expect(needsAimTrace(false, false, true)).toBe(true);
    expect(needsAimTrace(true, false, true)).toBe(false);
    expect(needsAimTrace(true, true, true)).toBe(true);
    expect(needsAimTrace(true, false, false)).toBe(true);
  });
});
