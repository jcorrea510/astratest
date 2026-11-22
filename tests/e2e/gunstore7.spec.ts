import { test, expect } from '@playwright/test';
import { boot } from './helpers';

/** Round 7 (owner): Tidewater Arms is a real store you walk into: guns hang on the wall, look at one to buy it. */
const SHOTS = process.env.GUN_SHOTS || '';
test('walk-in gun store: guns on the wall, buy by looking at one, the counter opens the catalogue', async ({ page }) => {
  test.setTimeout(400_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities, k = A.robberies.kiosks.find((q: any) => q.def.kind === 'guns');
    if (!k) return { found: false };
    g.money = 5000; g.hour = 13; g.clockRunning = false; g.police.clear();
    const out = k.frame.toWorld(3.1, 0.3, 8); g.player.place(out.x, out.y, out.z, 0);
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false); // interior builds near the camera
    // stand in front of the back-wall board, facing it
    const at = k.frame.toWorld(0.35, 0.3, -3.3), wall = k.frame.toWorld(0.35, 0.3, -4.7);
    g.player.place(at.x, at.y, at.z, Math.atan2(wall.x - at.x, wall.z - at.z));
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    const models = k.shell.root.children.filter((o: any) => o.userData?.weapon).length;
    const prompt = A.prompt();
    const f = A.guns.facing(g.player.pos, g.player.yaw);
    const m0 = g.money; g.input.tap('KeyE'); for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    const owned = f ? g.pcombat.inv.weapons[f.id].owned : false, paid = m0 - g.money;
    const c = k.frame.toWorld(-3, 0.3, 2.5); g.player.place(c.x, c.y, c.z, 0); for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    const counter = A.prompt();
    return { found: true, name: k.def.name, models, prompt, gun: f?.id, owned, paid, counter };
  });
  console.log('guns', JSON.stringify(r));
  expect(r.found).toBe(true);
  expect(r.models).toBeGreaterThanOrEqual(15);
  expect(r.prompt).toContain('Buy');
  expect(r.owned).toBe(true);
  expect(r.paid).toBeGreaterThan(0);
  expect(r.counter).toContain('Browse Tidewater Arms');
  if (SHOTS) {
    await page.evaluate(() => {
      const g = (window as any).__game, A = (window as any).__meridian.activities, k = A.robberies.kiosks.find((q: any) => q.def.kind === 'guns');
      const cam = g.cam.camera, p = k.frame.toWorld(-1.5, 1.6, 3.6), t = k.frame.toWorld(3.0, 1.3, -2.5);
      cam.position.copy(p); cam.lookAt(t); cam.updateMatrixWorld(true); g.renderer.render();
    });
    await page.screenshot({ path: `${SHOTS}/gunstore.png` });
  }
});
