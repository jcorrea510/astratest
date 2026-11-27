import { test, expect } from '@playwright/test';
import { boot, step, watch, clean } from './helpers';

test('3D map: opens, zooms smoothly, pans, rotates; minimap draws', async ({ page }) => {
  test.setTimeout(280_000);
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { (window as any).__game.player.place(0, 0.3, 120, 0); });
  await step(page, 1, { render: true });
  const mini = await page.evaluate(() => {
    const mm = (window as any).__meridian.ui.hud.minimap;
    const st = { x: 0, z: 120, heading: 0.4, zoom: 1, blips: [] as unknown[] };
    mm.state = st; mm.draw(0); // first draw bakes the city once
    const a: number[] = [];
    for (let i = 0; i < 40; i++) { mm.state = { ...st, x: i * 3, heading: 0.4 + i * 0.02 }; const t0 = performance.now(); mm.draw(i / 30); a.push(performance.now() - t0); }
    return a.sort((x, y) => x - y)[20];
  });
  console.log('PERF minimap median ms', mini);
  expect(mini).toBeLessThan(1);
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
  // E rotates (eases over a few rendered frames; the CI software renderer can draw the 3D map only a couple of times a second)
  await page.keyboard.press('KeyE');
  await page.waitForFunction((t0) => (window as any).__meridian.ui.fullmap.view.tilt > t0 + 0.15, c.tilt!, { timeout: 15_000, polling: 200 }).catch(() => {});
  expect((await fm()).tilt).toBeGreaterThan(c.tilt! + 0.15);
  await page.keyboard.press('KeyR');
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(1800);
  if (shot) await page.screenshot({ path: `${shot}/full.png` });
  // legend starts collapsed; L toggles it
  expect(await page.evaluate(() => document.querySelector('.ma-map-legend')!.classList.contains('is-collapsed'))).toBe(true);
  await page.keyboard.press('KeyL');
  expect(await page.evaluate(() => document.querySelector('.ma-map-legend')!.classList.contains('is-collapsed'))).toBe(false);
  await page.keyboard.press('KeyL');
  // per-frame cost: panning redraws (layer is only re-transformed) and the baked minimap
  const perf = await page.evaluate(() => {
    const f = (window as any).__meridian.ui.fullmap;
    const med = (a: number[]) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    f.render(); // settle
    const pan: number[] = [];
    for (let i = 0; i < 40; i++) { f.view.cx += 6; f.view.cz += 3; f.dirty = true; const t0 = performance.now(); f.render(); pan.push(performance.now() - t0); }
    return { pan: med(pan), panMax: Math.max(...pan) };
  });
  console.log('PERF', JSON.stringify(perf));
  expect(perf.pan).toBeLessThan(16);

  clean(p);
});
