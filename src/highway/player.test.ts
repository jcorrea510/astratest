import { describe, it, expect } from 'vitest';
import { PlayerCar } from './player';
import { laneU } from './road';
import { mpsFromMph } from '../core/units';

function mk(mph: number): PlayerCar {
  const p = new PlayerCar('sedan');
  p.reset(300, 1, mpsFromMph(mph));
  return p;
}
const cruise = (p: PlayerCar, target: number) => ({ steer: 0, throttle: p.v < target ? 0.4 : 0, brake: 0, handbrake: false });

describe('highway player steering', () => {
  it('a lane change at 70 mph with the key held completes in under 2 s and stays stable', () => {
    const p = mk(70), dt = 1 / 60, v0 = p.v, u0 = p.u;
    let t = 0, done = -1, maxPsi = 0, maxYaw = 0;
    for (; t < 3; t += dt) {
      p.update(dt, { steer: 1, throttle: p.v < v0 ? 0.4 : 0, brake: 0, handbrake: false });
      maxPsi = Math.max(maxPsi, Math.abs(p.psi)); maxYaw = Math.max(maxYaw, Math.abs(p.yawRate));
      if (done < 0 && Math.abs(p.u - u0) >= 3.7) done = t;
    }
    expect(done, `t=${done} psi=${maxPsi} yaw=${maxYaw}`).toBeGreaterThan(0.5);
    expect(done, `t=${done} psi=${maxPsi}`).toBeLessThan(1.6);
    expect(maxPsi).toBeLessThan(0.35);   // never turns more than ~20 deg off the road
    expect(maxYaw).toBeLessThan(0.7);    // no spin
  });
  it('holding the key a long time at 70 mph never spins; releasing re-centres', () => {
    const p = mk(70), dt = 1 / 60;
    for (let i = 0; i < 60 * 1; i++) p.update(dt, { steer: -1, throttle: 0.4, brake: 0, handbrake: false });
    expect(Math.abs(p.psi)).toBeLessThan(0.4);
    for (let i = 0; i < 60 * 3; i++) p.update(dt, { steer: 0, throttle: 0.4, brake: 0, handbrake: false });
    expect(Math.abs(p.steer)).toBeLessThan(0.01);
    expect(Math.abs(p.psi)).toBeLessThan(0.05);
  });
  it('reaches full lock quickly at low speed', () => {
    const p = mk(15), dt = 1 / 60;
    let t = 0;
    while (Math.abs(p.steer) < 0.99 && t < 2) { p.update(dt, { steer: 1, throttle: 0.2, brake: 0, handbrake: false }); t += dt; }
    expect(t).toBeLessThan(0.5);
    expect(p.steerAngle).toBeGreaterThan(0.25);
  });
  it('straight driving keeps the car in its lane', () => {
    const p = mk(70), dt = 1 / 60;
    for (let i = 0; i < 600; i++) p.update(dt, cruise(p, p.v));
    expect(p.u).toBeCloseTo(laneU(1), 3);
  });
});
