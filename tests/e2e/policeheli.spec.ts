import { test, expect } from '@playwright/test';
import { boot, step, watch, clean } from './helpers';

test('stolen helicopter: 3 stars at once, cops swarm and shoot it down; crowds are dense', async ({ page }) => {
  test.setTimeout(240_000);
  const pr = watch(page);
  await boot(page);
  await step(page, 6);
  const crowd = await page.evaluate(() => { const g = (window as any).__game; return { peds: g.pop.npcs.length, cap: g.renderer.quality.pedestrians }; });
  expect(crowd.cap).toBeGreaterThanOrEqual(66);
  await page.evaluate(() => { const g = (window as any).__game; const h = g.spawnHelicopter('civilian'); g.boardFinished(h); h.rotor = 1; h.parked = false; h.teleport(h.position.x, h.position.y + 40, h.position.z, h.yaw); });
  const heat = await page.evaluate(() => (window as any).__game.police.heat);
  expect(heat).toBeGreaterThanOrEqual(3);
  await step(page, 14);
  const cops = await page.evaluate(() => (window as any).__game.pop.npcs.filter((n: any) => n.role === 'police').length + (window as any).__game.police.units.length);
  expect(cops).toBeGreaterThan(5);
  await step(page, 6);
  // the heli takes fire
  const hp = await page.evaluate(() => { const g = (window as any).__game; return g.playerHeli ? g.playerHeli.health : 0; });
  expect(hp).toBeLessThan(1300);
  // no leftover speech engine
  expect(await page.evaluate(() => typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking)).toBeFalsy();
  clean(pr);
});
