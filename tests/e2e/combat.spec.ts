import { test, expect, type Page } from '@playwright/test';
import { watch, boot, step, clean, quietStreets } from './helpers';

/** Points the camera so its centre ray passes through a world point (a few passes: the orbit camera moves as it turns). */
async function aimAt(page: Page, target: string) {
  await page.evaluate((target) => {
    const g = (window as any).__game, T = g.renderer.camera.position.constructor;
    const v = (window as any).__victim;
    for (let i = 0; i < 6; i++) {
      // a wounded civilian bolts for a quarter second after the shot and ends up side-on: his near arm then really is in front of his chest
      // (a legitimate 'arm' hit). The scene holds him in place, so it also holds him facing the shooter.
      if (v) { v.brain = 'scripted'; v.char.vel.set(0, 0, 0); v.char.yaw = Math.atan2(g.player.pos.x - v.char.pos.x, g.player.pos.z - v.char.pos.z); }
      const p = (new Function('g', `return ${target}`))(g);
      g.frame(1 / 60, false);
      const cam = g.renderer.camera.getWorldPosition(new T());
      const d = new T(p.x - cam.x, p.y - cam.y, p.z - cam.z).normalize();
      g.cam.pitch = Math.asin(d.y); g.cam.yaw = Math.atan2(-d.x, -d.z);
      g.cam.update(0, g.player.pos, 'aim'); g.frame(1 / 60, false);
    }
  }, target);
}
/** Spawns a civilian standing still `dist` m in front of the player, facing them. */
async function victim(page: Page, dist: number, role = 'civilian') {
  await page.evaluate(({ dist, role }) => {
    const g = (window as any).__game;
    const yaw = g.player.yaw, x = g.player.pos.x + Math.sin(yaw) * dist, z = g.player.pos.z + Math.cos(yaw) * dist;
    const n = g.pop.spawn(role, x, z, g.player.pos.y + 0.2); n.persistent = true; n.brain = 'scripted'; n.char.yaw = yaw + Math.PI; n.char.vel.set(0, 0, 0);
    (window as any).__victim = n;
  }, { dist, role });
  await step(page, 0.3);
}
/** Fires one round; returns what it hit (zone / damage / whether it killed). */
async function fireOnce(page: Page): Promise<{ kind?: string; zone?: string; damage?: number; killed?: boolean }> {
  const r = await page.evaluate(() => {
    const g = (window as any).__game; (window as any).__victim.brain = 'scripted';
    const shots: any[] = []; const prev = g.combat.onShot; g.combat.onShot = (e: any) => { shots.push(e); prev?.(e); };
    g.input.tap('Mouse0'); g.frame(1 / 60, false); g.combat.onShot = prev;
    const h = shots[0]?.hits[0]; return { kind: h?.kind, zone: h?.zone, damage: h?.damage, killed: h?.killed };
  });
  await step(page, 0.25, { dt: 1 / 60 });
  return r;
}
async function setup(page: Page, weapon: string) {
  await boot(page);
  await quietStreets(page);
  await page.evaluate((weapon) => { const g = (window as any).__game; g.police.clear?.(); g.pcombat.give(weapon, 200); g.pcombat.inv.select(weapon); g.cam.yaw = g.player.yaw + Math.PI; g.input.press('Mouse2'); }, weapon);
  await step(page, 0.6, { dt: 1 / 60 });
}

test('a head shot kills in one round; a pistol needs two to the chest', async ({ page }) => {
  const p = watch(page);
  await setup(page, 'pistol');
  await victim(page, 7);
  await aimAt(page, 'window.__victim.char.human.head.getWorldPosition(new g.renderer.camera.position.constructor()).add({x:0,y:0.1,z:0})');
  expect(await page.evaluate(() => !!(window as any).__game.pcombat.aimTarget)).toBe(true); // the dot is red over them
  expect(await fireOnce(page)).toMatchObject({ kind: 'character', zone: 'head', killed: true });
  expect(await page.evaluate(() => (window as any).__victim.char.alive)).toBe(false);
  expect(await page.evaluate(() => (window as any).__game.pcombat.headshotMarker)).toBe(true);

  // torso: first round leaves them standing, the second drops them
  await page.evaluate(() => { const g = (window as any).__game; g.police.clear?.(); });
  await victim(page, 7);
  const chest = 'window.__victim.char.human.spine.getWorldPosition(new g.renderer.camera.position.constructor())';
  await aimAt(page, chest);
  expect(await fireOnce(page)).toMatchObject({ kind: 'character', zone: 'torso', killed: false });
  const h1 = await page.evaluate(() => (window as any).__victim.char.health);
  expect(h1).toBeLessThan(100); expect(h1).toBeGreaterThan(0);
  // let the recoil settle while the (scared) victim is held in place
  await page.evaluate(() => { const g = (window as any).__game, v = (window as any).__victim; for (let i = 0; i < 60; i++) { v.brain = 'scripted'; v.char.vel.set(0, 0, 0); g.frame(1 / 60, false); } });
  await aimAt(page, chest);
  expect(await fireOnce(page)).toMatchObject({ kind: 'character', zone: 'torso', killed: true });
  expect(await page.evaluate(() => (window as any).__victim.char.alive)).toBe(false);
  clean(p);
});

test('bullets land on the reticle point on a wall', async ({ page }) => {
  const p = watch(page);
  await setup(page, 'rifle');
  // find a wall 6-40 m away by sweeping the camera around
  const found = await page.evaluate(() => {
    const g = (window as any).__game, T = g.renderer.camera.position.constructor;
    for (let k = 0; k < 24; k++) {
      g.cam.yaw = k / 24 * Math.PI * 2; g.cam.pitch = 0.05; g.cam.update(0.2, g.player.pos, 'aim'); g.frame(1 / 60, false);
      const o = new T(), d = new T(); g.cam.aimRay(o, d);
      const hit = g.physics.ray(o.x, o.y, o.z, d.x, d.y, d.z, 40, undefined, g.player.collider);
      if (hit && hit.toi > 8 && Math.abs(hit.normal.y) < 0.3) return true;
    }
    return false;
  });
  expect(found).toBe(true);
  await step(page, 0.8, { dt: 1 / 60 }); // settle (first-shot accuracy)
  const res = await page.evaluate(() => {
    const g = (window as any).__game; const shots: any[] = [];
    const prev = g.combat.onShot; g.combat.onShot = (e: any) => { shots.push(e); prev?.(e); };
    const aim = g.pcombat.aimPoint.clone(); const dist = g.renderer.camera.position.distanceTo(aim);
    g.input.tap('Mouse0'); g.frame(1 / 60, false); g.combat.onShot = prev;
    const hit = shots[0]?.hits[0];
    return { miss: hit ? hit.point.distanceTo(aim) : 99, kind: hit?.kind, dist, cone: g.pcombat.cone };
  });
  expect(res.kind).toBe('static');
  expect(res.miss).toBeLessThan(0.05 + res.dist * 0.012);
  clean(p);
});

test('rounds break car glass and kill the driver inside; the car coasts', async ({ page }) => {
  const p = watch(page);
  await setup(page, 'rifle');
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const T = g.renderer.camera.position.constructor;
    const yaw = g.player.yaw, x = g.player.pos.x + Math.sin(yaw) * 8, z = g.player.pos.z + Math.cos(yaw) * 8;
    const v = g.vehicles.spawn('sedan', x, z, yaw + Math.PI / 2); // a closed car: a random traffic car could be the open-top convertible (no side glass to break)
    const n = g.pop.spawn('civilian', x, z, 0.5); n.persistent = true; v.persistent = true;
    g.traffic.seat(n, v);
    for (let i = 0; i < 20; i++) g.frame(1 / 60, false);
    // aim at the driver's head through the side window
    for (let k = 0; k < 6; k++) {
      const q = n.char.human.head.getWorldPosition(new T()); q.y += 0.08; g.frame(1 / 60, false);
      const cam = g.renderer.camera.getWorldPosition(new T()); const d = new T(q.x - cam.x, q.y - cam.y, q.z - cam.z).normalize();
      g.cam.pitch = Math.asin(d.y); g.cam.yaw = Math.atan2(-d.x, -d.z); g.frame(1 / 60, false);
    }
    const shots: any[] = []; const prev = g.combat.onShot; g.combat.onShot = (e: any) => { shots.push(e); prev?.(e); };
    g.input.tap('Mouse0'); g.frame(1 / 60, false); g.combat.onShot = prev;
    const h = shots[0]?.hits[0];
    return { car: v.kind, kind: h?.kind, glass: h?.throughGlass, zone: h?.zone, alive: n.char.alive, handbrake: v.input.handbrake, broken: (v as any).brokenMask ?? -1 };
  });
  console.log('glass', JSON.stringify(r));
  expect(r).toMatchObject({ kind: 'character', glass: true, alive: false, handbrake: false });
  clean(p);
});
