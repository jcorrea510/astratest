import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { boot, step, quietStreets } from './helpers';
const CANDS: Record<string, any> = JSON.parse(process.env.CANDS ?? '{}');
test('lab', async ({ page }) => {
  test.setTimeout(900000);
  await boot(page); await quietStreets(page);
  await page.evaluate(() => {
    const g = (window as any).__game; g.clockRunning = false; g.hour = 14;
    for (const n of [...g.pop.npcs]) if (!n.persistent && !n.char.inVehicle) g.pop.remove(n);
    g.player.place(-280, 0.25, -95.5, Math.PI / 2);
    const n = g.pop.spawn('civilian', -277, -95.5, g.player.pos.y + 0.2); n.persistent = true; n.brain = 'ordered'; n.order = 'kneel'; n.orderMax = 999; n.char.yaw = Math.PI / 2 + Math.PI; (window as any).__n = n;
  });
  await step(page, 2.5, { dt: 1 / 30 });
  await page.evaluate(() => { (window as any).requestAnimationFrame = () => 0; });
  await page.waitForTimeout(500);
  for (const [cname, pose] of Object.entries(CANDS)) {
    await page.evaluate((pose) => { const n = (window as any).__n; const a = n.char.human.act; if (pose) a.def.poses = [[0, pose]]; }, pose);
    await step(page, 0.8, { dt: 1 / 30 });
    for (const [name, ang] of [['side', 0], ['front', 1]] as [string, number][]) {
      await page.evaluate((ang) => {
        const g = (window as any).__game, n = (window as any).__n, C = g.renderer.camera;
        g.frame(1 / 60, false);
        const p = n.pos, yaw = n.char.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw);
        if (ang === 0) C.position.set(p.x + fz * 3.0, p.y + 0.9, p.z - fx * 3.0); else C.position.set(p.x + fx * 3.0, p.y + 0.9, p.z + fz * 3.0);
        C.lookAt(p.x, p.y + 0.6, p.z); C.updateMatrixWorld(true); g.renderer.render();
      }, ang);
      await page.screenshot({ path: `/tmp/r6f-shots/lab-${cname}-${name}.png`, clip: { x: 340, y: 100, width: 600, height: 500 } });
    }
  }
});
