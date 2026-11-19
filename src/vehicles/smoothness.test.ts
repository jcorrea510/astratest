/** Driving smoothness: render-pose jitter at mismatched frame rates, cruise stability, and curb climbing. */
import { describe, it, expect, beforeAll } from 'vitest';
import { RAPIER, Physics, initPhysics } from '../core/physics';
import { VehiclePhysics } from './vehiclePhysics';
import { layoutFor } from './shapes';
import { VEHICLES, type VehicleKind } from './specs';

const DT = 1 / 60;
function setup(kind: VehicleKind, curbs: number[] = [], curbH = 0.15) {
  const p = new Physics();
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.7));
  for (const z of curbs) p.world.createCollider(RAPIER.ColliderDesc.cuboid(20, curbH / 2, 0.25).setTranslation(0, curbH / 2, z).setFriction(0.7));
  const car = new VehiclePhysics(p, VEHICLES[kind], layoutFor(kind), 0, 1.2, 0, 0);
  const step = (thr: number, steer = 0) => { car.fixedUpdate(DT, { throttle: thr, steer, handbrake: false }); p.step(DT); car.postStep(); };
  for (let i = 0; i < 90; i++) step(0);
  return { p, car, step };
}
const cruise = (car: VehiclePhysics, v: number) => Math.max(-1, Math.min(1, (v - car.speed) * 0.5));
beforeAll(async () => { await initPhysics(); });

/** Rendered z at a given render time, blending the last two fixed-step poses (what Vehicle.syncTransform does). */
function renderTrace(hz: number, interpolate: boolean) {
  const { car, step } = setup('sedan');
  for (let i = 0; i < 300; i++) step(cruise(car, 20));
  let acc = 0; const out: number[] = [];
  for (let f = 0; f < hz * 3; f++) {
    acc += 1 / hz;
    while (acc >= DT) { step(cruise(car, 20)); acc -= DT; }
    const z = car.body.translation().z, zp = car.prevPos.z, a = acc / DT;
    out.push(interpolate ? zp + (z - zp) * a : z);
  }
  const d = out.slice(1).map((v, i) => v - out[i]);
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  return { mean, maxDev: Math.max(...d.map(x => Math.abs(x - mean))), min: Math.min(...d) };
}

describe('render smoothness', () => {
  for (const hz of [144, 75]) {
    it(`interpolated pose is smooth at ${hz} Hz render over 60 Hz physics`, () => {
      const raw = renderTrace(hz, false), smooth = renderTrace(hz, true);
      console.log(`[jitter ${hz}Hz] frame-delta deviation raw ${(raw.maxDev * 100).toFixed(2)} cm, interpolated ${(smooth.maxDev * 100).toFixed(2)} cm (mean step ${(smooth.mean * 100).toFixed(1)} cm)`);
      expect(smooth.min).toBeGreaterThan(0); // never goes backward
      expect(smooth.maxDev).toBeLessThan(raw.maxDev * 0.35);
      expect(smooth.maxDev).toBeLessThan(0.05);
    });
  }
  it('cruise has no suspension chatter', () => {
    const { car, step } = setup('sedan');
    for (let i = 0; i < 300; i++) step(cruise(car, 25));
    const ys: number[] = [], vs: number[] = [];
    for (let i = 0; i < 240; i++) { step(cruise(car, 25)); ys.push(car.body.translation().y); vs.push(car.speed); }
    const dy = ys.slice(1).map((y, i) => Math.abs(y - ys[i])), dv = vs.slice(1).map((v, i) => Math.abs(v - vs[i]));
    console.log(`[cruise 25 m/s] max |dy| ${(Math.max(...dy) * 1000).toFixed(2)} mm/step, max |dv| ${Math.max(...dv).toFixed(3)} m/s/step`);
    expect(Math.max(...dy)).toBeLessThan(0.003);
    expect(Math.max(...dv)).toBeLessThan(0.1);
  });
});

describe('curbs', () => {
  for (const [kind, ang, v] of [['sedan', 0.8, 2], ['hatch', 0.8, 2], ['police', 0.8, 2], ['coupe', 1.0, 7], ['suv', 0.5, 3]] as [VehicleKind, number, number][]) {
    it(`${kind} mounts an 18 cm kerb at ${(ang * 57.3).toFixed(0)} deg and ${v} m/s`, () => {
      const p = new Physics();
      p.world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.7));
      p.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.09, 2).setTranslation(0, 0.09, 15).setFriction(0.8));
      const car = new VehiclePhysics(p, VEHICLES[kind], layoutFor(kind), 0, 1.2, 0, ang);
      const step = (t: number) => { car.fixedUpdate(DT, { throttle: t, steer: 0, handbrake: false }); p.step(DT); car.postStep(); };
      for (let i = 0; i < 90; i++) step(0);
      let t = 0; for (; t < 2400 && car.body.translation().z < 19; t++) step(cruise(car, v));
      console.log(`[kerb ${kind} ${ang} rad ${v} m/s] over in ${(t / 60).toFixed(1)} s`);
      expect(car.body.translation().z).toBeGreaterThan(19);
    });
  }
  for (const [kind, v] of [['sedan', 4], ['sedan', 10], ['hatch', 6], ['suv', 6]] as [VehicleKind, number][]) {
    it(`${kind} climbs a 15 cm curb at ${v} m/s without stalling`, () => {
      const { car, step } = setup(kind, [12]);
      let minAfter = 99, t = 0;
      for (; t < 600 && car.body.translation().z < 16; t++) { step(cruise(car, v)); if (car.body.translation().z > 11) minAfter = Math.min(minAfter, car.speed); }
      console.log(`[curb ${kind} ${v}] crossed in ${(t / 60).toFixed(1)} s, min speed over curb ${minAfter.toFixed(2)} m/s`);
      expect(car.body.translation().z).toBeGreaterThan(16);
      expect(minAfter).toBeGreaterThan(v * 0.5);
    });
  }
});
