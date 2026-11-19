import { test, expect } from '@playwright/test';
import { boot, step, watch, clean } from './helpers';

test('3D map: opens, zooms smoothly, pans, rotates; minimap draws', async ({ page }) => {
  test.setTimeout(280_000);
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { (window as any).__game.player.place(0, 0.3, 120, 0); });
  await step(page, 1, { render: true });
  const shot = process.env.MAP_SHOT;
  if (shot) await page.screenshot({ path: `${shot}/mini.png`, clip: { x: 0, y: 480, width: 330, height: 240 } });
  await page.keyboard.press('KeyM'); await step(page, 1, { render: true });
  await page.waitForTimeout(1200);
  const canvas = page.locator('.ma-map-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const fm = () => page.evaluate(() => { const f = (window as any).__meridian.ui.fullmap; return { scale: f.view.scale, tilt: f.view.tilt, cx: f.view.cx, cz: f.view.cz, target: f.targetScale }; });
  const a = await fm();
  await page.mouse.move(box.x + 640, box.y + 400);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(1500);
  const b = await fm();
  expect(b.scale).toBeGreaterThan(a.scale * 1.5); // wheel zoom eases to the target
  await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 260, { steps: 6 }); await page.mouse.up();
  const c = await fm();
  expect(Math.hypot(c.cx - b.cx, c.cz - b.cz)).toBeGreaterThan(10); // drag pans
  await page.keyboard.press('KeyE'); await page.waitForTimeout(1200);
  expect((await fm()).tilt).toBeGreaterThan(c.tilt! + 0.15); // E rotates
  await page.keyboard.press('KeyR');
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(1800);
  if (shot) await page.screenshot({ path: `${shot}/full.png` });
  clean(p);
});
