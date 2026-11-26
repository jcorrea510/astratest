import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Physics, initPhysics, groups, G_STATIC, G_CHAR } from './physics';
import { Character } from '../actors/character';

let phys: Physics;
beforeAll(async () => { await initPhysics(); phys = new Physics(); });

describe('static streaming against live Rapier (Round 12 "unreachable" crashes)', () => {
  it('streams colliders in and out while stepping, ray casting and teleporting kinematic bodies', () => {
    for (let i = 0; i < 300; i++) phys.addStaticBox((i % 30) * 40 - 600, 1, Math.floor(i / 30) * 40 - 200, 1, 1, 1);
    const body = phys.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0));
    const col = phys.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.3).setCollisionGroups(groups(G_CHAR, G_STATIC | G_CHAR)), body);
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let it = 0; it < 600; it++) {
      const x = (rnd() - 0.5) * 1600, z = (rnd() - 0.5) * 600;
      phys.streamStatics(x, z);
      if (it % 7 === 0) col.setEnabled(rnd() < 0.5);
      body.setTranslation({ x, y: 1, z }, true); body.setNextKinematicTranslation({ x, y: 1, z });
      phys.ray(x, 5, z, 0, -1, 0, 20, groups(0xffff, G_STATIC));
      if (it % 3 === 0) phys.step(1 / 60);
    }
    expect(phys.stream.total).toBeGreaterThan(299);
  });
});

describe('streamed collider removed by the game (beach ramp "unreachable" crash)', () => {
  it('never touches a removed collider whose slot Rapier reused for a new one', () => {
    const p = new Physics();
    const old = p.addStaticBox(0, 1, 0, 0.2, 1, 0.2); // a lamp post
    p.streamStatics(0, 0, true);
    p.world.removeCollider(old, true); // a car knocks it over
    const fresh = p.world.createCollider(RAPIER.ColliderDesc.ball(0.3).setTranslation(5, 1, 5)); // reuses the slot
    expect(p.world.getCollider(old.handle)).toBe(fresh); // Rapier's handle map ignores the generation
    const total = p.stream.total;
    expect(() => { p.streamStatics(5000, 0); p.streamStatics(0, 0); p.step(1 / 60); }).not.toThrow();
    expect(fresh.isEnabled()).toBe(true); // the stream never switched the newcomer off in the dead one's name
    expect(p.stream.total).toBe(total - 1); // the dead entry is forgotten
  });
});

describe('Character on a freed body', () => {
  it('place / setPosition on a disposed character never touch the freed Rapier body', () => {
    const touched: string[] = [];
    const stub = new Proxy({}, { get: (_t, k) => () => { touched.push(String(k)); } });
    const c = Object.create(Character.prototype) as Character;
    Object.assign(c, { disposed: true, body: stub });
    c.place(1, 2, 3, 0); c.setPosition(1, 2, 3);
    expect(touched).toEqual([]);
    expect(c.isDisposed).toBe(true);
  });
});
