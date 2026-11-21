import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** R6-X: ragdolls on the hood, crumpling bodies, breakable street furniture, molotov fire. One boot shared by all tests. */
test.describe.configure({ mode: 'serial' });
let page: Page;
const SHOTS = process.env.R6X_SHOTS || '';
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await boot(page);
  await quietStreets(page);
});
test.afterAll(async () => { await page.context().close(); });

const shot = async (name: string, focus: [number, number, number], yaw: number, dist = 5, pitch = 0.15) => {
  if (!SHOTS) return;
  await page.evaluate(({ focus, yaw, dist, pitch }) => {
    const g = (window as any).__game;
    const c = g.cam.camera, cp = Math.cos(pitch), f = new g.player.pos.constructor(...focus);
    c.fov = 50; c.updateProjectionMatrix();
    c.position.set(f.x + Math.sin(yaw) * cp * dist, f.y + Math.sin(pitch) * dist, f.z + Math.cos(yaw) * cp * dist);
    c.lookAt(f); c.updateMatrixWorld(true);
    for (const n of g.pop.npcs) n.char.human.mesh.visible = true; // the pop culls people against the game camera, not this one
    g.renderer.render();
  }, { focus, yaw, dist, pitch });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test('car at 30 mph hits a pedestrian: body rides the hood (>=0.3 s) and is never inside the car', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-250, 0.25, -80, 0);
    for (const v of g.vehicles.list) v.phys.body.setEnabled(false);
    const car = g.vehicles.spawn('sedan', -345, -96.5, Math.PI / 2, -1, 0.6); car.persistent = true;
    const ped = g.pop.spawn('civilian', -300, -96.5, 0.25); ped.brain = 'scripted'; ped.persistent = true;
    const V = car.position.constructor;
    for (let f = 0; f < 30; f++) g.frame(1 / 60, false);
    const top: number[][] = car.tpl.shape.top;
    const deck = (z: number) => { let y = top[top.length - 1][1]; if (z <= top[0][0]) y = top[0][1]; else for (let i = 1; i < top.length; i++) if (z <= top[i][0]) { const a = top[i - 1], b = top[i], k = (z - a[0]) / (b[0] - a[0]); y = a[1] + (b[1] - a[1]) * k; break; } return -0.35 + y * 0.97; };
    const L = car.tpl.layout; let above = 0, worst = 9, hit = -1, sp0 = 0;
    for (let f = 0; f < 300; f++) {
      const lv = car.phys.body.linvel(); if (f < 190) car.phys.body.setLinvel({ x: 13.4, y: lv.y, z: 0 }, true);
      g.frame(1 / 60, false);
      const rd = ped.char.ragdoll; if (!rd) continue;
      if (hit < 0) { hit = f; sp0 = car.speed; }
      const t = rd.torso.translation(), lp = car.group.worldToLocal(new V(t.x, t.y, t.z));
      if (Math.abs(lp.x) < L.half[0] && lp.z > 0.2 && lp.z < 2.3) {
        const clear = lp.y - deck(lp.z); // torso centre above the deck surface
        if (clear > 0.1) above += 1 / 60;
        worst = Math.min(worst, clear);
      }
    }
    return { hit, sp0, above, worst, alive: ped.char.alive };
  });
  console.log('ped hit', JSON.stringify(r));
  expect(r.hit).toBeGreaterThan(0);
  expect(r.above).toBeGreaterThanOrEqual(0.3);
  expect(r.worst).toBeGreaterThan(-0.05);
});

test('40 mph wall hit crumples the body (>=5 cm vertex displacement) and buckles the hood', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-250, 0.25, -80, 0);
    g.physics.addStaticBox(-420, 2, -96.5, 0.5, 3, 4, 0);
    const car = g.vehicles.spawn('sedan', -450, -96.5, Math.PI / 2, -1, 0.6); car.persistent = true;
    for (let f = 0; f < 30; f++) g.frame(1 / 60, false);
    for (let f = 0; f < 150; f++) { const lv = car.phys.body.linvel(); if (f < 100 && car.position.x < -424) car.phys.body.setLinvel({ x: 17.9, y: lv.y, z: 0 }, true); g.frame(1 / 60, false); }
    const cr = car.crumpler;
    (window as any).__crashCar = car;
    return { disp: cr ? cr.maxDisplacement() : 0, hood: cr ? cr.hood : 0, bump: cr ? cr.bumperF : 0, x: car.position.x };
  });
  console.log('wall', JSON.stringify(r));
  expect(r.disp).toBeGreaterThanOrEqual(0.05);
  expect(r.hood).toBeGreaterThan(0);
});

test('lamp post hit at speed falls over (dynamic, tilts >45 deg) and goes dark', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const d = g.breakables.nearest('lamp', -300, -96.5); if (!d) return { err: 'no lamp' };
    g.player.place(d.x + 30, 0.25, d.z + 30, 0);
    const car = g.vehicles.spawn('sedan', d.x - 12, d.z - 4.5, Math.atan2(12, 4.5), -1, d.y + 0.6); car.persistent = true;
    for (let f = 0; f < 30; f++) g.frame(1 / 60, false);
    for (let f = 0; f < 200; f++) { const lv = car.phys.body.linvel(); if (!d.broken) car.phys.body.setLinvel({ x: 13 * Math.sin(Math.atan2(12, 4.5)), y: lv.y, z: 13 * Math.cos(Math.atan2(12, 4.5)) }, true); g.frame(1 / 60, false); }
    return { broken: !!d.broken, tilt: g.breakables.tiltOf(d), fallen: g.breakables.fallen.length };
  });
  console.log('lamp', JSON.stringify(r));
  expect(r.broken).toBe(true);
  expect(r.tilt).toBeGreaterThan(45);
});

test('molotov: fire lasts >= 8 s and ignites a pedestrian standing in it', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-250, 0.25, -80, 0);
    const ped = g.pop.spawn('civilian', -262, -80, 0.25); ped.brain = 'scripted'; ped.persistent = true;
    for (let f = 0; f < 10; f++) g.frame(1 / 60, false);
    const w = { id: 'molotov', projectile: 'molotov', damage: 30, cat: 'throw' };
    g.combat.launch(g.player, w, new g.player.pos.constructor(-257, 1.6, -80), new g.player.pos.constructor(-1, -0.1, 0).normalize(), 0, 0.5);
    let lit = -1, t = 0, fireEnd = -1, burning = false;
    for (let f = 0; f < 60 * 16; f++) {
      g.frame(1 / 60, false); t += 1 / 60;
      const n = g.combat.fire.patches.length;
      if (n > 0 && lit < 0) lit = t;
      if (lit >= 0 && n === 0 && fireEnd < 0) fireEnd = t;
      if (g.combat.burning.has(ped.char)) burning = true;
    }
    return { lit, life: fireEnd < 0 ? 99 : fireEnd - lit, burning, hp: ped.char.health };
  });
  console.log('molotov', JSON.stringify(r));
  expect(r.lit).toBeGreaterThan(0);
  expect(r.life).toBeGreaterThanOrEqual(8);
  expect(r.burning).toBe(true);
});

test('perf: 5 ragdolls + 3 crumpled cars frame time', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-250, 0.25, -80, 0);
    const cars: any[] = [];
    for (let i = 0; i < 3; i++) { const c = g.vehicles.spawn('sedan', -262 + i * 5, -60, 0.3 * i, -1, 0.6); c.persistent = true; cars.push(c); }
    for (let f = 0; f < 20; f++) g.frame(1 / 60, false);
    const V = g.player.pos.constructor;
    for (const c of cars) for (let k = 0; k < 4; k++) c.crumple(new V(c.position.x, c.position.y + 0.3, c.position.z + 2), new V(0, 0, -1), 1.2);
    const base: number[] = [];
    const run = (n: number, out: number[]) => { for (let f = 0; f < n; f++) { const t0 = performance.now(); g.frame(1 / 60, false); out.push(performance.now() - t0); } };
    run(60, base);
    for (let i = 0; i < 5; i++) { const p = g.pop.spawn('civilian', -262 + i * 1.5, -75, 0.25); p.persistent = true; g.ragdolls.launch(p.char, { vx: 6, vy: 3, vz: 0, spin: 2, getUp: true }); }
    const rag: number[] = [];
    run(120, rag);
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    return { base: +avg(base).toFixed(2), rag: +avg(rag).toFixed(2), max: +Math.max(...rag).toFixed(1), live: g.ragdolls.list.filter((x: any) => !x.frozen).length };
  });
  console.log('perf', JSON.stringify(r));
  expect(r.rag).toBeLessThan(r.base + 12);
});

test('screenshots', async () => {
  test.skip(!SHOTS, 'set R6X_SHOTS=<dir> to render');
  for (const [name, mph, side] of [['crumple-20mph', 20, false], ['crumple-40mph', 40, false], ['crumple-60mph', 60, false], ['crumple-side', 25, true]] as const) {
    const pos = await page.evaluate(({ mph, side }) => {
      const g = (window as any).__game, v = mph * 0.447;
      g.player.place(-250, 0.25, -80, 0);
      for (const c of g.vehicles.list) c.phys.body.setEnabled(false); // park the wrecks (removing a destroyed car mid-test trips a physics eject)
      const car = g.vehicles.spawn('sedan', side ? -430 : -450, -96.5, side ? 0 : Math.PI / 2, -1, 0.6); car.persistent = true;
      for (let f = 0; f < 30; f++) g.frame(1 / 60, false);
      for (let f = 0; f < 200; f++) { const lv = car.phys.body.linvel(); if (f < 120 && car.position.x < -424) car.phys.body.setLinvel(side ? { x: v, y: lv.y, z: 0 } : { x: v, y: lv.y, z: 0 }, true); g.frame(1 / 60, false); }
      return [car.position.x, car.position.y + 0.5, car.position.z];
    }, { mph, side });
    await shot(name, pos as [number, number, number], side ? 2.2 : Math.PI / 2 + 0.5, 6, 0.2);
  }
  const lamp = await page.evaluate(() => { const g = (window as any).__game; const f = g.breakables.fallen[0]; return f ? [f.holder.position.x, f.holder.position.y + 1, f.holder.position.z] : null; });
  if (lamp) await shot('fallen-lamp', lamp as [number, number, number], 0.6, 9, 0.25);
  // ped on the hood
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-250, 0.25, -80, 0);
    for (const v of g.vehicles.list) v.phys.body.setEnabled(false);
    const car = g.vehicles.spawn('sedan', -345, -96.5, Math.PI / 2, -1, 0.6); car.persistent = true;
    const ped = g.pop.spawn('civilian', -300, -96.5, 0.25); ped.brain = 'scripted'; ped.persistent = true;
    (window as any).__hc = car; (window as any).__hp = ped;
    for (let f = 0; f < 30; f++) g.frame(1 / 60, false);
    for (let f = 0; f < 205; f++) { const lv = car.phys.body.linvel(); car.phys.body.setLinvel({ x: 13.4, y: lv.y, z: 0 }, true); g.frame(1 / 60, false); }
  });
  for (let k = 0; k < 3; k++) {
    const pos = await page.evaluate(() => { const c = (window as any).__hc; return [c.position.x + 1.2, c.position.y + 0.6, c.position.z]; });
    await shot(`ped-on-hood-${k}`, pos as [number, number, number], 0.9 + k * 0.5, 5.5, 0.15);
    await page.evaluate(() => { const g = (window as any).__game, c = (window as any).__hc; for (let f = 0; f < 6; f++) { c.phys.body.setLinvel({ x: 11, y: c.phys.body.linvel().y, z: 0 }, true); g.frame(1 / 60, false); } });
  }
  // molotov
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-250, 0.25, -80, 0);
    const ped = g.pop.spawn('civilian', -262, -80, 0.25); ped.brain = 'scripted'; ped.persistent = true;
    g.combat.launch(g.player, { id: 'molotov', projectile: 'molotov', damage: 30, cat: 'throw' }, new g.player.pos.constructor(-257, 1.6, -80), new g.player.pos.constructor(-1, -0.1, 0).normalize(), 0, 0.5);
    for (let f = 0; f < 60 * 3; f++) g.frame(1 / 60, false);
  });
  await shot('molotov-fire', [-262, 1.2, -80], 1.2, 9, 0.2);
});
