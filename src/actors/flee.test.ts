import { describe, it, expect } from 'vitest';
import { fleeHeading, kerbEscape } from './npc';
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

describe('kerb escape (Round 12)', () => {
  const roads = [{ axis: 'x' as const, coord: 0, half: 8, from: -242, to: -158 }, { axis: 'z' as const, coord: -150, half: 8, from: 10, to: 90 }];
  it('a walker re-anchored in the middle of a block steps square to the nearer kerb, not diagonally to a corner 30 m off', () => {
    const d = { x: 0, z: 0 };
    expect(kerbEscape(roads, -155.7, 43.2, d)).toBe(true); expect(d).toEqual({ x: -1, z: 0 }); // the case that sat in the avenue for a minute
    expect(kerbEscape(roads, -155.7, 61.6, d, -160.2, 89.8)).toBe(true); // headed for a corner node: mostly kerbwards, sliding along any parked cars
    expect(d.x).toBeLessThan(-0.7); expect(d.z).toBeGreaterThan(0.5); expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 6);
    expect(kerbEscape(roads, -200, -7.2, d, -160, -10)).toBe(true); expect(d).toEqual({ x: 0, z: -1 }); // near the kerb: straight at it (at an angle they slid down the gutter)
    expect(kerbEscape(roads, -200, 3, d)).toBe(true); expect(d).toEqual({ x: 0, z: 1 });
    expect(kerbEscape(roads, -200, -7.8, d)).toBe(true); // hugging the gutter counts too (CI: 20 m along it to a corner)
    expect(kerbEscape(roads, -200, -8.5, d)).toBe(false); // half a metre up on the footpath
    expect(kerbEscape(roads, -150, 0, d)).toBe(false); // inside a junction: crossings own it
    expect(kerbEscape(roads, -200, -10.2, d)).toBe(false); // on the footpath
  });
});
