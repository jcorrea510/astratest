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

  // R6-D round 2: keyboard ramp, lateral grip at speed, 35 mph corner on lift-off. g here is a/9.81 (world gravity is 20, so 1.2 g = ~0.6 of the tyre budget).
  for (const kind of ['sedan', 'coupe', 'muscle', 'pickup', 'van'] as VehicleKind[]) {
    it(`${kind}: keyboard wheel reaches full lock in 0.25-0.45 s (D2), pulls >= 0.9 g (0.75 truck) at 35/50 mph, stays straight-ish`, () => {
      for (const mph of [20, 35, 50]) {
        const v0 = mph * MPH, { car, step } = setup(kind);
        for (let i = 0; i < 6000 && car.speed < v0; i++) step({ throttle: 1, steer: 0, handbrake: false });
        let tfull = -1, g = 0, n = 0, mb = 0;
        for (let i = 0; i < 300; i++) {
          step({ throttle: hold(car, v0), steer: 1, handbrake: false });
          if (tfull < 0 && Math.abs(car.steer) >= car.steerLimit(Math.abs(car.speed)) * 0.97) tfull = i * DT;
          if (i > 150) { const v = car.body.linvel(); g += Math.hypot(v.x, v.z) * Math.abs(car.body.angvel().y) / 9.81; n++; }
          mb = Math.max(mb, Math.abs(car.beta));
        }
        process.stdout.write(`FEEL ${kind} ${mph}mph ramp ${tfull.toFixed(2)}s latG ${(g / n).toFixed(2)} maxBeta ${mb.toFixed(2)}\n`);
        expect(tfull).toBeGreaterThanOrEqual(0.25); expect(tfull).toBeLessThanOrEqual(0.45);
        if (mph >= 35) expect(g / n).toBeGreaterThan(['pickup', 'van'].includes(kind) ? 0.75 : 0.9);
        if (mph >= 35) expect(mb).toBeLessThan(0.35);
      }
    });
    it(`${kind}: 90 degree corner at 35 mph on lift-off with full lock holds the lane (no spin)`, () => {
      const v0 = 35 * MPH, { car, step } = setup(kind);
      for (let i = 0; i < 6000 && car.speed < v0; i++) step({ throttle: 1, steer: 0, handbrake: false });
      let ang = 0, prev = car.yaw, t90 = -1, mb = 0;
      for (let i = 0; i < 240 && t90 < 0; i++) {
        step({ throttle: 0, steer: 1, handbrake: false });
        ang += Math.atan2(Math.sin(car.yaw - prev), Math.cos(car.yaw - prev)); prev = car.yaw; mb = Math.max(mb, Math.abs(car.beta));
        if (Math.abs(ang) >= Math.PI / 2) t90 = i * DT;
      }
      process.stdout.write(`FEEL ${kind} 90deg@35mph lift-off t=${t90.toFixed(2)}s maxBeta ${mb.toFixed(2)} v ${car.speed.toFixed(1)}\n`);
      expect(t90).toBeGreaterThan(0); expect(t90).toBeLessThan(1.9);
      expect(mb).toBeLessThan(0.25);
      expect(car.speed).toBeGreaterThan(v0 * 0.72); // R6-D: cornering scrub <= ~25% (was ~40%)
    });
  }
});
