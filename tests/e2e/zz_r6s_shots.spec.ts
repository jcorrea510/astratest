import { test } from '@playwright/test';
import { boot, quietStreets } from './helpers';
test('r6s street shots', async ({ page }) => {
  test.setTimeout(600_000); page.on('console', m => { if (m.type() === 'error' || /ERROR|shader/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600)); });
  await boot(page); await quietStreets(page);
  const n = await page.evaluate(() => (window as any).__meridian.activities.robberies.kiosks.length);
  const picks = [0, 3, 6, 9].map(x => x % n);
  for (const [j, i] of picks.entries()) {
    await page.evaluate(i => {
      const g = (window as any).__game, k = (window as any).__meridian.activities.robberies.kiosks[i];
      g.police.clear();
      const out = k.frame.toWorld(3.1, 0.3, 12); g.player.place(out.x, out.y, out.z, 0);
      for (let f = 0; f < 60; f++) g.frame(1 / 30, false);
      const cam = g.renderer.camera, a = k.frame.toWorld(-6, 1.7, 13), b = k.frame.toWorld(4, 2.0, 0);
      cam.position.copy(a); cam.lookAt(b); cam.updateMatrixWorld(true); g.renderer.render();
    }, i);
    await page.screenshot({ path: `/tmp/claude-0/shots/r6s-street-${j}.png` });
  }
});
