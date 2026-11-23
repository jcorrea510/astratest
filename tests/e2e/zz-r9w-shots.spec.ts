import { test } from '@playwright/test';
import { boot, step, quietStreets } from './helpers';
const OUT = process.env.SHOT_DIR ?? '/tmp/r9w-shots';
const TAG = process.env.SHOT_TAG ?? 'before';
const Q = process.env.SHOT_Q ?? 'medium';
const VIEWS: [string, number, number, number, number, number, number, number][] = [
  ['shed', -100, 2.2, 94, -85, 3, 108, 0],
  ['planter', -402, 2, 96, -393, 1, 109, 0],
  ['bikerack', -347, 2, -54, -359, 1, -45, 0],
  ['bags', -378, 2, 3, -389, 0.6, -9, 0],
];
test('shots', async ({ page }) => {
  test.setTimeout(1_500_000);
  await page.addInitScript(q => { try { localStorage.setItem('meridian-afterglow.settings.v1', JSON.stringify({ quality: q })); } catch { /* */ } }, Q);
  await boot(page); await quietStreets(page);
  for (const [n, x, y, z, lx, ly, lz] of VIEWS) {
    await page.evaluate(([x, y, z]) => { const g = (window as any).__game; g.player.place(x, 0.05, z, 0); }, [x, y, z]);
    await step(page, 1.5, { render: true });
    const info = await page.evaluate(([x, y, z, lx, ly, lz]) => {
      const g = (window as any).__game; const cam = g.renderer.camera;
      g.frame(1 / 60, true);
      cam.position.set(x, y, z); cam.lookAt(lx, ly, lz);
      const t0 = performance.now(); for (let i = 0; i < 2; i++) g.renderer.renderer.render(g.renderer.scene, cam);
      const i = g.renderer.renderer.info.render; return { calls: i.calls, tris: i.triangles, ms: (performance.now() - t0) / 2 };
    }, [x, y, z, lx, ly, lz]);
    console.log(TAG, Q, n, JSON.stringify(info));
    await page.screenshot({ path: `${OUT}/${TAG}-${Q}-${n}.png`, timeout: 180_000 });
  }
});
