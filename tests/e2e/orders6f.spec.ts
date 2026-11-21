import { test, expect, type Page } from '@playwright/test';
import { boot, step, quietStreets } from './helpers';

/** R6-F: shouted orders, human shield + car hostage, blood (capped), directional damage indicator. Screenshots to FX_SHOTS. */
test.describe.configure({ mode: 'serial' });
let page: Page;
const SHOTS = process.env.FX_SHOTS ?? 'test-results';
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await boot(page); await quietStreets(page); });
test.afterAll(async () => { await page.close(); });

/** Stands the player at a clear spot with a pistol raised; a civilian stands `dist` m ahead (persistent, idle). */
async function scene(dist = 5) {
  await page.evaluate((dist) => {
    const g = (window as any).__game;
    g.police.clear?.(); g.clockRunning = false; g.hour = 14;
    for (const n of [...g.pop.npcs]) if ((!n.persistent || n === (window as any).__n) && !n.char.inVehicle) g.pop.remove(n);
    g.player.place(-280, 0.25, -95.5, Math.PI / 2); g.cam.snapBehind(Math.PI / 2);
    g.pcombat.give('pistol', 200); g.pcombat.inv.select('pistol'); g.input.press('Mouse2');
    const yaw = g.player.yaw, x = g.player.pos.x + Math.sin(yaw) * dist, z = g.player.pos.z + Math.cos(yaw) * dist;
    const n = g.pop.spawn('civilian', x, z, g.player.pos.y + 0.2); n.persistent = true; n.brain = 'idle'; n.nerve = 0; n.char.yaw = yaw + Math.PI;
    (window as any).__n = n;
  }, dist);
  await step(page, 0.8, { dt: 1 / 60 });
  // aim the camera at their chest
  await page.evaluate(() => {
    const g = (window as any).__game, n = (window as any).__n, T = g.renderer.camera.position.constructor;
    for (let i = 0; i < 6; i++) {
      const p = n.char.human.spine.getWorldPosition(new T()); g.frame(1 / 60, false);
      const cam = g.renderer.camera.getWorldPosition(new T()); const d = new T(p.x - cam.x, p.y - cam.y, p.z - cam.z).normalize();
      g.cam.pitch = Math.asin(d.y); g.cam.yaw = Math.atan2(-d.x, -d.z); g.cam.update(0, g.player.pos, 'aim'); g.frame(1 / 60, false);
    }
  });
}
/** headless swiftshader barely ticks the CSS timeline, so screenshots pin the fades at their peak */
const peak = () => page.addStyleTag({ content: '.ma-fx-menu.is-on{transition:none!important;opacity:1!important}.ma-fx-ind.is-on{animation:none!important;opacity:1!important}' });
const shot = async (name: string) => {
  if (name === 'orders-menu' || name === 'hit-indicator') await peak(); await page.evaluate(() => (window as any).__game.frame(1 / 60, true)); await page.screenshot({ path: `${SHOTS}/r6f-${name}.png` }); };

test('aim + hold the orders key + "Get down": the person kneels within 2 s; police never comply', async () => {
  await scene(5);
  await page.evaluate(() => { const g = (window as any).__game; g.input.press('KeyG'); });
  await step(page, 0.2, { dt: 1 / 60 });
  expect(await page.evaluate(() => (window as any).__game.orders.open)).toBe(true);
  expect(await page.evaluate(() => (window as any).__game.orders.items.map((i: any) => i.label))).toEqual(['Get down', 'Come here', 'Hands up', 'Beat it']);
  await shot('orders-menu');
  await page.evaluate(() => { const g = (window as any).__game; (window as any).__rnd = Math.random; Math.random = () => 0.3; g.input.tap('Digit1'); g.frame(1 / 60, false); Math.random = (window as any).__rnd; });
  await step(page, 1.9, { dt: 1 / 30 });
  const r = await page.evaluate(() => { const n = (window as any).__n; return { brain: n.brain, order: n.order, act: n.char.human.actionName }; });
  expect(r).toEqual({ brain: 'ordered', order: 'kneel', act: 'kneel_head' });
  await page.evaluate(() => (window as any).__game.input.release('KeyG'));
  await step(page, 1.0, { dt: 1 / 30 });
  await shot('kneel');
  // a police officer never obeys
  const cop = await page.evaluate(() => {
    const g = (window as any).__game, c = g.pop.spawn('police', g.player.pos.x + 6, g.player.pos.z, 0.45);
    return g.orders.give('kneel', c);
  });
  expect(cop).toBe(false);
});

test('"Come here" walks the person to you; they relax after the order times out', async () => {
  await scene(7);
  const d0 = await page.evaluate(() => { const g = (window as any).__game, n = (window as any).__n; const o = Math.random; Math.random = () => 0.3; const ok = g.orders.give('come', n); Math.random = o; return { ok, d: n.pos.distanceTo(g.player.pos) }; });
  expect(d0.ok).toBe(true);
  await step(page, 4, { dt: 1 / 30 });
  const d1 = await page.evaluate(() => { const g = (window as any).__game, n = (window as any).__n; return n.pos.distanceTo(g.player.pos); });
  expect(d1).toBeLessThan(2.4);
  await page.evaluate(() => { const n = (window as any).__n; n.orderMax = 1; });
  await step(page, 2, { dt: 1 / 30 });
  expect(await page.evaluate(() => (window as any).__n.brain)).not.toBe('ordered');
});

test('human shield: stays in front, own shots never hit them, E lets go with a shove', async () => {
  await scene(1.2);
  await page.evaluate(() => { const g = (window as any).__game; g.orders.grab((window as any).__n); });
  await step(page, 1.5, { dt: 1 / 30 });
  const r = await page.evaluate(() => {
    const g = (window as any).__game, n = (window as any).__n, p = g.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), dx = n.pos.x - p.pos.x, dz = n.pos.z - p.pos.z;
    return { brain: n.brain, d: Math.hypot(dx, dz), ahead: (dx * fx + dz * fz) / Math.hypot(dx, dz), held: n.char.heldBy === p };
  });
  expect(r.brain).toBe('hostage'); expect(r.held).toBe(true); expect(r.d).toBeLessThan(1.3); expect(r.ahead).toBeGreaterThan(0.8);
  await shot('shield');
  // shoot straight through them: no damage to the shield
  const hp0 = await page.evaluate(() => (window as any).__n.char.health);
  await page.evaluate(() => { const g = (window as any).__game; for (let i = 0; i < 4; i++) { g.input.tap('Mouse0'); for (let k = 0; k < 14; k++) g.frame(1 / 60, false); } });
  expect(await page.evaluate(() => (window as any).__n.char.health)).toBe(hp0);
  // cops hold fire when the hostage is in the line of fire, shoot when it is clear
  const cs = await page.evaluate(() => {
    const g = (window as any).__game, p = g.player, T = p.pos.constructor;
    const inLine = new T(p.pos.x + Math.sin(p.yaw) * 10, 0, p.pos.z + Math.cos(p.yaw) * 10);
    const flank = new T(p.pos.x + Math.cos(p.yaw) * 10, 0, p.pos.z - Math.sin(p.yaw) * 10);
    return { inLine: g.orders.clearShot(inLine), flank: g.orders.clearShot(flank) };
  });
  expect(cs).toEqual({ inLine: false, flank: true });
  await page.evaluate(() => (window as any).__game.input.tap('KeyE'));
  await step(page, 0.3, { dt: 1 / 30 });
  const after = await page.evaluate(() => { const n = (window as any).__n; return { brain: n.brain, held: !!n.char.heldBy, shield: (window as any).__game.orders.shield }; });
  expect(after.held).toBe(false); expect(after.shield).toBeNull(); expect(['flee', 'surrender']).toContain(after.brain);
});

test('"Get in the car": the hostage sits in the passenger seat, rides 50 m with you and can be ordered out', async () => {
  await scene(6);
  await page.evaluate(() => {
    const g = (window as any).__game, p = g.player;
    g.player.place(-330, 0.25, -95.5, Math.PI / 2); g.cam.snapBehind(Math.PI / 2);
    const v = g.vehicles.spawn('sedan', -327, -98, Math.PI / 2); v.persistent = true; v.ignition = true; g.lastPlayerVehicle = v; (window as any).__v = v;
    const n = (window as any).__n; n.char.place(-322, 0.25, -92, 0);
    void p;
  });
  await step(page, 0.4, { dt: 1 / 30 });
  expect(await page.evaluate(() => (window as any).__game.orders.menuFor((window as any).__n).map((i: any) => i.id))).toContain('car');
  await page.evaluate(() => { const g = (window as any).__game, n = (window as any).__n; const o = Math.random; Math.random = () => 0.3; (window as any).__ok = g.orders.give('car', n); Math.random = o; });
  expect(await page.evaluate(() => (window as any).__ok)).toBe(true);
  await step(page, 8, { dt: 1 / 30 });
  const seated = await page.evaluate(() => { const g = (window as any).__game, n = (window as any).__n, v = (window as any).__v; return { inCar: n.char.inVehicle === v, seats: g.orders.seated.length, brain: n.brain }; });
  expect(seated).toEqual({ inCar: true, seats: 1, brain: 'passenger' });
  // get in and drive
  const start = await page.evaluate(() => { const g = (window as any).__game, v = (window as any).__v; g.seatPlayer(v); return v.position.x; });
  await step(page, 8, { dt: 1 / 30, hold: ['KeyW'] });
  const drive = await page.evaluate(() => { const g = (window as any).__game, n = (window as any).__n, v = (window as any).__v; return { dist: Math.hypot(v.position.x - -327, v.position.z - -98), inCar: n.char.inVehicle === v, alive: n.alive, seats: g.orders.seated.length, near: n.char.human.root.parent === v.visual }; });
  expect(start).toBeGreaterThan(-340);
  expect(drive.dist).toBeGreaterThan(50); expect(drive.inCar).toBe(true); expect(drive.seats).toBe(1); expect(drive.near).toBe(true);
  await step(page, 3, { dt: 1 / 30, hold: ['KeyS'] });
  await shot('hostage-car');
  // out of the car, then order the hostage out
  await page.evaluate(() => { const g = (window as any).__game, v = (window as any).__v; g.exitVehicle(true); g.player.place(v.position.x + 2.5, 0.25, v.position.z, g.player.yaw); });
  await step(page, 0.5, { dt: 1 / 30 });
  const out = await page.evaluate(() => { const g = (window as any).__game, n = (window as any).__n; const t = g.orders.findTarget(); const ok = t === n && g.orders.give('out', n); return { ok, inCar: !!n.char.inVehicle }; });
  expect(out).toEqual({ ok: true, inCar: false });
});

test('blood: spatter and pools appear, stay capped, and the Blood toggle turns them off', async () => {
  await scene(5);
  await page.evaluate(() => { const g = (window as any).__game; g.blood.clear(); g.pop.remove((window as any).__n); });
  await scene(4);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, n = (window as any).__n;
    n.brain = 'scripted'; n.char.vel.set(0, 0, 0);
    const out: any = {};
    for (let i = 0; i < 4 && n.alive; i++) { g.input.tap('Mouse0'); for (let k = 0; k < 16; k++) { n.brain = 'scripted'; g.frame(1 / 60, false); } }
    out.dead = !n.alive; out.splats = g.blood.splatCount; out.wounds = g.blood.woundCount; out.poolsAfterKill = g.blood.poolCount;
    return out;
  });
  expect(r.dead).toBe(true); expect(r.splats).toBeGreaterThan(0); expect(r.poolsAfterKill).toBe(1); expect(r.wounds).toBeGreaterThan(0);
  await step(page, 15, { dt: 1 / 30 });
  const grown = await page.evaluate(() => { const g = (window as any).__game, m = new g.renderer.camera.position.constructor(); const mat = new (g.renderer.camera.matrixWorld.constructor)(); g.blood.pools.getMatrixAt(0, mat); const e = mat.elements; void m; return Math.hypot(e[0], e[1], e[2]); });
  expect(grown).toBeGreaterThan(0.8); // the pool grew from a puddle (~0.12 m) to ~1 m across
  await page.evaluate(() => {
    const g = (window as any).__game, n = (window as any).__n, T = g.renderer.camera.position.constructor, p = n.pos;
    g.player.place(p.x - 3.2, 0.25, p.z - 0.4, Math.PI / 2);
    for (let i = 0; i < 6; i++) { const q = n.char.human.root.getWorldPosition(new T()); q.y += 0.2; g.frame(1 / 60, false); const cam = g.renderer.camera.getWorldPosition(new T()); const d = new T(q.x - cam.x, q.y - cam.y, q.z - cam.z).normalize(); g.cam.pitch = Math.asin(d.y); g.cam.yaw = Math.atan2(-d.x, -d.z); g.cam.update(0, g.player.pos, 'aim'); g.frame(1 / 60, false); }
  });
  await shot('blood');
  const caps = await page.evaluate(() => {
    const g = (window as any).__game;
    for (let i = 0; i < 600; i++) g.blood.splat(i * 0.1, 0, 0, 0, 1, 0, 0.3);
    for (let i = 0; i < 60; i++) g.blood.pool(i, 0, 5);
    const a = { splats: g.blood.splatCount, pools: g.blood.poolCount };
    g.settings.blood = false; g.frame(1 / 60, false);
    const before = g.blood.splatCount; g.blood.splat(0, 0, 0, 0, 1, 0, 0.3); g.blood.pool(1, 0, 1);
    return { ...a, offAdds: g.blood.splatCount - before, enabled: g.blood.enabled };
  });
  expect(caps.splats).toBe(120); expect(caps.pools).toBe(18); expect(caps.offAdds).toBe(0); expect(caps.enabled).toBe(false);
  await page.evaluate(() => { (window as any).__game.settings.blood = true; });
});

test('damage feedback: the indicator points at the shooter; the screen reddens; low health darkens it', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game, p = g.player, T = p.pos.constructor;
    g.player.place(-280, 0.25, -95.5, 0); g.cam.yaw = Math.PI; g.cam.update(0, g.player.pos, 'foot'); // camera looks along +Z
    const mk = (dx: number, dz: number) => ({ pos: new T(p.pos.x + dx, 0, p.pos.z + dz) });
    const w = g.combat.constructor; void w;
    const angles: Record<string, number> = {};
    for (const [k, dx, dz] of [['ahead', 0, 8], ['right', -8, 0], ['left', 8, 0], ['behind', 0, -8]] as [string, number, number][]) {
      g.onPlayerHurt(mk(dx, dz), 10); angles[k] = g.fx.last.angle;
    }
    return { angles, vignette: g.fx.vignette };
  });
  expect(Math.abs(r.angles.ahead)).toBeLessThan(5);
  expect(r.angles.right).toBeGreaterThan(80); expect(r.angles.right).toBeLessThan(100);
  expect(r.angles.left).toBeLessThan(-80); expect(r.angles.left).toBeGreaterThan(-100);
  expect(Math.abs(r.angles.behind)).toBeGreaterThan(170);
  expect(r.vignette).toBeGreaterThan(0.3);
  await page.evaluate(() => { const g = (window as any).__game; g.onPlayerHurt({ pos: new g.player.pos.constructor(g.player.pos.x - 8, 0, g.player.pos.z + 4) }, 12); g.player.health = 18; });
  await step(page, 0.1, { dt: 1 / 60 });
  await page.evaluate(() => { const g = (window as any).__game; g.onPlayerHurt({ pos: new g.player.pos.constructor(g.player.pos.x - 8, 0, g.player.pos.z + 4) }, 12); }); // fresh, so the 1.2 s fade is at its peak
  await shot('hit-indicator');
  await step(page, 2.5, { dt: 1 / 30 });
  expect(await page.evaluate(() => (window as any).__game.fx.lowHealth)).toBeGreaterThan(0.5);
  await shot('low-health');
  await page.evaluate(() => { (window as any).__game.player.health = 100; });
});
