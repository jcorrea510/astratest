import { test } from '@playwright/test';
import { boot, step, quietStreets } from './helpers';
test('lab', async ({ page }) => {
  test.setTimeout(600000);
  await boot(page); await quietStreets(page);
  await page.evaluate(() => {
    const g = (window as any).__game; g.clockRunning = false; g.hour = 14;
    for (const n of [...g.pop.npcs]) if (!n.char.inVehicle) g.pop.remove(n);
    g.player.place(-280, 0.25, -95.5, Math.PI / 2);
    const n = g.pop.spawn('civilian', -277, -95.5, g.player.pos.y + 0.2); n.persistent = true; n.brain = 'ordered'; n.order = 'kneel'; n.orderMax = 999; n.char.yaw = Math.PI / 2 + Math.PI; (window as any).__n = n;
  });
  await step(page, 2.5, { dt: 1 / 30 });
  for (const [name, ang] of [['side', 0], ['front', 1]] as [string, number][]) {
    await page.evaluate((ang) => {
      const g = (window as any).__game, n = (window as any).__n, C = g.renderer.camera;
      g.frame(1 / 60, false);
      const p = n.char.pos; const yaw = n.char.yaw; // facing dir (sin,cos)
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      if (ang === 0) C.position.set(p.x + fz * 3.2, p.y + 0.9, p.z - fx * 3.2); else C.position.set(p.x + fx * 3.2, p.y + 0.9, p.z + fz * 3.2);
      C.lookAt(p.x, p.y + 0.7, p.z); C.updateMatrixWorld(true); g.renderer.render();
    }, ang);
    await page.screenshot({ path: `/tmp/r6f-shots/lab-${name}.png`, clip: { x: 340, y: 160, width: 600, height: 400 } });
  }
});
