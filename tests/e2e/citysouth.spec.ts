import { test, expect } from '@playwright/test';
import { boot, quietStreets, step, watch, clean } from './helpers';

// Round 4 city growth: boot, draw calls at three street spots, drive south into the new Financial District.
test('city south extension: draw calls at 3 spots, drive across Midtown into Anchor Row', async ({ page }) => {
  test.setTimeout(400_000);
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const shot = process.env.CITY_SHOTS ?? '';
  const spots = [
    { name: 'financial', x: 3, z: 782, yaw: 0 },
    { name: 'park', x: -52, z: -250, yaw: -Math.PI / 2 },
    { name: 'midtown', x: 3, z: 500, yaw: Math.PI },
  ];
  for (const s of spots) {
    await page.evaluate(s => { const g = (window as any).__game; g.player.place(s.x, 0.05, s.z, s.yaw); g.cam.yaw = s.yaw; g.cam.pitch = 0.05; }, s);
    await step(page, 1.5, { render: true });
    const calls = await page.evaluate(() => { const g = (window as any).__game; g.frame(1 / 60, true); return g.renderer.renderer.info.render.calls; });
    console.log('draw calls', s.name, calls);
    expect(calls).toBeLessThan(700);
    if (shot) await page.screenshot({ path: `${shot}/${s.name}.png` });
  }
  if (shot) {
    await page.evaluate(() => { const g = (window as any).__game; g.player.place(0, 0.05, 400, 0); g.cam.update(0, g.player.pos, 'aim'); g.renderer.camera.position.set(-380, 520, 1120); g.renderer.camera.lookAt(60, 0, 380); g.renderer.render?.(); });
    await page.screenshot({ path: `${shot}/aerial.png` });
  }
  // drive south along Meridian Blvd (x=-50) from Midtown to Anchor Row
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-46, 0.05, 420, 0);
    const v = g.vehicles.spawn('sedan', -46, 420, 0); v.persistent = true; g.seatPlayer(v);
    for (let i = 0; i < 20; i++) g.frame(1 / 60, false);
    g.input.press('KeyW');
    for (let i = 0; i < 30 * 12; i++) g.frame(1 / 15, false);
    g.input.release('KeyW');
    return { z: v.position.z, x: v.position.x };
  });
  console.log('drive end', JSON.stringify(r));
  expect(r.z).toBeGreaterThan(520);
  clean(p);
});
