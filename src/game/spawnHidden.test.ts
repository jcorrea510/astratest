import { it, expect } from 'vitest';
import { spawnHidden } from './crowd';
it('people and cars never pop into view nearby (Round 8: they appeared right in front of the player)', () => {
  expect(spawnHidden(66, true)).toBe(true);
  expect(spawnHidden(120, true)).toBe(true);
  expect(spawnHidden(66, false)).toBe(false);
  expect(spawnHidden(180, true)).toBe(false);
});
import { kerbParking } from './crowd';
it('no kerbside parking on one-lane streets (Round 8: a parked car took half the only lane)', () => {
  expect(kerbParking(1)).toBe(false); expect(kerbParking(2)).toBe(true);
});

import { kerbSlotOk } from './crowd';
it('Round 9: no parked cars in the last 28 m before a junction (the right-turn queue) or 12 m after one', () => {
  expect(kerbSlotOk(60, 84)).toBe(false); expect(kerbSlotOk(5, 84)).toBe(false); expect(kerbSlotOk(30, 84)).toBe(true);
});
