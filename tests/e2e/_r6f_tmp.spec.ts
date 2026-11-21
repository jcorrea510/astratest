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
  for (const [cname, pose] of Object.entries(CANDS)) {
    await page.evaluate((pose) => { const n = (window as any).__n; const a = n.char.human.act; if (pose) a.def.poses = [[0, pose]]; }, pose);
    await step(page, 0.8, { dt: 1 / 30 });
    console.log('DBG', cname, JSON.stringify(await page.evaluate(() => { const n = (window as any).__n; return [n.pos.y, n.brain, n.char.human.actionName, n.char.human.act?.t]; })));
    for (const [name, ang] of [['side', 0], ['front', 1]] as [string, number][]) {
      await page.evaluate((ang) => {
        const g = (window as any).__game, n = (window as any).__n, pl = g.player;
        pl.human.root.visible = false;
        g.pcombat.inv?.select?.('fists');
        const yaw = Math.PI / 2; pl.place(-280, 0.25, -95.5, yaw); g.cam.snapBehind(yaw);
        n.char.place(-280 + Math.sin(yaw) * 2.6, n.pos.y, -95.5 + Math.cos(yaw) * 2.6, yaw + (ang === 1 ? Math.PI : Math.PI / 2));
      }, ang);
      await step(page, 0.3, { dt: 1 / 30 });
      await page.evaluate(() => (window as any).__game.frame(1 / 60, true));
      await page.screenshot({ path: `/tmp/r6f-shots/lab-${cname}-${name}.png`, clip: { x: 440, y: 160, width: 400, height: 400 } });
    }
  }
});
