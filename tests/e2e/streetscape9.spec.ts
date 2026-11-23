import { test, expect } from '@playwright/test';
import { boot, step, quietStreets } from './helpers';

// Round 9 (owner: "very boxy, add character"): street dressing is baked into the merged trim chunks, so draw calls stay flat.
test('streetscape: dressing exists in the world and a street view stays within the draw-call budget', async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page); await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(150, 0.05, 155, 0); g.cam.yaw = Math.PI * 0.75; g.cam.pitch = 0.05; });
  await step(page, 1.5, { render: true });
  const r = await page.evaluate(() => {
    const g = (window as any).__game; g.frame(1 / 60, true);
    const i = g.renderer.renderer.info.render;
    return { calls: i.calls, tris: i.triangles, kinds: (globalThis as any).__streetscape ?? {} };
  });
  console.log('streetscape view', JSON.stringify(r));
  for (const k of ['bags', 'bikerack', 'planter', 'manhole', 'patch', 'crack', 'plate', 'shed']) expect(r.kinds[k] ?? 0, k).toBeGreaterThan(0);
  expect(r.calls).toBeLessThan(950); // R9 baseline for this view was 838; the dressing is baked into existing chunks (+<=2%)
});
