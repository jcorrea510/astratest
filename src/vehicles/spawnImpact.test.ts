import { describe, it, expect, beforeAll } from 'vitest';
import { RAPIER, Physics, initPhysics } from '../core/physics';
import { VehiclePhysics } from './vehiclePhysics';
import { VEHICLES } from './specs';
import { layoutFor } from './shapes';

// Regression: AI cars spawned already moving registered their own speed as a crash on the first step
// (damage, a shattered windscreen, crash sound, every driver nearby stopping for the "accident").
describe('spawning a car already moving', () => {
  beforeAll(async () => { await initPhysics(); });
  function world() { const p = new Physics(); p.world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0)); return p; }
  it('setVelocity does not count as an impact; a raw setLinvel did', () => {
    for (const useApi of [true, false]) {
      const p = world();
      const car = new VehiclePhysics(p, VEHICLES.sedan, layoutFor('sedan'), 0, 0, 0, 0);
      car.settleAt(0, 0, 0, 0);
      if (useApi) car.setVelocity(0, 0, 11); else car.body.setLinvel({ x: 0, y: 0, z: 11 }, true);
      let maxImpact = 0;
      for (let i = 0; i < 30; i++) { car.fixedUpdate(1 / 60, { throttle: 0.3, steer: 0, handbrake: false }); p.step(1 / 60); car.postStep(); maxImpact = Math.max(maxImpact, car.impact); }
      if (useApi) expect(maxImpact).toBeLessThan(4); else expect(maxImpact).toBeGreaterThan(4);
    }
  });
  it('a woken van brushed sideways does not roll over', () => {
    const p = world();
    const van = new VehiclePhysics(p, VEHICLES.van, layoutFor('van'), 0, 0, 0, 0);
    van.settleAt(0, 0, 0, 0);
    van.body.applyImpulse({ x: VEHICLES.van.mass * 3, y: 0, z: 0 }, true); // a 3 m/s side shove (passing car brushing it)
    for (let i = 0; i < 180; i++) { van.fixedUpdate(1 / 60, { throttle: 0, steer: 0, handbrake: true }); p.step(1 / 60); van.postStep(); }
    const q = van.body.rotation(); const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    expect(upY).toBeGreaterThan(0.9);
  });
});
