import { test } from '@playwright/test';
import { boot, quietStreets } from './helpers';
test('r6s street shots', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page); await quietStreets(page);
  const n = await page.evaluate(() => (window as any).__meridian.activities.robberies.kiosks.length);
  for (const [j, i] of [1, 4, 7, 10].map(x => x % n).entries()) {
    await page.evaluate(i => {
      const g = (window as any).__game, k = (window as any).__meridian.activities.robberies.kiosks[i];
      g.police.clear();
      const o = k.frame.toWorld(1.0, 0.3, 14); g.player.place(o.x, o.y, o.z, k.def.yaw + Math.PI);
      for (let f = 0; f < 90; f++) g.frame(1 / 30, false);
    }, i);
    await page.waitForTimeout(1500);
    await page.evaluate(i => {
      const g = (window as any).__game, k = (window as any).__meridian.activities.robberies.kiosks[i];
      g.frame(1 / 30, false);
      const cam = g.renderer.camera, a = k.frame.toWorld(6, 1.7, 9), b = k.frame.toWorld(-6, 1.8, 0);
      cam.position.copy(a); cam.lookAt(b); cam.updateMatrixWorld(true); g.renderer.render();
    }, i);
    await page.screenshot({ path: `/tmp/claude-0/shots/r6s-nbr-${j}.png` });
  }
});
