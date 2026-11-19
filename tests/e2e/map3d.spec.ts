import { test, expect } from '@playwright/test';
import { boot, step, watch, clean } from './helpers';

test('3D map: opens, pans, zooms, rotates; minimap draws', async ({ page }) => {
  test.setTimeout(240_000);
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { (window as any).__game.player.place(0, 0.3, 120, 0); });
  await step(page, 1, { render: true });
  const shot = process.env.MAP_SHOT;
  if (shot) await page.screenshot({ path: `${shot}/mini.png`, clip: { x: 0, y: 0, width: 520, height: 300 } });
  await page.keyboard.press('KeyM');
  await step(page, 1, { render: true });
  await page.waitForTimeout(600);
  const canvas = page.locator('.ma-map-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const t0 = await page.evaluate(() => { const m = (window as any).__meridian; return performance.now(); });
  // wheel zoom + drag pan + rotate must not throw
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(500);
  await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 260, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('KeyE'); await page.keyboard.press('KeyE');
  await page.waitForTimeout(600);
  if (shot) await page.screenshot({ path: `${shot}/full_zoom.png` });
  await page.keyboard.press('KeyR');
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(900);
  if (shot) await page.screenshot({ path: `${shot}/full.png` });
  void t0;
  clean(p);
});
