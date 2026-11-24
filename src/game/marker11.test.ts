import { it, expect } from 'vitest';
import { markerFade } from './missions';
// Round 11: the safehouse marker at spawn washed the whole screen green (camera 4-5 m from a 1.3 m column)
it('a marker column is invisible from a chase camera behind a player standing in it, full from afar', () => {
  expect(markerFade(4.5, 1.3)).toBe(0);
  expect(markerFade(1, 1.3)).toBe(0);
  expect(markerFade(20, 1.3)).toBe(1);
  expect(markerFade(8, 2.6)).toBeGreaterThan(0);
});
