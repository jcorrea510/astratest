import { test } from '@playwright/test';
import { quietStreets, step } from './helpers';
const OUT = '/tmp/claude-0/wshots';
test('zz shots', async ({ page }) => {
  test.setTimeout(1_500_000);
  await page.goto('./?autostart=1'); await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 600_000 }); await page.evaluate(() => (window as any).__game.stop()); await quietStreets(page);
  const shots: { n: string; p: number[]; l: number[] }[] = JSON.parse(process.env.SHOTS ?? '[]');
  for (const s of shots) {
    await page.evaluate(s => { const g = (window as any).__game; g.player.place(s.p[0], s.p[1] > 2 ? 0.3 : s.p[1], s.p[2], 0); }, s);
    await step(page, 0.5, { render: true });
    await page.evaluate(s => { const g = (window as any).__game; g.frame(1 / 60, true); g.renderer.camera.position.set(s.p[0], s.p[1], s.p[2]); g.renderer.camera.lookAt(s.l[0], s.l[1], s.l[2]); g.renderer.camera.updateMatrixWorld(); g.renderer.render?.(); }, s);
    await page.screenshot({ path: `${OUT}/${s.n}.png` });
  }
});
