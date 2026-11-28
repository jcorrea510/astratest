import { describe, it, expect, beforeAll } from 'vitest';
import { RAPIER, Physics, initPhysics, G_STATIC, ALL, groups } from '../core/physics';
import { VehiclePhysics } from './vehiclePhysics';
import { layoutFor } from './shapes';
import { VEHICLES } from './specs';
import { crashRegistered } from '../game/impact';

const DT = 1 / 60;

// Regression (28 Nov, crash/impact update): Rapier reports contact pairs whose boxes only come close, with no contact
// point. Their normal was taken as a wall touch, so a car driving past a building or over the ground mesh lost 76 % of
// its drive and its kerb help, and the probe in CI showed an AI car crawling at 2 m/s next to nothing.
describe('wall contact needs a real touch', () => {
  beforeAll(async () => { await initPhysics(); });

  function world(wallGap: number) {
    const p = new Physics();
    // ground as a triangle mesh (like world/terrain), with internal edges every 4 m
    const pos: number[] = [], idx: number[] = [];
    const N = 40, S = 4;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= 4; j++) pos.push(i * S - 20, 0, j * S - 8);
    for (let i = 0; i < N; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j, b = a + 5; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const ground = p.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)).setFriction(0.8).setCollisionGroups(groups(G_STATIC, ALL)));
    p.tag(ground, { kind: 'static' });
    const half = layoutFor('sedan').half[0];
    // a building face running beside the lane, wallGap metres clear of the car's side
    const wall = p.world.createCollider(RAPIER.ColliderDesc.cuboid(80, 4, 0.5).setTranslation(60, 4, -(half + wallGap + 0.5)).setCollisionGroups(groups(G_STATIC, ALL)));
    p.tag(wall, { kind: 'static' });
    // a slanted kerb-side block (convex hull) whose bounding box reaches over the lane while its face stays ~1 m clear:
    // the pair is in Rapier's list with no contact point at all (the CI probe saw exactly this: shape 9, 0 contacts)
    // A (20, 0.5) is behind the car's start, the hypotenuse to B (40, -12) runs away from the lane at ~30 degrees
    const pts = new Float32Array([20, 0, 0.5, 40, 0, -12, 20, 0, -12, 20, 1.2, 0.5, 40, 1.2, -12, 20, 1.2, -12]);
    const slant = p.world.createCollider(RAPIER.ColliderDesc.convexHull(pts)!.setCollisionGroups(groups(G_STATIC, ALL)));
    p.tag(slant, { kind: 'static' });
    return p;
  }

  function drive(wallGap: number) {
    const p = world(wallGap);
    const car = new VehiclePhysics(p, VEHICLES.sedan, layoutFor('sedan'), 26, 0, 0, Math.PI / 2);
    car.settleAt(26, 0, 0, Math.PI / 2);
    car.setVelocity(8, 0, 0);
    let nearPairs = 0, wallFrames = 0, minSpeed = Infinity, frames = 0;
    for (let i = 0; i < 240; i++) {
      car.fixedUpdate(DT, { throttle: 1, steer: 0, handbrake: false }); p.step(DT); car.postStep();
      if (car.wallContact) wallFrames++;
      p.world.contactPairsWith(car.collider, o => p.world.contactPair(car.collider, o, m => { if (m.numContacts() === 0 && Math.hypot(m.normal().x, m.normal().z) > 0.72) nearPairs++; }));
      if (i > 30) { minSpeed = Math.min(minSpeed, car.speed); frames++; }
    }
    return { nearPairs, wallFrames, endSpeed: car.speed, minSpeed, frames };
  }

  it('driving past a wall that it never touches, over a triangle-mesh road, is no wall contact and keeps its drive', () => {
    const r = drive(0.35);
    expect(r.wallFrames).toBe(0);
    expect(r.nearPairs).toBeGreaterThan(0); // the scene really has touch-less pairs to ignore
    expect(r.endSpeed).toBeGreaterThan(11); // full throttle from 8 m/s for 4 s
  });

  it('a 3.86 m/s speed kick away from any wall is not a crash; a wall hit at that normal speed still is', () => {
    expect(crashRegistered(3.86, 3.86, false)).toBe(false);
    expect(crashRegistered(4.5, 4.5, false)).toBe(true);
    expect(crashRegistered(3.86, 3.86, true)).toBe(true);
    expect(crashRegistered(5, 2, true)).toBe(false); // glancing: the normal part is what counts against a wall
  });
});
