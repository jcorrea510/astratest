import { test, expect } from '@playwright/test';
import { boot } from './helpers';

/**
 * Round 8 (owner: the Mac froze hard ~every second): in three.js a change in the number of lights recompiles every
 * shader. The light set must stay the same through play: wanted levels (helicopter searchlight), the salon chair, night.
 */
test('the scene keeps the same lights through play', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities;
    const sig = () => { const l: string[] = []; g.renderer.scene.traverseVisible((o: any) => { if (o.isLight) l.push(o.type + (o.castShadow ? '*' : '')); }); return l.sort().join(','); };
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    const s0 = sig();
    g.police.setHeat(4, g.player.pos.clone()); for (let i = 0; i < 30 * 40; i++) g.frame(1 / 30, false);
    const s1 = sig(); g.police.clear();
    g.hour = 22; for (let i = 0; i < 30 * 5; i++) g.frame(1 / 30, false);
    const s2 = sig();
    let s3 = s2;
    const k = A.robberies.kiosks.find((x: any) => x.def.kind === 'barber');
    if (k) { const p = k.frame.toWorld(1, 0.3, 1); g.player.place(p.x, p.y, p.z, 0); for (let i = 0; i < 60; i++) g.frame(1 / 30, false); try { A.salon.open(); for (let i = 0; i < 10; i++) g.frame(1 / 30, false); s3 = sig(); A.salon.close(); } catch (e) { s3 = 'err ' + e; } }
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    return { s0, same: [s1 === s0, s2 === s0, s3 === s0, sig() === s0], s1, s3 };
  });
  console.log('lights', JSON.stringify(r));
  expect(r.same).toEqual([true, true, true, true]);
});
