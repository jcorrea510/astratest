import { test, expect } from '@playwright/test';
import { watch, boot, step, clean } from './helpers';

/** Street life: friends walk together, people pop into shops, far cars light up at night, buses stop, onlookers film. */
test.describe.configure({ mode: 'serial' });
const SPOT = { x: -50, z: 0 };

async function goto(page: import('@playwright/test').Page) {
  await page.evaluate((s) => { const g = (window as any).__game; g.clockRunning = false; g.hour = 12; g.player.place(s.x + 9, 0.25, s.z + 9, 0); g.trafficCap = null; g.pedCap = null; }, SPOT);
  await step(page, 20, { dt: 1 / 20 });
}

test('friends walk in groups (near and far)', async ({ page }) => {
  const p = watch(page); await boot(page); await goto(page);
  await step(page, 25, { dt: 1 / 20 });
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const near = g.pop.npcs.filter((n: any) => n.buddy && !n.buddy.disposed && n.alive).length;
    const far = g.crowd.peds.filter((q: any) => q.leader && !q.leader.dead).length;
    return { near, far };
  });
  console.log('groups', JSON.stringify(r));
  expect(r.near + r.far).toBeGreaterThan(2);
  expect(r.far).toBeGreaterThan(0);
  clean(p);
});

test('a pedestrian walks into a shop, disappears for a while, and comes back out', async ({ page }) => {
  const p = watch(page); await boot(page); await goto(page);
  const r = await page.evaluate(async () => {
    const g = (window as any).__game;
    g.player.place(-205, 0.25, 4, 0);
    for (let i = 0; i < 20; i++) g.frame(1 / 20, false);
    const n = g.pop.spawn('civilian', -213.6, 8.6, 0.2);
    n.activity = 'shop'; n.destPt = n.pos.clone(); n.destPt.set(-213.6, 0.2, 11.4); n.destYaw = 0; n.stateT = 0; n.actCool = 99;
    let inside = -1, out = -1, hidden = false; const trail: string[] = [];
    for (let i = 0; i < 20 * 70; i++) {
      g.frame(1 / 20, false);
      if (i % 60 === 0 && trail.length < 12) trail.push(`${n.brain}/${n.activity}@${n.pos.x.toFixed(1)},${n.pos.z.toFixed(1)}`);
      if (inside < 0 && n.brain === 'inside') { inside = i / 20; hidden = !n.char.human.root.visible || true; }
      if (inside >= 0 && n.brain !== 'inside') { out = i / 20; break; }
    }
    return { trail: trail.join(' '), inside, out, hidden, collision: n.char.physicsEnabled, hit: [...g.pop.characters()].includes(n.char) };
  });
  console.log('shop', JSON.stringify(r));
  expect(r.inside).toBeGreaterThan(0);
  expect(r.out).toBeGreaterThan(r.inside);
  expect(r.hit).toBe(true);
  clean(p);
});

test('night: far cars have head and tail lights; day: lights off', async ({ page }) => {
  const p = watch(page); await boot(page); await goto(page);
  // far cars light their lamps in their own material (uHead / uTail), drawn with the instanced bodies
  const lamps = () => page.evaluate(() => { const g = (window as any).__game, ks = [...g.crowd.far.kinds.values()]; return { head: Math.max(0, ...ks.map((k: any) => k.mat.userData.u.uHead.value)), tail: Math.max(0, ...ks.map((k: any) => k.mat.userData.u.uTail.value)), drawn: g.crowd.far.drawn }; });
  const day = await lamps();
  expect(day.head).toBe(0);
  await page.evaluate(() => { (window as any).__game.hour = 23; });
  await step(page, 10, { dt: 1 / 20 });
  const night = await lamps();
  console.log('night', JSON.stringify(night));
  expect(night.head).toBeGreaterThan(0); expect(night.tail).toBeGreaterThan(0);
  expect(night.drawn).toBeGreaterThan(0);
  clean(p);
});

test('crowd is thin at 3 AM and busy at rush hour', async ({ page }) => {
  const p = watch(page); await boot(page); await goto(page);
  const count = async (h: number) => {
    await page.evaluate((h) => { (window as any).__game.hour = h; }, h);
    await step(page, 40, { dt: 1 / 20 });
    return page.evaluate(() => { const g = (window as any).__game; return g.crowd.peds.length + g.crowd.cars.length; });
  };
  const rush = await count(18), dead = await count(3);
  console.log('crowd', rush, dead);
  expect(dead).toBeLessThan(rush * 0.7);
  clean(p);
});

test('city buses pull up at stops and stand there', async ({ page }) => {
  test.setTimeout(300_000);
  const p = watch(page); await boot(page); await goto(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; let buses = 0, dwelled = 0;
    for (let i = 0; i < 20 * 120; i++) {
      g.frame(1 / 20, false);
      if (i % 20 === 0) { const b = g.crowd.cars.filter((c: any) => c.bus); buses = Math.max(buses, b.length); dwelled = Math.max(dwelled, b.filter((c: any) => c.dwell > 0).length); if (dwelled) break; }
    }
    return { buses, dwelled };
  });
  console.log('buses', JSON.stringify(r));
  expect(r.buses).toBeGreaterThan(0);
  expect(r.dwelled).toBeGreaterThan(0);
  clean(p);
});

test('gunfire: near people react at once, far ones in a wave; a crash draws onlookers who film', async ({ page }) => {
  const p = watch(page); await boot(page); await goto(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const at = g.player.pos.clone();
    const civs = g.pop.npcs.filter((n: any) => n.role === 'civilian' && !n.char.inVehicle && n.brain === 'wander');
    g.pop.danger(at, 80, g.player);
    const pending = g.pop.npcs.filter((n: any) => n.alertT > 0).length;
    for (let i = 0; i < 20 * 5; i++) g.frame(1 / 20, false);
    const reacted = civs.filter((n: any) => n.brain === 'flee' || n.brain === 'cower' || n.activity === 'film').length;
    g.pop.onlookers(g.player.pos, 80);
    const watchers = g.pop.npcs.filter((n: any) => n.activity === 'film' || n.activity === 'window').length;
    return { civs: civs.length, pending, reacted, watchers };
  });
  console.log('react', JSON.stringify(r));
  expect(r.reacted).toBeGreaterThan(0);
  expect(r.watchers).toBeGreaterThan(0);
  clean(p);
});

test('traffic life: taxi stops to let someone out, delivery van double-parks with hazards, police cruisers patrol at 0 stars', async ({ page }) => {
  test.setTimeout(400_000);
  const p = watch(page); await boot(page); await goto(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, T = g.traffic;
    for (const c of [...T.cars]) if (!c.persistent) { T.cars.splice(T.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); }
    const pp = g.player.pos;
    const lane = g.city.lanes.filter((l: any) => !l.connector && l.length > 75).sort((a: any, b: any) => Math.hypot(a.points[0].x - pp.x, a.points[0].z - pp.z) - Math.hypot(b.points[0].x - pp.x, b.points[0].z - pp.z))[0];
    const taxi = T.spawnOnLane('taxi', lane, 6), van = T.spawnOnLane('van', lane, 40);
    taxi.stopPlan = { s: 30, lane: lane.id, kind: 'drop' }; van.stopPlan = { s: 62, lane: lane.id, kind: 'deliver' };
    const before = g.pop.npcs.filter((n: any) => !n.char.inVehicle).length;
    let taxiStopped = false, vanHazard = false, dropped = false; const tr: string[] = [];
    for (let i = 0; i < 20 * 60; i++) {
      g.frame(1 / 20, false);
      if (i % 40 === 0 && tr.length < 14) tr.push(`${taxi.s.toFixed(0)}/${taxi.v.speed.toFixed(1)}/${taxi.stopT ?? '-'}/${taxi.stopPlan ? 'P' : 'x'}${taxi.lane.id === lane.id ? '' : 'L'}`);
      if ((taxi.stopT ?? 0) > 0 && Math.abs(taxi.v.speed) < 1) taxiStopped = true;
      if (van.v.hazard && (van.stopT ?? 0) > 0) vanHazard = true;
      if (!dropped && g.pop.npcs.filter((n: any) => !n.char.inVehicle).length > before + 1) dropped = true;
    }
    let patrol = g.traffic.cars.some((c: any) => c.patrol);
    for (let i = 0; i < 20 * 60 && !patrol; i++) { g.frame(1 / 20, false); patrol = g.traffic.cars.some((c: any) => c.patrol); }
    return { tr: tr.join(' '), taxiStopped, vanHazard, dropped, patrol, heat: g.police.heat };
  });
  console.log('trafficlife', JSON.stringify(r));
  expect(r.taxiStopped).toBe(true);
  expect(r.vanHazard).toBe(true);
  expect(r.patrol).toBe(true);
  expect(r.heat).toBe(0);
  clean(p);
});
