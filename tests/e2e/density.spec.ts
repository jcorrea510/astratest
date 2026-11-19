import { test, expect } from '@playwright/test';
import { watch, boot, step, clean } from './helpers';

/** City density: Manhattan-style traffic and crowds, lane changes signal first, frame-time budget. */
test.describe.configure({ mode: 'serial' });

const SPOT = { x: -50, z: 0 }; // Meridian Blvd x Sunset Blvd, mid-city

async function goto(page: import('@playwright/test').Page) {
  await page.evaluate((s) => { const g = (window as any).__game; g.player.place(s.x + 9, 0.25, s.z + 9, 0); g.trafficCap = null; g.pedCap = null; }, SPOT);
  await step(page, 20, { dt: 1 / 20 });
}

test('medium preset: at least 25 cars and 60 pedestrians within 150 m of a mid-city corner, parked cars on the curbs', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await goto(page);
  const n = await page.evaluate((s) => {
    const g = (window as any).__game, within = (a: any, r: number) => Math.hypot(a.x - s.x, a.z - s.z) < r;
    const realCars = g.vehicles.list.filter((v: any) => g.traffic.cars.some((c: any) => c.v === v) && within(v.position, 150)).length;
    const realPeds = g.pop.npcs.filter((x: any) => !x.char.inVehicle && within(x.pos, 150)).length;
    const far = g.crowd.countNear(s.x, s.z, 150);
    return { realCars, realPeds, ...far, drawCalls: g.renderer.renderer.info.render.calls, quality: g.renderer.qualityName };
  }, SPOT);
  console.log('density', JSON.stringify(n));
  expect(n.quality).toBe('medium');
  expect(n.realCars + n.cars).toBeGreaterThanOrEqual(25);
  expect(n.realPeds + n.peds).toBeGreaterThanOrEqual(60);
  expect(n.parked).toBeGreaterThanOrEqual(15);
  clean(p);
});

test('lane changes: the turn signal comes on before the car moves over, and both lanes are used', async ({ page }) => {
  test.setTimeout(900_000);
  const p = watch(page);
  await boot(page);
  await goto(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const seen = new Map<any, { sig: number; laneAtSig: number }>(); let changes = 0, signalledFirst = 0;
    const lanesUsed = new Set<number>();
    for (let i = 0; i < 20 * 50; i++) {
      g.frame(1 / 20, false);
      for (const c of g.traffic.cars) {
        if (c.lane.connector) continue; lanesUsed.add(c.lane.lane);
        const rec = seen.get(c);
        if (!rec) { seen.set(c, { sig: c.v.signal, laneAtSig: c.lane.id }); continue; }
        if (c.lane.id !== rec.laneAtSig && !c.lane.connector) {
          const old = g.city.lanes[rec.laneAtSig];
          if (!old.connector && old.roadId === c.lane.roadId && old.lane !== c.lane.lane && c.lc && c.lc.done) { changes++; if (c.v.signal !== 0 && c.lc.t >= 1.4) signalledFirst++; }
          rec.laneAtSig = c.lane.id;
        }
      }
    }
    return { changes, signalledFirst, lanesUsed: [...lanesUsed] };
  });
  console.log('lanechange', JSON.stringify(r));
  expect(r.lanesUsed).toEqual(expect.arrayContaining([0, 1]));
  expect(r.changes).toBeGreaterThanOrEqual(1);
  expect(r.signalledFirst).toBe(r.changes);
  clean(p);
});

test('frame budget: busy city sim stays cheap and draw calls stay under 450', async ({ page }) => {
  test.setTimeout(900_000);
  const p = watch(page);
  await boot(page);
  await goto(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    for (let i = 0; i < 3; i++) g.frame(1 / 60, true);
    const info = g.renderer.renderer.info.render, calls = info.calls, tris = info.triangles;
    const N = 120, t0 = performance.now();
    for (let i = 0; i < N; i++) g.frame(1 / 60, false);
    return { simMs: (performance.now() - t0) / N, calls, tris };
  });
  console.log('perf', JSON.stringify(r));
  expect(r.calls).toBeLessThan(450);
  expect(r.simMs).toBeLessThan(30); // CPU time of sim+culling per frame (GPU time is not measurable headless)
  clean(p);
});
