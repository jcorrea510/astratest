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
    let trimTris = 0; g.renderer.scene.traverse((o: any) => { if (o.name === 'trim' && o.geometry) trimTris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return { calls: i.calls, tris: i.triangles, trimTris };
  });
  console.log('streetscape view', JSON.stringify(r));
  expect(r.trimTris).toBeGreaterThan(200_000); // merged street + building trim (props are baked in)
  expect(r.calls).toBeLessThan(450);
});
