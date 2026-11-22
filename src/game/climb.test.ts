import { it, expect } from 'vitest';
import * as THREE from 'three';
import { climbPose } from './orders';
it('a passenger climbs in over ~1.1 s through the door gap instead of popping onto the seat (Round 8)', () => {
  const from = new THREE.Vector3(-1.6, 0, 0.2), gap = new THREE.Vector3(-1.0, 0.3, 0), to = new THREE.Vector3(-0.4, 0.35, 0), o = new THREE.Vector3();
  expect(climbPose(0, from, gap, to, o)).toBeLessThan(0.1); expect(o.distanceTo(from)).toBeLessThan(1e-6);
  climbPose(0.4, from, gap, to, o); expect(o.distanceTo(gap)).toBeLessThan(1e-6);
  const mid = climbPose(0.75, from, gap, to, o); expect(mid).toBeLessThan(1); expect(o.x).toBeGreaterThan(gap.x); expect(o.x).toBeLessThan(to.x);
  expect(climbPose(1.1, from, gap, to, o)).toBe(1); expect(o.distanceTo(to)).toBeLessThan(1e-6);
});
