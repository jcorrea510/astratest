import { test, expect } from '@playwright/test';
import { watch, boot, quietStreets, clean, step } from './helpers';

/** Regression: people and cars used to vanish as the camera got close (culling + far-crowd despawn). */
test.describe.configure({ mode: 'serial' });

test('far-crowd pedestrians hand over to a real pedestrian instead of vanishing', async ({ page }) => {
  test.setTimeout(400_000);
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; g.player.place(-41, 0.25, 9, 0);
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    const nd = g.city.pedNodes.find((n: any) => Math.hypot(n.x + 41, n.z - 9) > 40 && Math.hypot(n.x + 41, n.z - 9) < 55 && n.edges.length);
    if (!nd) return { skipped: true };
    g.pop.maxCivilians = 50; const before = g.pop.npcs.length;
    g.crowd.peds.push({ from: nd.id, to: nd.edges[0].to, t: 0, speed: 1.3, wait: 0, off: 0, look: 0, x: nd.x, z: nd.z, yaw: 0, tint: 0xff0000, tint2: 0x222222, skin: 0xd9a577, phase: 0 });
    g.crowd.caps = { farCars: 0, farPeds: 50, parked: 0 };
    const n0 = g.crowd.peds.length;
    g.crowd.update(1 / 60, g.player.pos, { farCars: 0, farPeds: 50, parked: 0 });
    const spawned = g.pop.npcs.slice(before).filter((n: any) => Math.hypot(n.pos.x - nd.x, n.pos.z - nd.z) < 3).length;
    return { skipped: false, spawned, n0, n1: g.crowd.peds.length };
  });
  if (!r.skipped) expect(r.spawned).toBeGreaterThanOrEqual(1);
  clean(p);
});

test('P and the HUD gear button open the pause menu (Esc is not the only way); P closes it again', async ({ page }) => {
  test.setTimeout(400_000);
  const p = watch(page);
  await boot(page);
  await step(page, 1, { render: true });
  expect(await page.locator('.ma-gear').count()).toBe(1);
  await page.locator('.ma-gear').dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => (window as any).__game.paused)).toBe(true);
  await page.keyboard.press('KeyP'); await step(page, 0.1);
  await expect.poll(() => page.evaluate(() => (window as any).__game.paused)).toBe(false);
  clean(p);
});
