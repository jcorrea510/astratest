import { test } from '@playwright/test';
import { boot, quietStreets } from './helpers';

test('r6s interior screenshots', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  await quietStreets(page);
  const kinds = await page.evaluate(() => { const R = (window as any).__meridian.activities.robberies; const seen = new Map<string, number>(); R.kiosks.forEach((k: any, i: number) => { if (!seen.has(k.def.kind)) seen.set(k.def.kind, i); }); return [...seen.entries()]; });
  const only = process.env.SHOT_KINDS?.split(',');
  for (const [kind, i] of kinds) {
    if (only && !only.includes(kind)) continue;
    for (const [tag, lx, lz, yawOff] of [['a', 3.1, 4.0, 0], ['b', -1.0, 3.2, 1.2], ['c', 3.5, -0.5, -1.4]] as const) {
      await page.evaluate(({ i, lx, lz, yawOff }) => {
        const g = (window as any).__game, R = (window as any).__meridian.activities.robberies, k = R.kiosks[i];
        g.police.clear();
        const out = k.frame.toWorld(3.1, 0.3, 9);
        g.player.place(out.x, out.y, out.z, 0);
        for (let f = 0; f < 8; f++) g.frame(1 / 30, false);
        const p = k.frame.toWorld(lx, 0.3, lz); g.player.place(p.x, p.y, p.z, 0);
        g.cam.yaw = k.def.yaw + Math.PI + yawOff; g.cam.pitch = -0.05;
        for (let f = 0; f < 40; f++) g.frame(1 / 30, f === 39);
      }, { i, lx, lz, yawOff });
      await page.screenshot({ path: `/tmp/claude-0/shots/r6s-${kind}-${tag}.png` });
    }
  }
});
