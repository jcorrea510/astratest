import { describe, it, expect } from 'vitest';
import { CHASE_YAW_RATE } from './camera';
import { dampAngle } from '../core/rng';

describe('chase camera yaw follow', () => {
  it('trails a car taking a 90 degree turn at 1.1 rad/s by less than 0.25 s', () => {
    const dt = 1 / 60; let car = 0, cam = 0, tCar = -1, tCam = -1;
    const mid = Math.PI / 4;
    for (let t = 0; t < 4; t += dt) {
      car = Math.min(Math.PI / 2, car + 1.1 * dt);
      cam = dampAngle(cam, car, CHASE_YAW_RATE, dt);
      if (tCar < 0 && car >= mid) tCar = t;
      if (tCam < 0 && cam >= mid) tCam = t;
    }
    expect(tCam - tCar).toBeLessThan(0.25);
    expect(tCam - tCar).toBeGreaterThan(0.05); // still smooth, not glued
  });
});

import * as THREE from 'three';
import { boomLength, playerHiddenAt, isTeleport, MIN_BOOM, HIDE_DIST } from './camera';
describe('camera boom (polish)', () => {
  it('never shortens below the minimum with a wall right behind, nor exceeds the wanted distance', () => {
    expect(boomLength(0.1, 4.2)).toBe(MIN_BOOM); expect(boomLength(2, 4.2)).toBeCloseTo(1.92, 5); expect(boomLength(null, 4.2)).toBe(4.2); expect(boomLength(10, 4.2)).toBe(4.2);
  });
  it('hides the body inside the threshold, with hysteresis', () => {
    expect(playerHiddenAt(HIDE_DIST - 0.05, false)).toBe(true); expect(playerHiddenAt(HIDE_DIST + 0.05, false)).toBe(false);
    expect(playerHiddenAt(HIDE_DIST + 0.05, true)).toBe(true); expect(playerHiddenAt(HIDE_DIST + 0.3, true)).toBe(false);
  });
  it('a big one-frame focus jump is a teleport (snap); walking is not', () => {
    expect(isTeleport(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 0, 5))).toBe(true); expect(isTeleport(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.4, 0, 0.1))).toBe(false);
  });
});
