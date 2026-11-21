import { test, expect } from '@playwright/test';
import { watch, boot, clean } from './helpers';

/** Renders every barber cut (and beard) close up for visual review: R6BW_SHOTS=/dir writes one png per style. */
const SHOTS = process.env.R6BW_SHOTS ?? '';
const CUTS = ['short', 'fade', 'crew', 'buzz', 'slick', 'parted', 'curly', 'afro', 'cornrows', 'long', 'bun', 'ponytail', 'bald', 'bob', 'pixie', 'buns'];
const BEARDS = ['stubble', 'beard', 'goatee', 'moustache'];

test('every cut and beard renders (scanned meshes / shells) without errors', async ({ page }) => {
  test.setTimeout(500_000);
  const p = watch(page); await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.trafficCap = 0; g.pedCap = 0; g.paused = false; });
  const shot = async (name: string, patch: Record<string, string>, yaw: number) => {
    await page.evaluate(({ patch, yaw }) => {
      const g = (window as any).__game, h = g.player.human, V = g.cam.camera.position.constructor;
      h.applyLook({ ...h.look, hairStyle: 'short', facial: 'none', hatStyle: 'none', ...patch });
      g.player.place(0, 0.3, -215, Math.PI); g.player.updateVisual(0);
      const p = g.player.pos;
      g.cam.preview = { focus: new V(p.x, p.y + 1.6, p.z), yaw: Math.PI + yaw, dist: 1.9, pitch: 0.03, fov: 30 };
      for (let f = 0; f < 6; f++) g.frame(1 / 30, f === 5);
    }, { patch, yaw });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hair-${name}.png`, clip: { x: 340, y: 60, width: 600, height: 600 } });
  };
  const hairMeshes = () => page.evaluate(() => (window as any).__game.player.human.extras.filter((e: any) => e.visible && e.material !== (window as any).__game.player.human.material).length);
  for (const c of CUTS) {
    await shot(c, { hairStyle: c }, 0.65);
    if (SHOTS) await shot(`${c}-back`, { hairStyle: c }, Math.PI - 0.4);
    expect(await hairMeshes(), c).toBe(c === 'bald' ? 0 : c === 'ponytail' ? 2 : 1); // ponytail: shell top + scanned tail
  }
  for (const b of BEARDS) { await shot(`beard-${b}`, { facial: b }, 0.65); expect(await hairMeshes(), b).toBe(b === 'stubble' ? 1 : 2); }
  await shot('beard-front', { facial: 'beard', hairStyle: 'fade' }, 0);
  const tri = await page.evaluate(() => { const g = (window as any).__game; let n = 0; g.player.human.root.traverse((o: any) => { if (o.isSkinnedMesh && o.visible) n += o.geometry.index ? o.geometry.index.count / 3 : 0; }); return n; });
  expect(tri).toBeGreaterThan(0);
  clean(p);
});
