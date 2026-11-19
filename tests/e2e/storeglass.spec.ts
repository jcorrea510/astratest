import { test, expect } from '@playwright/test';
import { watch, boot, clean } from './helpers';

// Shop windows: bullets crack the pane (hole decals), the third hit shatters it, then the glass is gone and rounds fly through.
test('store window cracks, then shatters; mesh removed and a trace reaches the interior', async ({ page }) => {
  test.setTimeout(240_000);
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies, wg = g.combat.worldGlass;
    const k = R.kiosks[0];
    const out = k.frame.toWorld(3.1, 0.3, 9);
    g.police.clear(); g.player.place(out.x, out.y, out.z, 0);
    for (let f = 0; f < 8; f++) g.frame(1 / 30, false); // interior builds on approach
    const pane = wg.panes.find((q: any) => q.mesh && q.mesh.parent && q.w > 2);
    const THREE = g.renderer.camera.position.constructor;
    const nx = Math.sin(pane.yaw), nz = Math.cos(pane.yaw);
    const o = new THREE(pane.x + nx * 5, pane.y, pane.z + nz * 5), d = new THREE(-nx, 0, -nz);
    const res: any = { n: wg.panes.length };
    const t1 = g.combat.trace(o, d, 30, null, {});
    res.firstKind = t1.kind; res.firstT = t1.t; res.hits1 = pane.hits; res.broken1 = pane.broken;
    g.combat.trace(o, d, 30, null, {});
    res.hits2 = pane.hits; res.broken2 = pane.broken; res.cracked = pane.mesh.material.type;
    g.combat.trace(o, d, 30, null, {});
    res.broken3 = pane.broken; res.meshGone = !pane.mesh.parent; res.visible = pane.mesh.visible;
    const t4 = g.combat.trace(o, d, 30, null, {});
    res.afterT = t4.t; res.afterKind = t4.kind; res.paneDist = 5;
    return res;
  });
  expect(r.firstKind).toBe('static'); expect(r.firstT).toBeLessThan(5.6); expect(r.hits1).toBe(1); expect(r.broken1).toBe(false);
  expect(r.broken2).toBe(false); expect(r.hits2).toBe(2);
  expect(r.broken3).toBe(true); expect(r.meshGone).toBe(true);
  expect(r.afterT).toBeGreaterThan(r.paneDist + 1.5); // the round now travels past the pane plane into the shop
  clean(p);
});
