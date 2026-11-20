import { test } from '@playwright/test';
import { boot, quietStreets } from './helpers';

const VIEWS: [string, number[], number[]][] = [
  ['a', [4.9, 3.2, 4.6], [-2.5, 0.9, -0.5]],
  ['b', [-4.9, 3.2, 4.6], [2.5, 1.0, -2.5]],
  ['c', [4.9, 3.2, -4.6], [-2.0, 0.9, 2.0]],
  ['d', [-4.8, 3.2, -4.0], [2.0, 0.9, 2.5]],
];
test('r6s interior screenshots', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page);
  await quietStreets(page);
  const kinds = await page.evaluate(() => { const R = (window as any).__meridian.activities.robberies; const seen = new Map<string, number>(); R.kiosks.forEach((k: any, i: number) => { if (!seen.has(k.def.kind)) seen.set(k.def.kind, i); }); return [...seen.entries()]; });
  const only = process.env.SHOT_KINDS?.split(',');
  for (const [kind, i] of kinds) {
    if (only && !only.includes(kind)) continue;
    await page.evaluate(i => {
      const g = (window as any).__game, R = (window as any).__meridian.activities.robberies, k = R.kiosks[i];
      g.police.clear();
      const out = k.frame.toWorld(3.1, 0.3, 9); g.player.place(out.x, out.y, out.z, 0);
      for (let f = 0; f < 8; f++) g.frame(1 / 30, false);
      const p = k.frame.toWorld(3.1, 0.3, 3.5); g.player.place(p.x, p.y, p.z, 0);
      for (let f = 0; f < 90; f++) g.frame(1 / 30, false);
    }, i);
    for (const [tag, pos, look] of VIEWS) {
      await page.evaluate(({ i, pos, look }) => {
        const g = (window as any).__game, R = (window as any).__meridian.activities.robberies, k = R.kiosks[i];
        g.frame(1 / 30, false);
        const cam = g.renderer.camera, a = k.frame.toWorld(pos[0], pos[1], pos[2]), b = k.frame.toWorld(look[0], look[1], look[2]);
        cam.position.copy(a); cam.lookAt(b); cam.updateMatrixWorld(true);
        g.renderer.render();
      }, { i, pos, look });
      await page.screenshot({ path: `/tmp/claude-0/shots/r6s-${kind}-${tag}.png` });
    }
  }
});
