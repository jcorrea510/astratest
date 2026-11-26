import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Physics, initPhysics } from '../core/physics';
import { parkHeliBody } from './farLod';

beforeAll(async () => { await initPhysics(); });

/** A heli-like body resting on a small roof collider; the player then walks far away so the roof is streamed out. */
function scene() {
  const p = new Physics();
  p.addStaticBox(0, 100, 0, 6, 0.5, 6); // the rooftop pad (streamed: small collider)
  const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 101.0, 0));
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.5, 2), body);
  p.streamStatics(0, 0, true);
  for (let i = 0; i < 120; i++) p.step(1 / 60); // settles on the roof
  return { p, body };
}

describe('far parked helicopter (Round 12 take-off regression: it sank into the roof while the pad was streamed out)', () => {
  it('without parking, the streamed-out roof lets the body sink (the bug)', () => {
    const { p, body } = scene(); const y0 = body.translation().y;
    p.streamStatics(2000, 0);
    body.wakeUp(); for (let i = 0; i < 120; i++) p.step(1 / 60); // sleep() alone does not hold a body whose support vanished
    expect(body.translation().y).toBeLessThan(y0 - 0.2);
  });
  it('parkHeliBody keeps it exactly where it was, and gravity returns when the player is near', () => {
    const { p, body } = scene(); const y0 = body.translation().y;
    p.streamStatics(2000, 0);
    for (let i = 0; i < 300; i++) { parkHeliBody(body, true); p.step(1 / 60); }
    expect(body.translation().y).toBeCloseTo(y0, 4);
    p.streamStatics(0, 0); parkHeliBody(body, false);
    for (let i = 0; i < 120; i++) p.step(1 / 60);
    expect(body.gravityScale()).toBe(1);
    expect(body.translation().y).toBeGreaterThan(y0 - 0.05); // the roof is back and carries it
  });
});
