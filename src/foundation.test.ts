import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
describe('runtime foundations', () => {
  it('supports vector transforms used by movement', () => { expect(new Vector3(3, 0, 4).normalize().length()).toBeCloseTo(1); });
  it('initializes real physics and settles a rigid body on the ground', async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
    for (let i = 0; i < 180; i++) world.step();
    expect(body.translation().y).toBeCloseTo(0.5, 1);
    world.free();
  });
});
