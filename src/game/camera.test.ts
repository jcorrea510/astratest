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
