import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

/** Round 7 (owner): lamps in the road at Broadway's junctions; headlights lit nothing; Low showed white signals; lamp glow floated. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

test('no lamp stands in the cross street at a Broadway junction; lamp glow lies on the ground', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game, out: number[][] = [];
    for (let k = 1; k <= 4; k++) {
      const I = g.city.intersections.find((i: any) => i.ix === k && i.iz === k);
      for (const h of g.visuals.lampHeads) { const dx = h.x - I.x, dz = h.z - I.z; if (Math.abs(dx) < 30 && Math.abs(dz) < 30 && Math.max(Math.abs(dx), Math.abs(dz)) < 16) out.push([k, +dx.toFixed(1), +dz.toFixed(1)]); }
    }
    // pools: within 25 cm of the street/pavement under each grid lamp (they used to float at a fixed 0.21 m, or under a freeway deck)
    const ys: number[] = g.lampPoolY, heads = g.visuals.lampHeads; let floating = 0;
    for (let i = 0; i < heads.length; i++) if (heads[i].y < 20 && (ys[i] > heads[i].y - 3.5 || ys[i] < -1)) floating++;
    return { out, floating, n: ys.length };
  });
  console.log('lamps', JSON.stringify(r));
  expect(r.out).toEqual([]);
  expect(r.n).toBeGreaterThan(100);
  expect(r.floating).toBe(0);
});

test('headlights: real spot lights follow the lit cars at night (count by preset); Low keeps coloured signals', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game; g.hour = 23; g.clockRunning = false;
    const car = g.vehicles.spawn('sedan', g.player.pos.x + 5, g.player.pos.z, 0, -1, 0.4); car.persistent = true; g.seatPlayer(car);
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    const spots = g.renderer.scene.children.filter((o: any) => o.isSpotLight), lit = spots.filter((l: any) => l.intensity > 0);
    const near = lit.some((l: any) => l.position.distanceTo(car.position) < 4);
    g.renderer.setQuality('low'); for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    const lowSpots = g.renderer.scene.children.filter((o: any) => o.isSpotLight).length;
    const a = g.visuals.signalLamps.instanceColor.array as Float32Array; let white = 0;
    for (let i = 0; i < a.length; i += 3) if (a[i] > 0.9 && a[i + 1] > 0.9 && a[i + 2] > 0.9) white++;
    g.renderer.setQuality('medium');
    return { spots: spots.length, lit: lit.length, near, lowSpots, white };
  });
  console.log('heads', JSON.stringify(r));
  expect(r.spots).toBe(2);
  expect(r.near).toBe(true);
  expect(r.lowSpots).toBe(1);
  expect(r.white).toBe(0);
});
