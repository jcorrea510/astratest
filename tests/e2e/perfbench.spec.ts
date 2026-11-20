import { test, expect } from '@playwright/test';
import { watch, clean } from './helpers';

/**
 * Deterministic render benchmark: seeded Math.random, fixed downtown camera path, 300 frames per preset.
 * Logs renderer.info calls/triangles and CPU ms per frame (software GL, so only the triangle/call counts are comparable).
 * BASE_HIGH_TRIS: the high-preset average of a reference build (R6-V base 178a853: 2.41M tris, 532 calls); the real-model far crowd
 * must not cost more than 15 % on top of it.
 */
test.describe.configure({ mode: 'serial' });
const BASE_HIGH_TRIS = Number(process.env.BASE_HIGH_TRIS ?? 0);

test('benchmark: triangles and draw calls on low / medium / high along a fixed downtown path', async ({ page }) => {
  test.setTimeout(900_000);
  const p = watch(page);
  await page.addInitScript(() => { let a = 12345; Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  await page.goto('./?autostart=1');
  await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 500_000 });
  await page.evaluate(() => (window as any).__game.stop());
  const res: Record<string, { calls: number; tris: number; cpuMs: number /* sim-only ms/frame */; cars: number; fullFar: number }> = {};
  for (const q of ['low', 'medium', 'high'] as const) {
    res[q] = await page.evaluate((q) => {
      const g = (window as any).__game; g.renderer.setQuality(q); g.clockRunning = false; g.hour = 12; g.trafficCap = null; g.pedCap = null;
      const path = [[-41, 9], [-41, -60], [-110, -60], [-110, 20]];
      g.player.place(path[0][0], 0.25, path[0][1], 0);
      for (let i = 0; i < 240; i++) g.frame(1 / 30, false); // settle the crowd
      let calls = 0, tris = 0, ms = 0, nr = 0, nsim = 0;
      for (let i = 0; i < 300; i++) {
        const k = Math.floor(i / 75), f = (i % 75) / 75, a = path[k], b = path[(k + 1) % path.length];
        g.player.place(a[0] + (b[0] - a[0]) * f, 0.25, a[1] + (b[1] - a[1]) * f, Math.atan2(b[0] - a[0], b[1] - a[1]));
        const draw = i % 10 === 9; // software GL is ~1 s per drawn frame: draw every 10th, simulate all 300
        const t0 = performance.now(); g.frame(1 / 60, draw);
        if (draw) { nr++; calls += g.renderer.stats.calls; tris += g.renderer.stats.triangles; } else { ms += performance.now() - t0; nsim++; }
      }
      // car occupants follow the people LODs (they were all 15k-tri full bodies with shadows, ~1.2M tris a frame on high)
      const fullFar = g.pop.npcs.filter((n: any) => n.char.inVehicle && n.char.human.mesh.visible && n.char.human.mesh.geometry === n.char.human.base.geo && n.char.inVehicle.position.distanceTo(g.player.pos) > 40).length;
      return { calls: Math.round(calls / nr), tris: Math.round(tris / nr), cpuMs: +(ms / nsim).toFixed(1), cars: g.vehicles.list.length, fullFar };
    }, q);
    console.log('BENCH', q, JSON.stringify(res[q]));
  }
  if (BASE_HIGH_TRIS > 0) expect(res.high.tris).toBeLessThan(BASE_HIGH_TRIS * 1.15);
  expect(res.high.calls).toBeGreaterThan(0);
  expect(res.high.fullFar).toBe(0);
  clean(p);
});
