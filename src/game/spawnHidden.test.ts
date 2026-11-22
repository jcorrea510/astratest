import { it, expect } from 'vitest';
import { spawnHidden } from './crowd';
it('people and cars never pop into view nearby (Round 8: they appeared right in front of the player)', () => {
  expect(spawnHidden(66, true)).toBe(true);
  expect(spawnHidden(120, true)).toBe(true);
  expect(spawnHidden(66, false)).toBe(false);
  expect(spawnHidden(180, true)).toBe(false);
});
