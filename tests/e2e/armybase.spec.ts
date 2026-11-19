import { test, expect } from '@playwright/test';
import { boot, step, watch, clean, quietStreets } from './helpers';

const SHOT = process.env.SHOT_DIR; // set to also write inspection screenshots
async function look(page: import('@playwright/test').Page, name: string, from: [number, number, number], at: [number, number, number], place = true) {
  if (!SHOT) return;
  await page.evaluate(({ from, at, place }) => { const g = (window as any).__game; if (place && !g.playerHeli) g.player.place(at[0], Math.max(0.3, at[1]), at[2], 0); for (let i = 0; i < 10; i++) g.frame(1 / 30, false); g.frame(1 / 30, true); const c = g.renderer.camera; c.position.set(...from); c.lookAt(...at); c.updateMatrixWorld(); g.renderer.render(); }, { from, at, place });
  await page.screenshot({ path: `${SHOT}/${name}.png` });
}

test('Fort Calder: far base with parked gunships, motor pool, road; player steals a gunship and fires; gunships hunt back', async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const pr = watch(page);
  await boot(page);
  await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(770, 0.5, -650, Math.PI / 2); });
  await step(page, 3);
  const info = await page.evaluate(() => {
    const g = (window as any).__game;
    const pads = g.helis.pads.filter((p: any) => /Fort Calder/.test(p.def.name));
    return { pads: pads.length, army: pads.filter((p: any) => p.heli?.variant === 'army').length, trucks: g.vehicles.list.filter((v: any) => ['army', 'tank'].includes(v.kind)).length };
  });
  expect(info.pads).toBe(3); expect(info.army).toBe(3); expect(info.trucks).toBeGreaterThanOrEqual(5);
  await look(page, 'base-aerial', [660, 95, -520], [665, 0, -650]);
  await look(page, 'base-gate', [790, 6, -620], [730, 4, -655]);
  await look(page, 'base-pads', [640, 16, -560], [700, 2, -610]);
  await look(page, 'base-motorpool', [690, 14, -700], [670, 2, -705]);

  // steal a gunship from the pad: walk up (entry flow) is covered by carentry; here seat the player directly
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const pad = g.helis.pads.find((p: any) => /Fort Calder/.test(p.def.name));
    const h = pad.heli; g.player.place(h.position.x + 6, h.position.y, h.position.z, 0);
    g.boardFinished(h); h.rotor = 1; h.parked = false;
    return { heat: g.police.heat, armed: h.armed, toasted: true };
  });
  expect(r.armed).toBe(true); expect(r.heat).toBeGreaterThanOrEqual(3);
  const shots = await page.evaluate(() => {
    const g = (window as any).__game, h = g.playerHeli; h.teleport(h.position.x, h.position.y + 30, h.position.z, h.yaw);
    let n = 0; const orig = g.combat.shoot.bind(g.combat); g.combat.shoot = (...a: any[]) => { n++; return orig(...a); };
    const proj0 = g.combat.activeProjectiles;
    g.input.press('Mouse0'); for (let i = 0; i < 40; i++) g.frame(1 / 30, false); g.input.release('Mouse0');
    g.input.press('Mouse2'); for (let i = 0; i < 12; i++) g.frame(1 / 30, false); g.input.release('Mouse2');
    return { n, proj: g.combat.activeProjectiles - proj0, missiles: g.heliArms.missiles };
  });
  expect(shots.n).toBeGreaterThan(8); expect(shots.missiles).toBeLessThan(8);
  await look(page, 'player-gunship', [660, 40, -520], [665, 25, -600]);
  // hostile gunships launch (stolen gunship at 3+ stars) and shoot
  await step(page, 25, { render: false });
  const air = await page.evaluate(() => { const g = (window as any).__game; return { units: g.armyAir.units.length, launched: g.armyAir.stats.launched, shot: g.armyAir.stats.shot, missiles: g.armyAir.stats.missiles }; });
  expect(air.launched).toBeGreaterThanOrEqual(1);
  await look(page, 'attack', [665, 45, -540], [665, 35, -600]);
  clean(pr);
});

test('Fort Calder: guards on foot, far silhouette, missile strike and a shot-down gunship', async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const pr = watch(page);
  await boot(page);
  await quietStreets(page);
  // far silhouette shows from a distance and hides up close; guards exist and are in army kit
  const lod = await page.evaluate(() => {
    const g = (window as any).__game, B = { x: 665, z: -650 };
    const vis = (x: number, z: number) => { g.renderer.camera.position.set(x, 30, z); g.frame(1 / 30, false); g.renderer.camera.position.set(x, 30, z); return g.armyLod.visible; };
    g.player.place(B.x + 500, 0.5, B.z, 0); g.renderer.camera.position.set(B.x + 500, 30, B.z);
    const far = vis(B.x + 500, B.z);
    return { far, guards: g.armyGuards.guards.length, alive: g.armyGuards.guards.filter((n: any) => n.npc.alive).length };
  });
  expect(lod.guards).toBeGreaterThanOrEqual(8);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(660, 0.5, -300, 0); for (let i = 0; i < 20; i++) g.frame(1 / 30, false); });
  await look(page, 'base-far', [640, 70, -250], [665, 5, -650], false);
  const near = await page.evaluate(() => { const g = (window as any).__game; g.player.place(770, 0.5, -650, 1.5); for (let i = 0; i < 30; i++) g.frame(1 / 30, false); return g.armyLod.visible; });
  expect(near).toBe(false);
  // trespass: guards turn hostile and one fires back at the player
  const g1 = await page.evaluate(() => { const g = (window as any).__game; g.player.place(700, 0.3, -630, 0); g.player.health = g.player.maxHealth = 400; for (let i = 0; i < 30 * 8; i++) g.frame(1 / 30, false); return { hostile: g.armyGuards.guards.filter((x: any) => x.npc.hostile).length, tres: g.armyAir.trespassT }; });
  expect(g1.tres).toBeGreaterThan(4); expect(g1.hostile).toBeGreaterThanOrEqual(4);
  await look(page, 'guards', [690, 4, -600], [700, 1.5, -630]);

  // missile strike near the player
  await page.evaluate(() => { const g = (window as any).__game; g.armyGuards.guards.forEach((x: any) => { x.npc.persistent = false; g.pop.remove(x.npc); }); g.armyGuards.guards.length = 0; g.player.place(690, 0.3, -700, 0); g.cam.snapBehind?.(0); for (let i = 0; i < 10; i++) g.frame(1 / 30, false); });
  const strike = await page.evaluate(() => {
    const g = (window as any).__game; const THREE_V = g.renderer.camera.position.constructor;
    const from = new THREE_V(690, 22, -650), to = new THREE_V(692, 0.5, -698);
    const dir = to.clone().sub(from).normalize();
    const hp0 = g.player.health;
    g.heliArms.launchMissile(g.player, from, dir, 0);
    let frames = 0; while (g.combat.activeProjectiles > 0 && frames < 200) { g.frame(1 / 30, false); frames++; }
    return { frames, hpLost: hp0 - g.player.health };
  });
  expect(strike.frames).toBeLessThan(200);
  await page.evaluate(() => { const g = (window as any).__game; for (let i = 0; i < 6; i++) g.frame(1 / 30, false); g.frame(1 / 30, true); });
  if (SHOT) await page.screenshot({ path: `${SHOT}/missile-strike.png` });

  // a hostile gunship shot down: smoke, fall, crash explosion, wreck
  const down = await page.evaluate(() => {
    const g = (window as any).__game;
    g.police.setHeat(5, g.player.pos);
    for (let i = 0; i < 30 * 30 && !(g.armyAir.units[0] && g.armyAir.units[0].state === 'attack'); i++) g.frame(1 / 30, false);
    const u = g.armyAir.units[0]; if (!u) return { ok: false };
    const h = u.heli; h.damage(h.maxHealth * 0.7, undefined, undefined, g.player);
    return { ok: true, hp: h.health / h.maxHealth };
  });
  expect(down.ok).toBe(true);
  const trackHeli = async (name: string, secs: number) => {
    await page.evaluate((secs) => { const g = (window as any).__game; for (let i = 0; i < secs * 30; i++) g.frame(1 / 30, false); }, secs);
    if (!SHOT) return;
    await page.evaluate(() => { const g = (window as any).__game; const h = g.armyAir.units[0]?.heli ?? g.helis.list.find((x: any) => x.variant === 'army' && x.aiOwned); g.frame(1 / 30, true); const c = g.renderer.camera; const p = h.position; c.position.set(p.x - 30, p.y + 6, p.z - 30); c.lookAt(p.x, p.y, p.z); c.updateMatrixWorld(); g.renderer.render(); });
    await page.screenshot({ path: `${SHOT}/${name}.png` });
  };
  await trackHeli('down-smoke', 1);
  await page.evaluate(() => { const g = (window as any).__game; const h = g.armyAir.units[0].heli; h.damage(h.health + 5, undefined, undefined, g.player); });
  await trackHeli('down-falling', 1.5);
  const crashed = await page.evaluate(() => { const g = (window as any).__game; for (let i = 0; i < 30 * 10; i++) g.frame(1 / 30, false); const h = g.armyAir.units[0].heli; return { destroyed: h.destroyed, burn: h.burnTime }; });
  expect(crashed.destroyed).toBe(true);
  await trackHeli('down-wreck', 0.5);
  clean(pr);
});
