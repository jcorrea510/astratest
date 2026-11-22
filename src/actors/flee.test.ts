import { it, expect } from 'vitest';
import { fleeHeading } from './npc';
// a road along x (|z| < 4); the person stands on the pavement at z = 6
const at = (z0: number) => (a: number, r: number) => Math.abs(z0 + Math.cos(a) * r) < 4;
it('a fleeing person on the pavement runs along it instead of into the road (Round 8)', () => {
  const k = fleeHeading(Math.PI, at(6), false); // "away" points straight into the road (-z)
  expect(k).not.toBeNull();
  expect(Math.abs(6 + Math.cos(k!) * 2.5)).toBeGreaterThanOrEqual(4);
  expect(fleeHeading(0, at(6), false)).toBeNull(); // away from the road already: unchanged
});
it('someone standing in the road heads for the nearest kerb', () => {
  const k = fleeHeading(Math.PI / 2, at(2.5), true);
  expect(k).not.toBeNull(); expect(Math.cos(k!)).toBeGreaterThan(0.3); // towards +z, the near kerb
});
