import { test } from '@playwright/test';
import { boot } from './helpers';
test('probe', async ({ page }) => {
  test.setTimeout(200_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const ui = (window as any).__meridian.ui; const fm = ui.fullmap; const pt = fm.painter;
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const ctx = c.getContext('2d')!;
    const out: any = { lots: pt.buildings.list.length };
    let t = performance.now(); pt.minimapBake(); out.bake = performance.now() - t;
    const v = fm.view; v.w = 1280; v.h = 720;
    for (const sc of [v.scale || 0.4, 0.4, 1.2]) {
      t = performance.now(); ctx.save(); ctx.translate(640, 360); ctx.scale(1, .64); ctx.rotate(.5); ctx.scale(sc, sc); ctx.translate(-v.cx, -v.cz); pt.paintGround(ctx, sc); ctx.restore();
      const g = performance.now() - t; t = performance.now();
      pt.buildings.drawExtruded(ctx, v.cx, v.cz, sc, 0.5, .64, 1280, 720); out['s' + sc] = [Math.round(g), Math.round(performance.now() - t)];
    }
    out.bounds = pt.bounds;
    return out;
  });
  console.log('PROBE', JSON.stringify(r));
});
