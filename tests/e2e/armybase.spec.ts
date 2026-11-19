import { test, expect } from '@playwright/test';
import { boot, step, watch, clean, quietStreets } from './helpers';

const SHOT = process.env.SHOT_DIR; // set to also write inspection screenshots
async function look(page: import('@playwright/test').Page, name: string, from: [number, number, number], at: [number, number, number]) {
  if (!SHOT) return;
  await page.evaluate(({ from, at }) => { const g = (window as any).__game; g.frame(1 / 30, true); const c = g.renderer.camera; c.position.set(...from); c.lookAt(...at); c.updateMatrixWorld(); g.renderer.render(); }, { from, at });
  await page.screenshot({ path: `${SHOT}/${name}.png` });
}

test('Fort Calder: far base with parked gunships, motor pool, road; player steals a gunship and fires; gunships hunt back', async ({ page }) => {
  test.setTimeout(300_000);
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
