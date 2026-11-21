import { test, expect } from '@playwright/test';
import { watch, boot, clean } from './helpers';

/** Renders every barber cut (and beard) close up for visual review: R6BW_SHOTS=/dir writes one png per style. */
const SHOTS = process.env.R6BW_SHOTS ?? '';
const CUTS = ['short', 'fade', 'crew', 'buzz', 'slick', 'parted', 'curly', 'afro', 'cornrows', 'braids', 'long', 'bun', 'ponytail', 'bald', 'bob', 'pixie', 'buns'];
const BEARDS = ['stubble', 'beard', 'goatee', 'moustache'];

test('every cut and beard renders as cards without errors', async ({ page }) => {
  test.setTimeout(500_000);
  const p = watch(page); await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.trafficCap = 0; g.pedCap = 0; g.paused = false; });
  const shot = async (name: string, patch: Record<string, string>, yaw: number) => {
    await page.evaluate(({ patch, yaw }) => {
      const g = (window as any).__game, h = g.player.human, V = g.cam.camera.position.constructor;
      h.applyLook({ ...h.look, hairStyle: 'short', facial: 'none', hatStyle: 'none', ...patch });
      g.player.place(-300, 0.3, -90, Math.PI); g.player.updateVisual(0);
      const p = g.player.pos;
      g.cam.preview = { focus: new V(p.x, p.y + 1.6, p.z), yaw: Math.PI + yaw, dist: 1.9, pitch: 0.03, fov: 30 };
      for (let f = 0; f < 6; f++) g.frame(1 / 30, f === 5);
    }, { patch, yaw });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hair-${name}.png`, clip: { x: 340, y: 60, width: 600, height: 600 } });
  };
  for (const c of CUTS) { await shot(c, { hairStyle: c }, 0.65); if (['short', 'long', 'afro', 'slick', 'ponytail', 'bun'].includes(c)) await shot(`${c}-back`, { hairStyle: c }, Math.PI - 0.4); }
  for (const b of BEARDS) await shot(`beard-${b}`, { facial: b }, 0.65);
  await shot('beard-front', { facial: 'beard', hairStyle: 'fade' }, 0);
  const tri = await page.evaluate(() => { const g = (window as any).__game; let n = 0; g.player.human.root.traverse((o: any) => { if (o.isSkinnedMesh && o.visible) n += o.geometry.index ? o.geometry.index.count / 3 : 0; }); return n; });
  expect(tri).toBeGreaterThan(0);
  clean(p);
});
