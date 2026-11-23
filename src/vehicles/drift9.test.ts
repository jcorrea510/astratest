/**
 * Round 9 (owner): "if you drift a turn you slide sideways forever, making drifting useless because it's impossible to drift
 * without crashing". A keyboard drift through a corner: flick, hold throttle + steer into the turn, then straighten the wheel.
 * The car's path must actually turn (not slide on in a straight line) and the slide must end soon after straightening.
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
  return { car, step };
}
const course = (car: VehiclePhysics) => { const v = car.body.linvel(); return Math.atan2(v.x, v.z); };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export function cornerDrift(kind: VehicleKind) {
  const { car, step } = setup(kind);
  for (let i = 0; i < 60 * 20 && car.speed < 18; i++) step({ throttle: 1, steer: 0, handbrake: false });
  const c0 = course(car);
  for (let i = 0; i < 18; i++) step({ throttle: 0.6, steer: 1, handbrake: true });
  let maxBeta = 0;
  for (let i = 0; i < 72; i++) { step({ throttle: 1, steer: 1, handbrake: false }); maxBeta = Math.max(maxBeta, Math.abs(car.beta)); }
  const turned = Math.abs(wrap(course(car) - c0)) * 180 / Math.PI;
  // straighten the wheel, keep the throttle (what a keyboard player does on the exit)
  let tExit = -1;
  const tl: string[] = [];
  for (let i = 0; i < 180; i++) { step({ throttle: 1, steer: 0, handbrake: false }); if (i % 6 === 0 && i < 100) tl.push(`${car.beta.toFixed(2)}/${car.body.angvel().y.toFixed(2)}/${car.drift.toFixed(1)}`); if (tExit < 0 && Math.abs(car.beta) < 0.12 && Math.abs(car.body.angvel().y) < 0.4) tExit = i * DT; }
  const v = car.body.linvel();
  return { turned, maxBeta, tExit, exitSpeed: Math.hypot(v.x, v.z), tl: tl.join(" ") };
}
describe('Round 9 drift', () => {
  beforeAll(async () => { await initPhysics(); });
  for (const kind of ['sedan', 'sports', 'muscle', 'hatch'] as VehicleKind[]) {
    if (!VEHICLES[kind]) continue;
    it(`${kind}: a drift carries the car round the corner and ends soon after straightening`, () => {
      const m = cornerDrift(kind);
      process.stdout.write(`DRIFT9 ${kind} ${JSON.stringify(m)}\n`);
      expect(m.maxBeta).toBeGreaterThan(0.25); // it was a drift
      expect(m.turned).toBeGreaterThan(55);    // the path went round the corner
      expect(m.tExit).toBeGreaterThan(0); expect(m.tExit).toBeLessThan(1.3);
      expect(m.exitSpeed).toBeGreaterThan(8);
    });
  }
});
