import { test } from '@playwright/test';
import { boot, step, quietStreets } from './helpers';
test('pose sweep', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page); await quietStreets(page);
  const variants: [string, any][] = [
    ['a', { armL: [-110, 0, 70], foreL: [0, 0, 140], head: [8, 0, 0] }],
    ['b', { armL: [-60, 0, 60], foreL: [-30, 0, 130], head: [8, 0, 0] }],
    ['c', { armL: [-150, -20, 40], foreL: [-100, 0, 40], head: [8, 0, 0] }],
  ];
  for (const [k, pose] of variants) {
    await page.evaluate(async ({ pose }) => {
      const g = (window as any).__game; const A = await import('/astratest/src/actors/actions.ts');
      const sym = (p: any) => { const o: any = {}; for (const key of Object.keys(p)) { const v = p[key]; if (key.endsWith('L')) { o[key] = v; o[key.slice(0, -1) + 'R'] = [v[0], -v[1], -v[2]]; } else o[key] = v; } return o; };
      A.ACTIONS.kneel_head.poses = [[0, sym(pose)]];
      g.player.place(-280, 0.25, -95.5, Math.PI / 2); g.cam.snapBehind(Math.PI / 2);
      for (const n of [...g.pop.npcs]) g.pop.remove(n);
      const n = g.pop.spawn('civilian', -280 + 3.5, -95.5, 0.45); n.persistent = true; (window as any).__n = n; n.brain = 'ordered'; n.order = 'kneel'; n.orderMax = 99;
      g.cam.yaw = Math.PI / 2 + Math.PI + 0.5; 
    }, { pose });
    await step(page, 1.2, { dt: 1 / 30 });
    await page.evaluate(() => { const g = (window as any).__game; g.cam.yaw = -Math.PI / 2 + 0.5 + Math.PI - 0.9; g.frame(1 / 60, true); });
    await page.screenshot({ path: `/tmp/r6f-shots/pose-${k}.png`, clip: { x: 340, y: 200, width: 600, height: 360 } });
  }
});
