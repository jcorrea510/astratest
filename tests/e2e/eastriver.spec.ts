import { test, expect } from '@playwright/test';
import { boot, quietStreets, step, watch, clean } from './helpers';

// East River: draw calls at the bridge and on the east shore, and a car crosses the Brookhaven suspension bridge.
test('east river: draw calls at the bridge + Eastbank, drive over the bridge', async ({ page }) => {
  test.setTimeout(400_000);
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const shot = process.env.CITY_SHOTS ?? '';
  const spots = [
    { name: 'bridge', x: 535, z: 100, yaw: -Math.PI / 2, y: 0.3 },
    { name: 'bridgetop', x: 625, z: 100, yaw: -Math.PI / 2, y: 5.6 },
    { name: 'bridgeside', x: 556, z: 45, yaw: -1.25, y: 0.3 },
    { name: 'eastbank', x: 745, z: 250, yaw: -Math.PI / 2, y: 0.05 },
    { name: 'eastbank2', x: 850, z: 500, yaw: 0, y: 0.05 },
  ];
  for (const s of spots) {
    await page.evaluate(s => { const g = (window as any).__game; g.player.place(s.x, s.y, s.z, s.yaw); g.cam.yaw = s.yaw; g.cam.pitch = 0.05; }, s);
    await step(page, 1.5, { render: true });
    const calls = await page.evaluate(() => { const g = (window as any).__game; g.frame(1 / 60, true); return g.renderer.renderer.info.render.calls; });
    console.log('draw calls', s.name, calls);
    expect(calls).toBeLessThan(700);
    if (shot) await page.screenshot({ path: `${shot}/${s.name}.png` });
  }
  if (shot) {
    await page.evaluate(() => { const g = (window as any).__game; g.player.place(300, 0.05, 100, 0); g.cam.update(0, g.player.pos, 'aim'); g.renderer.camera.position.set(430, 90, 20); g.renderer.camera.lookAt(660, 0, 140); g.renderer.render?.(); });
    await page.screenshot({ path: `${shot}/bridgeaerial.png` });
  }
  // drive east over the bridge from Harbor Drive to Shore Road
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(536, 0.3, 97, 0);
    const v = g.vehicles.spawn('sedan', 536, 97, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
    for (let i = 0; i < 20; i++) g.frame(1 / 60, false);
    g.input.press('KeyW');
    let maxY = 0;
    // what the car met, sampled every 2 s (a failure once stopped it at x 561 on the ramp with no cause in the log)
    const why: any[] = [];
    for (let i = 0; i < 30 * 14; i++) {
      g.frame(1 / 15, false); maxY = Math.max(maxY, v.position.y);
      if (i % 30 === 29) {
        let nv = 99, nk = ''; for (const o of g.vehicles.list) { if (o === v) continue; const d = o.position.distanceTo(v.position); if (d < nv) { nv = d; nk = o.kind + (o.driver ? '+d' : '') + (o.persistent ? '+p' : ''); } }
        let np = 99; for (const n of g.pop.npcs) if (n.alive) np = Math.min(np, n.pos.distanceTo(v.position));
        why.push({ t: (i + 1) / 15, x: +v.position.x.toFixed(1), z: +v.position.z.toFixed(2), v: +v.speed.toFixed(1), th: v.input.throttle, hb: v.input.handbrake, ign: v.ignition, in: g.playerVehicle === v, blk: g.inputBlocked, ce: !!g.carEntry?.blocksDriving, nv: +nv.toFixed(1), nk, np: +np.toFixed(1), hp: Math.round(v.health) });
      }
    }
    g.input.release('KeyW');
    return { x: v.position.x, z: v.position.z, y: v.position.y, maxY, why };
  });
  console.log('bridge drive end', JSON.stringify(r));
  expect(r.x, JSON.stringify(r.why)).toBeGreaterThan(740);
  expect(r.maxY).toBeGreaterThan(4);
  expect(r.y).toBeLessThan(2);
  if (shot) {
    await page.keyboard.press('KeyM'); await step(page, 1, { render: true }); await page.waitForTimeout(800);
    await page.screenshot({ path: `${shot}/fullmap.png` });
  }
  clean(p);
});
