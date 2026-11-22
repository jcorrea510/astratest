import { it, expect } from 'vitest';
import * as THREE from 'three';
import { yawOfQuat } from './vehicle';
it('yawOfQuat matches the heading of a rotated car, also when pitched/rolled (camera follows the drawn car, Round 8)', () => {
  for (const yaw of [-2.5, -0.3, 0, 1.2, 3]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, yaw, -0.04, 'YXZ'));
    expect(yawOfQuat(q)).toBeCloseTo(yaw, 1);
  }
});
