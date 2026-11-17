import { test, expect } from '@playwright/test';
import { watch, boot, step, clean, state } from './helpers';

/** One test per bug found in review / bug-bash, so they stay fixed. */
test.describe.configure({ mode: 'serial' });

test('bailing out of a fast car at low health shows the down screen and respawns', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-420, 0.3, -102, 0); const v = g.vehicles.spawn('sedan', -420, -98, -Math.PI / 2); v.persistent = true; g.seatPlayer(v); g.player.health = 5; });
  await step(page, 2, { hold: ['KeyW'] });
  expect(await state<number>(page, 'Math.abs(window.__game.playerVehicle.speed)')).toBeGreaterThan(9);
  await page.evaluate(() => (window as any).__game.exitVehicle());
  await step(page, 0.5);
  expect(await state<number>(page, 'window.__game.deathT')).toBeGreaterThanOrEqual(0);
  await step(page, 5);
  expect(await state<boolean>(page, 'window.__game.player.alive')).toBe(true);
  expect(await state<number>(page, 'window.__game.deathT')).toBe(-1);
  clean(p);
});

test('a respray never dents other cars of the same model; the garage only charges once per visit and not for clean cars', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const a = (window as any).__meridian.activities;
    const sum = (geo: any) => { const arr = geo.attributes.position.array; let s = 0; for (let i = 0; i < arr.length; i += 7) s += arr[i]; return s; };
    const other = g.vehicles.spawn('sedan', -150, 60, 0); other.persistent = true;
    const tplSum = sum(other.tpl.body);
    const v = g.vehicles.spawn('sedan', -200, 102, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
    // clean car: no charge
    const m0 = g.money; for (let i = 0; i < 120; i++) g.frame(1 / 30, false);
    const cleanCharge = m0 - g.money;
    // damaged car: one charge, then sitting there costs nothing more
    g.playerVehicle.phys.teleport(-260, 0.6, 102, Math.PI / 2); for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    v.damage(400, v.position.clone(), null);
    g.money = 1000;
    g.playerVehicle.phys.teleport(-200, 0.6, 102, Math.PI / 2);
    for (let i = 0; i < 600; i++) g.frame(1 / 30, false);
    const charged = 1000 - g.money;
    v.damage(400, v.position.clone(), null); // dent again after respray
    void a;
    return { cleanCharge, charged, tplUnchanged: Math.abs(sum(other.tpl.body) - tplSum) < 1e-6, otherShared: other.bodyMesh.geometry === other.tpl.body, vOwn: v.bodyMesh.geometry !== v.tpl.body };
  });
  expect(r.cleanCharge).toBe(0);
  expect(r.charged).toBe(150);
  expect(r.tplUnchanged).toBe(true);
  expect(r.otherShared).toBe(true);
  expect(r.vOwn).toBe(true);
  clean(p);
});

test('dead officers and wrecked cruisers are not kept forever', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.police.report('copKill', g.player.pos); });
  await step(page, 20);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    for (const n of g.police.foot) n.char.damage(1000, g.player, g.time);
    for (const u of g.police.units) u.v.damage(5000, u.v.position.clone(), null);
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    const deadPersistent = g.pop.npcs.filter((n: any) => n.role === 'police' && !n.alive && n.persistent).length;
    const wreckPersistent = g.vehicles.list.filter((v: any) => v.kind === 'police' && v.destroyed && v.persistent).length;
    return { deadPersistent, wreckPersistent };
  });
  expect(r.deadPersistent).toBe(0);
  expect(r.wreckPersistent).toBe(0);
  clean(p);
});

test('race rivals wait for the countdown', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const M = (window as any).__meridian.missions; for (const id of ['m1', 'm2', 'm3', 'm4']) M.completed.add(id); M.start(M.available()[0]); });
  await step(page, 1);
  await page.evaluate(() => { const g = (window as any).__game; const v = g.vehicles.list.filter((x: any) => x.kind === 'coupe' && x.persistent).sort((a: any, b: any) => Math.hypot(a.position.x + 443.5, a.position.z - 406.7) - Math.hypot(b.position.x + 443.5, b.position.z - 406.7))[0]; g.seatPlayer(v); v.phys.teleport(-436, 0.7, 403.5, Math.PI / 2); });
  await step(page, 2.2);
  const speeds = await state<number[]>(page, 'window.__game.traffic.cars.filter(c => c.v.kind === "coupe" && c.persistent).map(c => Math.abs(c.v.speed))');
  expect(speeds.length).toBe(3);
  for (const s of speeds) expect(s).toBeLessThan(2);
  await step(page, 4);
  const after = await state<number[]>(page, 'window.__game.traffic.cars.filter(c => c.v.kind === "coupe" && c.persistent).map(c => Math.abs(c.v.speed))');
  expect(Math.max(...after)).toBeGreaterThan(5);
  clean(p);
});

test('dying while getting into a car does not seat the body', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-280, 0.25, -95.5, Math.PI / 2); g.vehicles.spawn('sedan', -278, -97.5, Math.PI / 2).persistent = true; });
  await step(page, 0.3);
  await page.evaluate(() => { const g = (window as any).__game; g.toggleVehicle(); g.frame(1 / 30, false); g.player.damage(1000, null, g.time); g.playerDown('down'); });
  await step(page, 1.5);
  expect(await state<boolean>(page, '!!window.__game.playerVehicle')).toBe(false);
  clean(p);
});

test('saving on the pier deck loads back onto the deck', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-50, 1.3, 470, 0); for (let i = 0; i < 20; i++) g.frame(1 / 30, false); (window as any).__meridian.save(); });
  await page.goto('./?autostart=1&continue=1');
  await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__game.stop());
  await step(page, 1);
  expect(await state<number>(page, 'window.__game.player.pos.y')).toBeGreaterThan(1);
  expect(await state<boolean>(page, 'window.__game.player.swimming')).toBe(false);
  clean(p);
});

test('pausing closes the shop; the wheel never spends a medkit on a downed player', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-300, 0.25, 10.2, 0); g.input.tap('KeyE'); g.frame(1 / 30, false); });
  expect(await state<boolean>(page, 'window.__meridian.activities.shopIsOpen')).toBe(true);
  await page.evaluate(() => { (window as any).__meridian.pause(); (window as any).__meridian.resume(); });
  expect(await state<boolean>(page, 'window.__meridian.activities.shopIsOpen')).toBe(false);
  expect(await state<boolean>(page, 'window.__game.menuOpen')).toBe(false);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const M = (window as any).__meridian;
    g.pcombat.inv.medkits = 2; g.player.health = 30;
    M.openWheel();
    for (let i = 0; i < 4; i++) { g.input.mouseDX = -60; g.frame(1 / 30, false); }
    g.player.damage(1000, null, g.time); g.playerDown('down');
    for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
    return { medkits: g.pcombat.inv.medkits, wheel: g.wheelOpen };
  });
  expect(r.medkits).toBe(2);
  expect(r.wheel).toBe(false);
  clean(p);
});

test('playtest fixes: populated start, M3 enemies on the ground, fast police response, damage cap, no respray charge after a delivery', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  expect(await state<number>(page, 'window.__game.traffic.cars.length')).toBeGreaterThanOrEqual(5);
  expect(await state<number>(page, 'window.__game.pop.npcs.length')).toBeGreaterThanOrEqual(6);
  // M3 enemies must all stand on the ground (none on warehouse roofs)
  const ys = await page.evaluate(() => {
    const g = (window as any).__game; const M = (window as any).__meridian.missions;
    for (const id of ['m1', 'm2']) M.completed.add(id);
    M.start(M.available().find((d: any) => d.id === 'm3'));
    g.player.place(398, 0.3, 100, 0);
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    return g.pop.npcs.filter((n: any) => n.role === 'gang' && n.persistent).map((n: any) => n.pos.y);
  });
  expect(ys.length).toBe(8);
  for (const y of ys) expect(y).toBeLessThan(1);
  await page.evaluate(() => { (window as any).__meridian.missions.abort(); });
  // police show up quickly at heat 2+
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-150, 0.3, -96, 0); g.police.report('kill', g.player.pos); g.police.state.add('kill'); });
  await step(page, 8);
  expect(await state<number>(page, 'window.__game.police.units.length + window.__game.police.foot.length')).toBeGreaterThan(0);
  // damage cap: a single burst can't take more than 45 health in one second
  const hp = await page.evaluate(() => { const g = (window as any).__game; g.player.health = 100; g.player.armor = 0; for (let i = 0; i < 20; i++) g.player.damage(20, null, g.time + 100); return g.player.health; });
  expect(hp).toBeGreaterThanOrEqual(55);
  // M1 delivery at the garage doesn't trigger a paid respray
  await page.evaluate(() => { const g = (window as any).__game; g.police.clear(); g.player.health = 100; });
  const money = await page.evaluate(() => {
    const g = (window as any).__game; const M = (window as any).__meridian.missions;
    M.completed.clear(); M.start(M.available()[0]);
    const v = g.vehicles.spawn('sedan', -262, -96, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    v.phys.teleport(470, 0.7, 120, 0); for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    v.damage(300, v.position.clone(), null);
    const before = g.money;
    v.phys.teleport(-200, 0.7, 102, Math.PI / 2); for (let i = 0; i < 200; i++) g.frame(1 / 30, false);
    return { gained: g.money - before, done: M.completed.has('m1') };
  });
  expect(money.done).toBe(true);
  expect(money.gained).toBe(600);
  clean(p);
});
