import { test, expect } from '@playwright/test';
import { boot, step, watch, clean } from './helpers';

test('stolen helicopter: 3 stars at once, cops swarm and shoot it down; crowds are dense', async ({ page }) => {
  test.setTimeout(420_000);
  const pr = watch(page);
  await boot(page);
  await step(page, 6);
  const crowd = await page.evaluate(() => { const g = (window as any).__game; return { peds: g.pop.npcs.length, cap: g.renderer.quality.pedestrians }; });
  expect(crowd.cap).toBeGreaterThanOrEqual(64);
  await page.evaluate(() => { const g = (window as any).__game; const h = g.spawnHelicopter('civilian'); g.boardFinished(h); h.rotor = 1; h.parked = false; h.teleport(h.position.x, h.position.y + 40, h.position.z, h.yaw); });
  const heat = await page.evaluate(() => (window as any).__game.police.heat);
  expect(heat).toBeGreaterThanOrEqual(3);
  await step(page, 14);
  const cops = await page.evaluate(() => (window as any).__game.pop.npcs.filter((n: any) => n.role === 'police').length + (window as any).__game.police.units.length);
  expect(cops).toBeGreaterThan(5);
  // the heli takes fire once the officers are out of their cars (units drive in from >= 120 m: Round 9 realism), so poll for up to a minute
  let hp = 1400;
  for (let k = 0; k < 12 && hp >= 1300; k++) {
    await step(page, 5);
    hp = await page.evaluate(() => { const g = (window as any).__game; return g.playerHeli ? g.playerHeli.health : 0; });
  }
  expect(hp).toBeLessThan(1300);
  // no leftover speech engine
  expect(await page.evaluate(() => typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking)).toBeFalsy();
  clean(pr);
});
