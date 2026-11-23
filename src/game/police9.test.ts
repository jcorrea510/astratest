import { it, expect } from 'vitest';
import { copsMayShoot, heatLoseTime, HeatState } from './police';
import * as THREE from 'three';

it('Round 9: cops never shoot an unarmed suspect below 5 stars', () => {
  for (const h of [1, 2, 3, 4]) expect(copsMayShoot(h, true, false)).toBe(false);
  expect(copsMayShoot(3, false, true)).toBe(true);
  expect(copsMayShoot(2, false, true)).toBe(false);
  expect(copsMayShoot(2, true, true)).toBe(true);
  expect(copsMayShoot(5, false, false)).toBe(true);
});
it('Round 9: a robbery is two stars and takes ~26 s out of sight to shake', () => {
  const h = new HeatState(); h.add('robbery'); expect(h.heat).toBe(2);
  expect(heatLoseTime(2)).toBeGreaterThanOrEqual(24);
  const far = new THREE.Vector3(500, 0, 500);
  let t = 0; while (h.heat > 0 && t < 120) { h.tick(0.1, false, far); t += 0.1; }
  expect(t).toBeGreaterThan(24);
});
