import { test } from '@playwright/test';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { boot, step, quietStreets } from './helpers';
test.setTimeout(3_000_000);
test('kneel loop', async ({ page }) => {
  await boot(page); await quietStreets(page);
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.clockRunning = false; g.hour = 14; g.police.clear?.();
    g.player.place(-280, 0.25, -95.5, Math.PI / 2); g.cam.snapBehind(Math.PI / 2);
    const n = g.pop.spawn('civilian', g.player.pos.x + 6, g.player.pos.z, g.player.pos.y + 0.2); n.persistent = true; n.brain = 'ordered'; n.order = 'kneel'; n.char.yaw = Math.PI / 2 + Math.PI;
    (window as any).__n = n;
  });
  await step(page, 1, { dt: 1 / 30 });
  let last = '';
  for (;;) {
    await new Promise(r => setTimeout(r, 1500));
    if (!existsSync('/tmp/r6f/cmd.json')) continue;
    const raw = readFileSync('/tmp/r6f/cmd.json', 'utf8'); if (raw === last) continue; last = raw;
    const cmd = JSON.parse(raw); if (cmd.id === 'quit') break;
    await page.evaluate((pose) => {
      const n = (window as any).__n; const a = n.char.human.act; a.def.poses = [[0, pose]];
    }, cmd.pose);
    await step(page, 0.6, { dt: 1 / 30 });
    for (const [name, ang] of [['front', 0], ['side', 90], ['q', 40]] as [string, number][]) {
      await page.evaluate((ang) => {
        const g = (window as any).__game, n = (window as any).__n, T = g.renderer.camera.position.constructor;
        g.frame(1 / 60, false);
        const f = n.char.yaw + ang * Math.PI / 180;
        const p = new T(); n.char.human.spine.getWorldPosition(p);
        const cam = g.renderer.camera; cam.position.set(p.x + Math.sin(f) * 2.3, p.y + 0.1, p.z + Math.cos(f) * 2.3); cam.lookAt(p.x, p.y - 0.25, p.z); cam.updateMatrixWorld();
        g.renderer.render();
      }, ang);
      await page.screenshot({ path: `/tmp/r6f/k-${name}.png`, clip: { x: 340, y: 60, width: 600, height: 600 } });
    }
    writeFileSync('/tmp/r6f/ready', cmd.id);
  }
});
