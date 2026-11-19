import { test, expect } from '@playwright/test';
import { watch, boot, clean, quietStreets } from './helpers';

/** Realism round 2: penetration, ballistic drop, car-vs-pedestrian impacts, settings toggles. */

test('rifle rounds punch through a car body at reduced damage; pistol-grade power does not', async ({ page }) => {
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(async () => {
    const g = (window as any).__game, T = g.player.pos.constructor;
    const px = g.player.pos.x + 12, pz = g.player.pos.z + 12, y = g.player.pos.y;
    const v = g.vehicles.spawn('sedan', px, pz, 0); v.persistent = true; v.parked = true;
    for (let i = 0; i < 40; i++) g.frame(1 / 60, false);
    // shoot sideways (along +x) through the doors, 2 m above ground is roof; aim at door height
    const o = new T(px - 6, y + 0.75, v.position.z), d = new T(1, 0, 0);
    const strong = g.combat.trace(o, d, 30, null, { power: 80 });
    const weak = g.combat.trace(o, d, 30, null, { power: 10 });
    return { strongPen: strong.pen.length, strongMul: strong.damageMul, weakPen: weak.pen.length, weakKind: weak.kind };
  });
  expect(r.strongPen).toBeGreaterThan(0);
  expect(r.strongMul).toBeLessThan(0.7); expect(r.strongMul).toBeGreaterThan(0.1);
  expect(r.weakPen).toBe(0); expect(r.weakKind).toBe('vehicle');
  clean(p);
});

test('sniper rounds drop at range (shot lands below the aim line); pistols stay flat', async ({ page }) => {
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, T = g.player.pos.constructor;
    const defs: any = {};
    g.combat.onShot = (e: any) => { defs[e.weapon.id] = e.weapon; };
    for (const id of ['sniper', 'pistol']) {
      g.pcombat.give(id, 50); g.pcombat.inv.select(id);
      g.input.press('Mouse2'); for (let i = 0; i < 40; i++) g.frame(1 / 60, false);
      g.input.tap('Mouse0'); g.frame(1 / 60, false); g.input.release('Mouse2');
      for (let i = 0; i < 90; i++) g.frame(1 / 60, false);
    }
    const out: any = {};
    for (const id of ['sniper', 'pistol']) {
      const o = new T(g.player.pos.x, 300, g.player.pos.z), d = new T(1, 0, 0);
      const hits = g.combat.shoot(g.player, defs[id], o, d, 0);
      out[id] = 300 - hits[0].point.y;
    }
    return out;
  });
  expect(r.sniper).toBeGreaterThan(0.3);
  expect(r.pistol).toBeLessThan(0.01);
  clean(p);
});

test('car at 30 mph kills a pedestrian and dents; at 12 mph knocks down without killing', async ({ page }) => {
  test.setTimeout(120_000);
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const res = await page.evaluate(() => {
    const g = (window as any).__game;
    const out: any = {};
    for (const [name, sp] of [['slow', 5.4], ['fast', 13.4]] as const) {
      const x = g.player.pos.x + 20, z = g.player.pos.z + 20;
      const v = g.vehicles.spawn('sedan', x, z, 0); v.persistent = true;
      for (let i = 0; i < 30; i++) g.frame(1 / 60, false);
      const f = v.phys.forward(), c = v.position;
      const n = g.pop.spawn('civilian', c.x + f.x * 2.6, c.z + f.z * 2.6, v.position.y - 0.4); n.persistent = true; n.brain = 'scripted'; n.char.vel.set(0, 0, 0);
      const hp0 = v.health;
      v.phys.body.setLinvel({ x: f.x * sp, y: 0, z: f.z * sp }, true);
      for (let i = 0; i < 3; i++) { v.phys.body.setLinvel({ x: f.x * sp, y: 0, z: f.z * sp }, true); g.frame(1 / 60, false); }
      out[name] = { alive: n.alive, health: n.char.health, carDmg: hp0 - v.health, speed: v.speed };
      g.vehicles.remove(v); g.pop.remove(n);
    }
    return out;
  });
  expect(res.fast.alive).toBe(false);
  expect(res.fast.carDmg).toBeGreaterThan(25);
  expect(res.slow.alive).toBe(true);
  expect(res.slow.health).toBeLessThan(100);
  clean(p);
});

test('settings: colour look defaults to natural; realistic driving toggle lowers grip', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const u = g.renderer.grade.uniforms;
    const natural = { look: g.renderer.look, sat: u.uSat.value, split: u.uSplit.value, vig: u.uVignette.value, driving: g.settings.driving };
    g.renderer.setLook('stylised');
    const styl = { sat: u.uSat.value, split: u.uSplit.value };
    g.renderer.setLook('natural');
    return { natural, styl };
  });
  expect(r.natural.look).toBe('natural'); expect(r.natural.driving).toBe('arcade');
  expect(r.natural.sat).toBeLessThan(1); expect(r.natural.vig).toBeLessThan(0.2);
  expect(r.styl.split).toBe(1); expect(r.styl.sat).toBeGreaterThan(1);
  clean(p);
});

test('gravity: a standing jump at 60 fps rises about half a metre (not snapped back) and lands', async ({ page }) => {
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, c = g.player;
    c.place(-300, 0.05, -102, Math.PI / 2);
    for (let k = 0; k < 60; k++) g.frame(1 / 60, false);
    const y0 = c.pos.y; let maxY = y0, air = 0;
    g.input.tap('Space');
    for (let k = 0; k < 150; k++) { g.frame(1 / 60, false); maxY = Math.max(maxY, c.pos.y); if (!c.grounded) air++; }
    return { rise: maxY - y0, air, grounded: c.grounded, hp: c.health };
  });
  expect(r.rise).toBeGreaterThan(0.35); expect(r.rise).toBeLessThan(0.9);
  expect(r.air).toBeGreaterThan(20); expect(r.grounded).toBe(true); expect(r.hp).toBe(100);
  clean(p);
});
