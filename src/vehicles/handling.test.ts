/**
 * Handling benchmark: drives every vehicle class through a fixed set of manoeuvres on a flat plane and
 * prints the numbers (0-100 km/h, top speed, braking distance, lateral g, steering response, handbrake
 * turn, stability, reverse). Assertions encode the intended feel of each class.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { RAPIER, Physics, initPhysics } from '../core/physics';
import { VehiclePhysics, type DriveInput } from './vehiclePhysics';
import { layoutFor } from './shapes';
import { VEHICLES, type VehicleKind } from './specs';

const DT = 1 / 60;
function setup(kind: VehicleKind) {
  const p = new Physics();
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.7));
  const car = new VehiclePhysics(p, VEHICLES[kind], layoutFor(kind), 0, 1.2, 0, 0);
  const step = (input: DriveInput) => { car.fixedUpdate(DT, input); p.step(DT); car.postStep(); };
  for (let i = 0; i < 90; i++) step({ throttle: 0, steer: 0, handbrake: false });
  return { p, car, step };
}
const yawOf = (car: VehiclePhysics) => car.yaw;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Holds a target forward speed with a simple throttle controller. */
const hold = (car: VehiclePhysics, target: number) => Math.max(-1, Math.min(1, (target - car.speed) * 0.6));
function sideSlip(car: VehiclePhysics) {
  const v = car.body.linvel(), f = car.forward();
  const sp = Math.hypot(v.x, v.z); if (sp < 1) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (v.x * f.x + v.z * f.z) / (sp * Math.hypot(f.x, f.z)))));
}
export interface HandlingMetrics {
  kind: VehicleKind; t100: number; vTop: number; brake100: number; latG15: number; latG25: number; steerT90: number;
  turnR8: number; turnR15: number; yaw05: number; hbYawDeg: number; turnIn50: number; turnR12: number; hbLazyYaw: number; hbSpeedKeep: number; driftHold: number; driftSpeed: number; hbRecover: boolean; smallInputSlipDeg: number; revT5: number; slalomUp: number; revOk: boolean; maxSlipLaunch: number; upright: number;
}
export function measure(kind: VehicleKind): HandlingMetrics {
  const m = {} as HandlingMetrics; m.kind = kind;
  let upright = 1;
  { // launch: 0-100 km/h and top speed
    const { car, step } = setup(kind);
    let t = 0, t100 = NaN, maxSlip = 0;
    for (; t < 30; t += DT) {
      step({ throttle: 1, steer: 0, handbrake: false });
      if (t < 2) maxSlip = Math.max(maxSlip, ...car.slip);
      if (isNaN(t100) && car.speed >= 27.78) t100 = t;
      upright = Math.min(upright, car.upVec().y);
    }
    m.t100 = t100; m.vTop = car.speed * 3.6; m.maxSlipLaunch = maxSlip;
  }
  { // braking from 100 km/h (or the top speed if lower)
    const { car, step } = setup(kind);
    const v0 = Math.min(27.78, VEHICLES[kind].topSpeed * 0.9);
    for (let i = 0; i < 60 * 30 && car.speed < v0; i++) step({ throttle: 1, steer: 0, handbrake: false });
    const z0 = car.position.z;
    for (let i = 0; i < 60 * 10 && car.speed > 0.3; i++) step({ throttle: -1, steer: 0, handbrake: false });
    m.brake100 = (car.position.z - z0) * (27.78 / v0) ** 2; // normalised to 100 km/h
  }
  for (const vs of [15, 25]) { // steady-state cornering at constant speed, full lock
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < vs; i++) step({ throttle: 1, steer: 0, handbrake: false });
    let g = 0, n = 0;
    for (let i = 0; i < 60 * 4; i++) {
      step({ throttle: hold(car, vs), steer: 1, handbrake: false });
      if (i > 120) { const v = car.body.linvel(); g += Math.abs(Math.hypot(v.x, v.z) * car.body.angvel().y) / 9.81; n++; }
      upright = Math.min(upright, car.upVec().y);
    }
    if (vs === 15) m.latG15 = g / n; else m.latG25 = g / n;
  }
  for (const vs of [8, 15]) { // turning circle at full lock (radius of the driven path, m)
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < vs; i++) step({ throttle: 1, steer: 0, handbrake: false });
    let rs = 0, n = 0;
    for (let i = 0; i < 60 * 4; i++) { step({ throttle: hold(car, vs), steer: 1, handbrake: false }); if (i > 120) { const v = car.body.linvel(); rs += Math.hypot(v.x, v.z) / Math.max(0.05, Math.abs(car.body.angvel().y)); n++; } }
    if (vs === 8) m.turnR8 = rs / n; else m.turnR15 = rs / n;
  }
  { // yaw rate 0.5 s after a full-lock tap at 12 m/s (turn-in)
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < 12; i++) step({ throttle: 1, steer: 0, handbrake: false });
    for (let i = 0; i < 30; i++) step({ throttle: hold(car, 12), steer: 1, handbrake: false });
    m.yaw05 = Math.abs(car.body.angvel().y);
  }
  { // keyboard turn-in at city speed: full-lock step at 12 m/s; time to half of the yaw rate reached after 1.5 s, and the radius then
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < 12; i++) step({ throttle: 1, steer: 0, handbrake: false });
    const rates: number[] = []; let rs = 0, n = 0;
    for (let i = 0; i < 90; i++) { step({ throttle: hold(car, 12), steer: 1, handbrake: false }); rates.push(Math.abs(car.body.angvel().y)); if (i > 45) { const v = car.body.linvel(); rs += Math.hypot(v.x, v.z) / Math.max(0.05, rates[i]); n++; } }
    m.turnIn50 = (rates.findIndex(r => r >= rates[rates.length - 1] * 0.5) + 1) * DT; m.turnR12 = rs / n;
  }
  { // lazy handbrake drift: flick at 18 m/s then let go of the wheel entirely (throttle only) -> how far does the car spin in 3 s?
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < 18; i++) step({ throttle: 1, steer: 0, handbrake: false });
    const y0 = yawOf(car); let acc = 0, prev = y0;
    for (let i = 0; i < 30; i++) step({ throttle: 0.5, steer: 1, handbrake: true });
    for (let i = 0; i < 180; i++) { step({ throttle: 0.6, steer: 0, handbrake: false }); const y = yawOf(car); acc += wrap(y - prev); prev = y; }
    m.hbLazyYaw = Math.abs(wrap(yawOf(car) - y0)) * 180 / Math.PI;
    void acc;
  }
  { // steering response at 20 m/s: time to 90% of the yaw rate reached after 1.5 s
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < 20; i++) step({ throttle: 1, steer: 0, handbrake: false });
    const rates: number[] = [];
    for (let i = 0; i < 90; i++) { step({ throttle: hold(car, 20), steer: 0.6, handbrake: false }); rates.push(Math.abs(car.body.angvel().y)); }
    const ref = rates[rates.length - 1];
    m.steerT90 = (rates.findIndex(r => r >= ref * 0.9) + 1) * DT;
  }
  { // handbrake turn from 18 m/s: 1.0 s of handbrake + full lock, then countersteer + throttle to recover
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < 18; i++) step({ throttle: 1, steer: 0, handbrake: false });
    const y0 = yawOf(car);
    for (let i = 0; i < 60; i++) step({ throttle: 0.4, steer: 1, handbrake: true });
    m.hbYawDeg = Math.abs(wrap(yawOf(car) - y0)) * 180 / Math.PI;
    const v = car.body.linvel(); m.hbSpeedKeep = Math.hypot(v.x, v.z) / 18;
    for (let i = 0; i < 120; i++) { const sl = car.body.angvel().y; step({ throttle: 0.7, steer: Math.max(-1, Math.min(1, -sl * 0.8)), handbrake: false }); upright = Math.min(upright, car.upVec().y); }
    m.hbRecover = Math.abs(car.body.angvel().y) < 0.5 && sideSlip(car) < 0.35;
  }
  { // drift hold: flick with the handbrake, then hold a slide with throttle and countersteer for 3 s
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < 17; i++) step({ throttle: 1, steer: 0, handbrake: false });
    for (let i = 0; i < 24; i++) step({ throttle: 0.6, steer: 1, handbrake: true });
    let held = 0, vSum = 0; const bt = -0.5;
    for (let i = 0; i < 180; i++) {
      const b = car.beta;
      step({ throttle: 0.85, steer: Math.max(-1, Math.min(1, (b - bt) * 3)), handbrake: false });
      const v = car.body.linvel(), sp = Math.hypot(v.x, v.z); vSum += sp;
      if (Math.abs(car.beta) > 0.2 && Math.abs(car.beta) < 1.2 && sp > 7) held++;
      upright = Math.min(upright, car.upVec().y);
    }
    m.driftHold = held / 180; m.driftSpeed = vSum / 180;
  }
  { // small inputs at speed must not spin the car: 0.3 steer pulses at 28 m/s
    const { car, step } = setup(kind);
    const vs = Math.min(28, VEHICLES[kind].topSpeed * 0.85);
    for (let i = 0; i < 60 * 30 && car.speed < vs; i++) step({ throttle: 1, steer: 0, handbrake: false });
    let maxSlip = 0;
    for (let i = 0; i < 180; i++) { const s = Math.floor(i / 20) % 2 ? -0.3 : 0.3; step({ throttle: hold(car, vs), steer: s, handbrake: false }); maxSlip = Math.max(maxSlip, sideSlip(car)); }
    m.smallInputSlipDeg = maxSlip * 180 / Math.PI;
  }
  { // abuse: full-lock slalom at speed must not roll the car
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 30 && car.speed < VEHICLES[kind].topSpeed * 0.8; i++) step({ throttle: 1, steer: 0, handbrake: false });
    let minUp = 1;
    for (let i = 0; i < 240; i++) { step({ throttle: 1, steer: Math.floor(i / 40) % 2 ? -1 : 1, handbrake: i % 80 < 10 }); minUp = Math.min(minUp, car.upVec().y); }
    m.slalomUp = minUp;
  }
  { // reverse: from 10 m/s forward, hold S -> brakes, then reverses
    const { car, step } = setup(kind);
    for (let i = 0; i < 60 * 20 && car.speed < 10; i++) step({ throttle: 1, steer: 0, handbrake: false });
    let t = 0, tStop = NaN, t5 = NaN;
    for (; t < 10; t += DT) { step({ throttle: -1, steer: 0, handbrake: false }); if (isNaN(tStop) && car.speed < 0.2) tStop = t; if (isNaN(t5) && car.speed < -5) { t5 = t; break; } }
    m.revT5 = t5 - tStop; m.revOk = !isNaN(t5);
  }
  m.upright = upright;
  return m;
}

describe('handling benchmark', () => {
  beforeAll(async () => { await initPhysics(); });
  for (const kind of Object.keys(VEHICLES) as VehicleKind[]) {
    it(`${kind} handles like its class`, () => {
      const m = measure(kind);
      const f = (x: number, d = 2) => Number.isFinite(x) ? x.toFixed(d) : String(x);
      process.stdout.write(`HANDLING ${kind.padEnd(11)} 0-100 ${f(m.t100, 1)}s top ${f(m.vTop, 0)}km/h brake100 ${f(m.brake100, 1)}m latG15 ${f(m.latG15)} latG25 ${f(m.latG25)} steerT90 ${f(m.steerT90)}s R8 ${f(m.turnR8, 1)}m R15 ${f(m.turnR15, 1)}m turnIn50 ${f(m.turnIn50)}s R12 ${f(m.turnR12, 1)}m lazyYaw ${f(m.hbLazyYaw, 0)}deg yaw05 ${f(m.yaw05)} hbYaw ${f(m.hbYawDeg, 0)}deg hbKeep ${f(m.hbSpeedKeep)} recover ${m.hbRecover} driftHold ${f(m.driftHold)} @${f(m.driftSpeed, 1)}m/s smallSlip ${f(m.smallInputSlipDeg, 1)}deg rev5 ${f(m.revT5, 1)}s launchSlip ${f(m.maxSlipLaunch, 1)} upright ${f(m.upright)} slalomUp ${f(m.slalomUp)}\n`);
      // everyday cars take 7-11 s to 100 km/h like real ones (raw tunes were 5-6 s, a go-kart)
      if (['hatch', 'sedan', 'fullsize', 'wagon', 'minivan', 'pickup', 'suv', 'taxi'].includes(kind)) { expect(m.t100).toBeGreaterThan(7); expect(m.t100).toBeLessThan(12); }
      expect(m.upright).toBeGreaterThan(0.7);
      expect(m.revOk).toBe(true);
      expect(m.slalomUp).toBeGreaterThan(0.6);
      expect(m.hbRecover).toBe(true);
      const mil = VEHICLES[kind].cls === 'military';
      if (!mil) expect(m.driftHold).toBeGreaterThan(0.6);
      // easy steering: quick turn-in, tight city turning circle, no plough at moderate speed
      expect(m.steerT90).toBeLessThan(mil ? 0.4 : 0.25);
      if (!mil) expect(m.turnR8).toBeLessThan(6.5);
      if (!mil) expect(m.turnR15).toBeLessThan(18);
      expect(m.yaw05).toBeGreaterThan(0.95);
      // keyboard feel: the wheel is on full lock within ~0.1 s, and a handbrake flick left alone self-aligns (before: sedan 174 deg, i.e. a donut)
      if (!mil) expect(m.turnIn50).toBeLessThan(0.15);
      if (['hatch', 'sedan', 'suv', 'pickup', 'police', 'taxi', 'fbi'].includes(kind)) expect(m.hbLazyYaw).toBeLessThan(125);
      expect(m.smallInputSlipDeg).toBeLessThan(6);
      expect(m.brake100).toBeLessThan(45);
    });
  }
});
