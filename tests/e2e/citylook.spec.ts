import { test, expect } from '@playwright/test';
import { boot, step, quietStreets } from './helpers';

// City look: screenshots (street + aerial), draw-call count, and shootable shop glass.
test('city: street + aerial views, draw calls, shop glass breaks', async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page);
  await quietStreets(page);
  const shot = process.env.CITY_SHOTS ?? '';
  // street level on Meridian Blvd area (mid-city)
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-6, 0.05, -45, Math.PI); g.cam.yaw = 0; g.cam.pitch = 0.05; });
  await step(page, 1.5, { render: true });
  const calls = await page.evaluate(() => { const g = (window as any).__game; g.frame(1 / 60, true); return { calls: g.renderer.renderer.info.render.calls, tris: g.renderer.renderer.info.render.triangles }; });
  console.log('street draw calls', JSON.stringify(calls));
  if (shot) await page.screenshot({ path: `${shot}/street.png` });
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(150, 0.05, 155, 0); g.cam.yaw = Math.PI * 0.75; g.cam.pitch = 0.05; });
  await step(page, 1.5, { render: true });
  if (shot) await page.screenshot({ path: `${shot}/street2.png` });
  // aerial
  await page.evaluate(() => { const g = (window as any).__game; g.cam.update(0, g.player.pos, 'aim'); g.renderer.camera.position.set(-120, 260, 60); g.renderer.camera.lookAt(0, 0, -60); g.renderer.render?.(); });
  if (shot) await page.screenshot({ path: `${shot}/aerial.png` });
  // shop glass: first street pane breaks when shot
  const r = await page.evaluate(() => {
    const m = (window as any).__game; const wg = m.combat.worldGlass;
    const THREE = m.renderer.camera.position.constructor;
    const p = wg.panes.find((q: any) => q.inst >= 0);
    const o = new THREE(p.x + Math.sin(p.yaw) * 6, p.y, p.z + Math.cos(p.yaw) * 6), d = new THREE(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const before = wg.isGlassBroken(p.id);
    m.combat.trace(o, d, 20, null, {});
    return { before, after: wg.isGlassBroken(p.id), n: wg.panes.length };
  });
  console.log('glass', JSON.stringify(r));
  expect(r.before).toBe(false); expect(r.after).toBe(true); expect(r.n).toBeGreaterThan(50);
});
