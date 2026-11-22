import { test, expect } from '@playwright/test';
import { boot } from './helpers';
/** Round 8: nothing solid (pillars, poles, posts) stands in a driving lane anywhere in the city. */
test('no static obstacle in any lane', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const sample = (l: any, s: number, o: any) => { const pts = l.points, cum = l.cum; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
      o.x = a.x + (b.x - a.x) * t; o.z = a.z + (b.z - a.z) * t; o.y = l.ys ? l.ys[i - 1] + (l.ys[i] - l.ys[i - 1]) * t : 0; };
    const hits: any[] = []; let n = 0;
    const G_STATIC = 0x0001, filt = ((0xffff) << 16) | G_STATIC;
    for (const l of g.city.lanes) {
      if (l.connector) continue;
      const sp = { x: 0, z: 0, dx: 0, dz: 1, y: 0 } as any;
      for (let s = 1; s < l.length - 1; s += 3) {
        sample(l, s, sp); n++;
        // stand on the real road surface (a hill lane's stored heights can sit under the terrain mesh)
        const gr = g.physics.ray(sp.x, (sp.y ?? 0) + 4, sp.z, 0, -1, 0, 8, ((0xffff) << 16) | G_STATIC);
        const y = (gr ? (sp.y ?? 0) + 4 - gr.toi : (sp.y ?? 0)) + 1.35; // 0.65-2.05 m above the road: posts and pillars
        if (g.physics.overlapsCapsule(sp.x, y, sp.z, 0.4, 0.3, filt)) hits.push({ x: Math.round(sp.x), z: Math.round(sp.z), y: Math.round(y), lane: l.id });
      }
    }
    return { n, hits: hits.slice(0, 40), total: hits.length };
  });
  console.log('ROADCLEAR', JSON.stringify(r));
  expect(r.n).toBeGreaterThan(5000);
  expect(r.total).toBe(0);
});
