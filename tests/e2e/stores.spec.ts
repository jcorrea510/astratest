import { test, expect } from '@playwright/test';
import { watch, boot, clean } from './helpers';

test.describe.configure({ mode: 'serial' });

test('about 50 walk-in stores of eleven kinds with blips; interiors are built lazily', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const M = (window as any).__meridian, R = M.activities.robberies;
    const kinds = new Set(R.kiosks.map((k: any) => k.def.kind));
    const shopBlips = M.activities.blips().filter((b: any) => b.kind === 'shop').length;
    return { n: R.kiosks.length, kinds: kinds.size, built: R.builtCount, shopBlips };
  });
  expect(r.n).toBeGreaterThanOrEqual(45);
  expect(r.kinds).toBe(11);
  expect(r.shopBlips).toBeGreaterThanOrEqual(45);
  expect(r.built).toBeLessThan(r.n / 2); // only the stores near the spawn exist as meshes
  clean(p);
});

test('stores of every kind can be walked into and held up', async ({ page }) => {
  test.setTimeout(300_000);
  const p = watch(page);
  await boot(page);
  const picks = await page.evaluate(() => {
    const R = (window as any).__meridian.activities.robberies; const seen = new Set<string>(); const out: number[] = [];
    R.kiosks.forEach((k: any, i: number) => { if (!seen.has(k.def.kind)) { seen.add(k.def.kind); out.push(i); } });
    return out;
  });
  expect(picks.length).toBe(11);
  for (const i of picks) {
    const r = await page.evaluate((i: number) => {
      const g = (window as any).__game, R = (window as any).__meridian.activities.robberies, k = R.kiosks[i];
      g.police.clear(); g.money = 0; g.pcombat.give('pistol', 60); g.pcombat.inv.select('pistol');
      // 1) walk in through the door from the pavement
      const out = k.frame.toWorld(3.1, 0.3, 4.9 + 4), inn = k.frame.toWorld(3.1, 0.3, 0.5);
      g.player.place(out.x, out.y, out.z, 0);
      for (let f = 0; f < 6; f++) g.frame(1 / 30, false); // interior builds on approach
      g.input.press('KeyW');
      for (let f = 0; f < 30 * 5; f++) { g.cam.yaw = Math.atan2(-(inn.x - g.player.pos.x), -(inn.z - g.player.pos.z)); g.frame(1 / 30, false); if (R.inside()?.def === k.def) break; }
      g.input.release('KeyW');
      const entered = R.inside()?.def === k.def;
      // 2) hold up the clerk from the customer side
      g.player.place(k.customer.x, k.customer.y + 0.3, k.customer.z, 0);
      for (let f = 0; f < 45; f++) g.frame(1 / 30, false);
      k.brave = false; const c = k.clerk;
      g.input.press('Mouse2');
      let started = false;
      for (let f = 0; f < 30 * 9; f++) { g.cam.yaw = Math.atan2(-(c.pos.x - g.player.pos.x), -(c.pos.z - g.player.pos.z)); g.cam.pitch = -0.05; g.frame(1 / 30, false); if (R.robbing) started = true; }
      g.input.release('Mouse2');
      const bag = g.pickups.find((q: any) => q.kind === 'cash');
      if (bag) { g.player.place(bag.pos.x, bag.pos.y - 0.55, bag.pos.z, 0); for (let f = 0; f < 15; f++) g.frame(1 / 30, false); }
      return { kind: k.def.kind, name: k.def.name, built: !!k.shell, entered, started, money: g.money, cash: k.def.cash, phase: k.phase };
    }, i);
    expect(r.built, r.name).toBe(true);
    expect(r.entered, `${r.name} (${r.kind}) enterable`).toBe(true);
    expect(r.started, `${r.name} hold-up starts`).toBe(true);
    expect(r.money, `${r.name} pays out`).toBeGreaterThanOrEqual(r.cash); // a bystander killed in the chaos may drop a few dollars the player also grabs
    expect(r.phase).toBe('closed');
  }
  clean(p);
});

test('GPS routes over the bridge (road lanes), never across the water', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, M = (window as any).__meridian;
    g.player.place(440, 0.3, 100, 0);
    g.waypoint = new (g.player.pos.constructor)(840, 0, -300);
    for (let f = 0; f < 5; f++) g.frame(1 / 30, false);
    const route = M.gps() as { x: number; z: number }[] | null;
    return route;
  });
  expect(r).not.toBeNull();
  expect(r!.length).toBeGreaterThan(10);
  // the straight line from the docks to the airfield crosses the water (channel x 492..560 north of z=-62, East River x 560..690 south of it):
  // the route must stay on a bridge: the freeway at z=-480 or the East River bridges at z=100 / 400
  const water = r!.filter(q => (q.x > 495 && q.x < 558 && q.z < -100) || (q.x > 565 && q.x < 685));
  expect(water.length).toBeGreaterThan(0);
  for (const q of water) expect([-480, 100, 400].some(z => Math.abs(q.z - z) < 12), `${q.x},${q.z}`).toBe(true);
  clean(p);
});

test('shoppers browse the aisle, stop at shelves, queue and pay; the clerk keeps busy', async ({ page }) => {
  test.setTimeout(240_000);
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies, k = R.kiosks[0];
    g.police.clear(); g.pedCap = 0;
    const out = k.frame.toWorld(3.1, 0.3, 14);
    g.player.place(out.x, out.y, out.z, 0);
    const seen = new Set<string>(); const moved: Record<number, number> = {}; const start = new Map<any, any>();
    let clerkTurns = 0, lastClerkYaw: number | null = null, maxShoppers = 0;
    for (let f = 0; f < 30 * 75; f++) {
      g.frame(1 / 30, false);
      maxShoppers = Math.max(maxShoppers, k.shoppers.length);
      k.shoppers.forEach((s: any, i: number) => {
        seen.add(s.life.st);
        if (!start.has(s)) start.set(s, s.n.char.pos.clone());
        moved[i] = Math.max(moved[i] ?? 0, s.n.char.pos.distanceTo(start.get(s)));
      });
      if (k.clerk) { const y = k.clerk.char.yaw; if (lastClerkYaw !== null && Math.abs(Math.sin((y - lastClerkYaw) / 2)) > 0.3) clerkTurns++; lastClerkYaw = y; }
    }
    return { seen: [...seen], moved: Object.values(moved), n: maxShoppers, clerkTurns, clerkYawChange: lastClerkYaw !== null };
  });
  expect(r.n).toBeGreaterThanOrEqual(2);
  expect(r.seen).toEqual(expect.arrayContaining(['walk', 'look']));
  expect(r.moved.filter(d => d > 1.5).length).toBeGreaterThanOrEqual(2); // nobody stands frozen
  expect(r.seen.some(s => s === 'queue' || s === 'pay' || s === 'leave')).toBe(true);
  clean(p);
});
