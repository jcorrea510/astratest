import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RAPIER, Physics, initPhysics } from '../core/physics';
import { VehiclePhysics, setRealisticDriving, loadTransfer } from './vehiclePhysics';
import { layoutFor } from './shapes';
import { VEHICLES } from './specs';

const DT = 1 / 60;
function latG(): number {
  const p = new Physics();
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.7));
  const car = new VehiclePhysics(p, VEHICLES.sedan, layoutFor('sedan'), 0, 1.2, 0, 0);
  const step = (throttle: number, steer: number) => { car.fixedUpdate(DT, { throttle, steer, handbrake: false }); p.step(DT); car.postStep(); };
  for (let i = 0; i < 90; i++) step(0, 0);
  for (let i = 0; i < 1200 && car.speed < 15; i++) step(1, 0);
  let g = 0, n = 0;
  for (let i = 0; i < 240; i++) {
    step(Math.max(-1, Math.min(1, (15 - car.speed) * 0.6)), 1);
    if (i > 120) { const v = car.body.linvel(); g += Math.abs(Math.hypot(v.x, v.z) * car.body.angvel().y) / 9.81; n++; }
  }
  return g / n;
}
describe('driving assists', () => {
  beforeAll(async () => { await initPhysics(); });
  afterAll(() => setRealisticDriving(false));
  it('realistic mode lowers sedan lateral grip to roughly 0.9 g', () => {
    setRealisticDriving(false); const arcade = latG();
    setRealisticDriving(true); const real = latG();
    expect(real).toBeLessThan(arcade * 0.8);
    expect(real).toBeGreaterThan(0.6); expect(real).toBeLessThan(1.1);
  });
  it('braking loads the front axle and unloads the rear', () => {
    expect(loadTransfer(-9, true)).toBeGreaterThan(1.1);
    expect(loadTransfer(-9, false)).toBeLessThan(0.9);
    expect(loadTransfer(0, true)).toBe(1);
  });
});
