/** R6-D: numeric driving-feel checks (quick city corners, slides that die out, no spin-out from a plain full-lock turn). */
import { describe, it, expect, beforeAll } from 'vitest';
import { RAPIER, Physics, initPhysics } from '../core/physics';
import { VehiclePhysics, type DriveInput } from './vehiclePhysics';
import { layoutFor } from './shapes';
import { VEHICLES, type VehicleKind } from './specs';

const DT = 1 / 60, MPH = 0.44704;
function setup(kind: VehicleKind) {
  const p = new Physics();
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.7));
  const car = new VehiclePhysics(p, VEHICLES[kind], layoutFor(kind), 0, 1.2, 0, 0);
  const step = (i: DriveInput) => { car.fixedUpdate(DT, i); p.step(DT); car.postStep(); };
  for (let i = 0; i < 90; i++) step({ throttle: 0, steer: 0, handbrake: false });
  return { car, step };
}
const hold = (car: VehiclePhysics, t: number) => Math.max(-1, Math.min(1, (t - car.speed) * 0.6));
const KINDS: VehicleKind[] = ['hatch', 'sedan', 'pickup', 'coupe', 'muscle'];

describe('steering feel', () => {
  beforeAll(async () => { await initPhysics(); });
  for (const kind of KINDS) {
    it(`${kind}: a 90 degree corner at 25 mph with full keyboard lock takes < 1.5 s and keeps its speed`, () => {
      const { car, step } = setup(kind), v0 = 25 * MPH;
      for (let i = 0; i < 1800 && car.speed < v0; i++) step({ throttle: 1, steer: 0, handbrake: false });
      let prev = car.yaw, ang = 0, t90 = -1, vmin = 99;
      for (let i = 0; i < 300; i++) {
        step({ throttle: hold(car, v0), steer: 1, handbrake: false });
        ang += Math.atan2(Math.sin(car.yaw - prev), Math.cos(car.yaw - prev)); prev = car.yaw; vmin = Math.min(vmin, car.speed);
        if (t90 < 0 && Math.abs(ang) >= Math.PI / 2) t90 = i * DT;
      }
      process.stdout.write(`FEEL ${kind} 90deg@25mph t=${t90.toFixed(2)}s vmin=${vmin.toFixed(1)}\n`);
      expect(t90).toBeGreaterThan(0);
      expect(t90).toBeLessThan(1.5);
      expect(vmin).toBeGreaterThan(8); // no plough / spin scrub
    });
    it(`${kind}: plain full-lock turn at 40 mph does not spin out`, () => {
      const { car, step } = setup(kind), v0 = 40 * MPH;
      for (let i = 0; i < 1800 && car.speed < v0; i++) step({ throttle: 1, steer: 0, handbrake: false });
      let maxBeta = 0, minUp = 1;
      for (let i = 0; i < 240; i++) { step({ throttle: hold(car, v0), steer: 1, handbrake: false }); maxBeta = Math.max(maxBeta, Math.abs(car.beta)); minUp = Math.min(minUp, car.upVec().y); }
      expect(maxBeta).toBeLessThan(0.3);
      expect(Math.abs(car.beta)).toBeLessThan(0.2);
      expect(minUp).toBeGreaterThan(0.9);
    });
    it(`${kind}: a handbrake flick at 40 mph left alone stops rotating within 1.5 s`, () => {
      const { car, step } = setup(kind), v0 = 40 * MPH;
      for (let i = 0; i < 1800 && car.speed < v0; i++) step({ throttle: 1, steer: 0, handbrake: false });
      for (let i = 0; i < 20; i++) step({ throttle: 0.3, steer: 1, handbrake: true });
      let tq = -1, peak = 0;
      for (let i = 0; i < 240; i++) {
        step({ throttle: 0, steer: 0, handbrake: false });
        const w = Math.abs(car.body.angvel().y); peak = Math.max(peak, w);
        if (tq < 0 && i > 5 && w < 0.3) tq = i * DT;
      }
      process.stdout.write(`FEEL ${kind} flick40 yaw<0.3 at ${tq.toFixed(2)}s peak ${peak.toFixed(2)}\n`);
      expect(peak).toBeGreaterThan(0.6); // it really was a slide
      expect(tq).toBeGreaterThan(0);
      expect(tq).toBeLessThan(1.5);
      expect(Math.abs(car.beta)).toBeLessThan(0.1);
    });
  }
});
