import { test, expect } from '@playwright/test';
/** Round 7 perf: no building of car models / body LODs / hair during play (0.6-1 s freezes); hitch budget on a 63 mph drive. */
test('fast drive: no build hitches (worst frame well under 300 ms in software GL), nothing left to warm', async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const t0 = Date.now();
  await page.goto('./?autostart=1');
  await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 500_000 });
  const boot = Date.now() - t0;
  const r = await page.evaluate(() => {
    const g = (window as any).__game; g.stop(); g.renderer.setQuality('medium'); g.clockRunning = false; g.hour = 12;
    const w0 = [...g.pop.warmMs].sort((a: number, b: number) => b - a);
    const lane = g.city.lanes.filter((l: any) => !l.connector && !l.ys && !l.diag && l.points.length === 2 && l.lane === l.lanes - 1 && Math.abs(l.points[0].x) < 500).sort((a: any, b: any) => b.length - a.length)[0];
    const p0 = lane.points[0], p1 = lane.points[1], L = lane.length, ux = (p1.x - p0.x) / L, uz = (p1.z - p0.z) / L;
    const car = g.vehicles.spawn('sedan', p0.x + ux * 5, p0.z + uz * 5, Math.atan2(ux, uz), -1, 0.4); car.persistent = true; g.seatPlayer(car);
    for (let i = 0; i < 200; i++) g.frame(1 / 30, false);
    const t: number[] = []; const acc: Record<string, number> = {}; const spikes: any[] = [];
    const wrap = (o: any, name: string, label: string) => { const f = o[name].bind(o); o[name] = (...a: any[]) => { const s0 = performance.now(); const r = f(...a); acc[label] = (acc[label] ?? 0) + performance.now() - s0; return r; }; };
    wrap(g.traffic, 'update', 'traffic'); wrap(g.crowd, 'update', 'crowd'); wrap(g.pop, 'update', 'pop'); wrap(g.vehicles, 'update', 'vehicles'); wrap(g, 'fixedUpdate', 'fixed');
    wrap(g.physics, 'step', 'physics'); wrap(g.buses, 'update', 'buses'); wrap(g.police, 'update', 'police'); wrap(g.pcombat, 'update', 'pcombat'); wrap(g.renderer, 'updateEnvironment', 'env');
    wrap(g, 'cullChunks', 'cull'); wrap(g.particles, 'update', 'particles'); wrap(g.pop, 'vehicleHits', 'vhits'); wrap(g.traffic, 'fixedUpdate', 'tFixed'); wrap(g.pop, 'fixedUpdate', 'pFixed'); wrap(g.playerCtl, 'fixedUpdate', 'plFixed'); wrap(g.pop, 'spawn', 'spawn'); wrap(g.traffic, 'spawnOnLane', 'tspawn'); wrap(g.vehicles, 'spawn', 'vspawn');
    for (let i = 0; i < 900; i++) {
      const lv = car.phys.body.linvel(); car.phys.body.setLinvel({ x: ux * 28, y: lv.y, z: uz * 28 }, true);
      if (i % 200 === 199) car.phys.settleAt(p0.x + ux * 5, 0.4, p0.z + uz * 5, Math.atan2(ux, uz));
      for (const k in acc) acc[k] = 0;
      const t0 = performance.now(); g.frame(1 / 60, false); const dt = performance.now() - t0; t.push(dt);
      if (dt > 45 && spikes.length < 12) spikes.push({ i, dt: Math.round(dt), ...Object.fromEntries(Object.entries(acc).filter(([, v]) => v > 3).map(([k, v]) => [k, Math.round(v)])) });
    }
    const big = t.filter(x => x > 60).length; t.sort((a, b) => a - b);
    return { avg: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(2), p95: +t[855].toFixed(2), max: +t[899].toFixed(0), over60: big,
      loadWarm: { n: w0.length, sum: Math.round(w0.reduce((a: number, b: number) => a + b, 0)), top: w0.slice(0, 6).map((x: number) => Math.round(x)) }, warmedLater: g.pop.warmMs.length - w0.length, pending: g.pop.warmPending, spikes, slept: g.vehicles.list.filter((v: any) => v.phys.sleptSteps > 0).length };
  });
  console.log('PERF', boot, JSON.stringify(r));
  expect(r.max).toBeLessThan(300);
  expect(r.pending).toBe(0);
  expect(r.slept).toBeGreaterThan(0); // parked cars asleep skip their tyre update
});
