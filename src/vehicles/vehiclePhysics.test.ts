import { describe, it, expect, beforeAll } from 'vitest';
import { RAPIER, Physics, initPhysics } from '../core/physics';
import { VehiclePhysics, type VehicleLayout } from './vehiclePhysics';
import { VEHICLES, type VehicleKind } from './specs';
import { layoutFor } from './shapes';

export const TEST_LAYOUT: VehicleLayout = {
  half: [1.0, 0.62, 2.3], centerY: 0.68, radius: 0.36,
  wheels: [
    { x: 0.88, y: 0.056, z: 1.227, front: true, left: true }, { x: -0.88, y: 0.056, z: 1.227, front: true, left: false },
    { x: 0.88, y: 0.056, z: -1.281, front: false, left: true }, { x: -0.88, y: 0.056, z: -1.281, front: false, left: false },
  ],
};
function world() {
  const p = new Physics();
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0));
  return p;
}
function run(car: VehiclePhysics, p: Physics, seconds: number, input: { throttle: number; steer: number; handbrake: boolean }) {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) { car.fixedUpdate(dt, input); p.step(dt); car.postStep(); }
}
describe('vehicle handling', () => {
  beforeAll(async () => { await initPhysics(); });
  for (const kind of Object.keys(VEHICLES) as VehicleKind[]) {
    it(`${kind}: settles, accelerates, brakes and corners without flipping`, () => {
      const p = world();
      const car = new VehiclePhysics(p, VEHICLES[kind], layoutFor(kind), 0, 1.2, 0, 0);
      run(car, p, 2, { throttle: 0, steer: 0, handbrake: false });
      const restY = car.position.y;
      expect(restY).toBeGreaterThan(0.1); expect(restY).toBeLessThan(1.0);
      run(car, p, 3, { throttle: 1, steer: 0, handbrake: false });
      const v3 = car.speed;
      run(car, p, 5, { throttle: 1, steer: 0, handbrake: false });
      const v8 = car.speed;
      const z0 = car.position.z;
      run(car, p, 4, { throttle: -1, steer: 0, handbrake: false });
      const stop = car.position.z - z0, vAfter = car.speed;
      run(car, p, 4, { throttle: 1, steer: 0, handbrake: false });
      run(car, p, 3, { throttle: 0.8, steer: 1, handbrake: false });
      const upAfterTurn = car.upVec().y;
      const latG = Math.abs(car.speed * car.body.angvel().y) / 9.81, turnV = car.speed;
      run(car, p, 1.5, { throttle: 0.3, steer: 1, handbrake: true });
      const upAfterDrift = car.upVec().y;
      const driftYaw = car.body.angvel().y;
      process.stdout.write(JSON.stringify({ kind,  restY: restY.toFixed(2), v3: v3.toFixed(1), v8: v8.toFixed(1), stop: stop.toFixed(1), vAfter: vAfter.toFixed(1), upAfterTurn: upAfterTurn.toFixed(2), upAfterDrift: upAfterDrift.toFixed(2), latG: latG.toFixed(2), turnV: turnV.toFixed(1), driftYaw: driftYaw.toFixed(2) }) + '\n');
      expect(v3).toBeGreaterThan(8);
      expect(v8).toBeGreaterThan(v3);
      expect(v8).toBeLessThan(VEHICLES[kind].topSpeed + 2);
      expect(Math.abs(vAfter)).toBeLessThan(10);
      expect(upAfterTurn).toBeGreaterThan(0.85);
      expect(upAfterDrift).toBeGreaterThan(0.7);
    });
  }
});
