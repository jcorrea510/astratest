import { test, expect } from '@playwright/test';
import { watch, boot, clean } from './helpers';

test.describe.configure({ mode: 'serial' });
const SHOTS = process.env.R6BW_SHOTS ?? '';

test('rail terminals, park lake and the one-hand left arm', async ({ page }) => {
  test.setTimeout(400_000);
  const p = watch(page); await boot(page);
  const shot = async (name: string, at: [number, number, number], focus: [number, number, number], yaw: number, dist: number, pitch: number) => {
    await page.evaluate(({ at, focus, yaw, dist, pitch }) => {
      const g = (window as any).__game;
      g.trafficCap = 0; g.pedCap = 0; g.player.place(at[0], at[1], at[2], 0);
      const V = g.cam.camera.position.constructor;
      g.cam.preview = { focus: new V(...focus), yaw, dist, pitch, fov: 60 };
      for (let f = 0; f < 90; f++) g.frame(1 / 30, f === 89);
    }, { at, focus, yaw, dist, pitch });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  // elevated line: both ends are terminals (end wall + buffer stops), looked at from the open side
  await shot('rail-south', [250, 0.3, 755], [250, 8.5, 775], 0.5, 26, 0.12);
  await shot('rail-north', [250, 0.3, -70], [250, 8.5, -90], Math.PI + 0.5, 26, 0.12);
  await shot('park-lake', [0, 0.3, -205], [0, 0.2, -250], 0.6, 62, 0.62);
  await shot('park-lake-close', [0, 0.3, -205], [0, 0.4, -226], 0.3, 14, 0.3);
  await page.evaluate(() => { (window as any).__game.cam.preview = null; });
  // left arm: a pistol that is not aimed leaves the left arm on the walk swing (no pistol-ready pose, no grip IK)
  const r = await page.evaluate(() => {
    const g = (window as any).__game, h = g.player.human;
    g.pcombat.give('pistol', 30); g.pcombat.inv.select('pistol');
    g.player.place(-300, 0.3, -90, 0);
    const mode0 = (h as any).upperMode;
    g.input.press('KeyW'); g.input.press('ShiftLeft');
    const bone = h.model.getObjectByName('DEF-upper_armL'), q: number[] = [];
    for (let f = 0; f < 60; f++) { g.frame(1 / 30, false); const e = bone.quaternion; q.push(e.x * 2 + e.y * 3 + e.z * 5); }
    g.input.release('KeyW'); g.input.release('ShiftLeft');
    const swing = Math.max(...q) - Math.min(...q);
    return { mode0, mode: (h as any).upperMode, swing, aiming: g.pcombat.aiming };
  });
  expect(r.aiming).toBe(false);
  expect(r.mode).toBe('loco');
  expect(r.swing).toBeGreaterThan(0.02);
  clean(p);
});
