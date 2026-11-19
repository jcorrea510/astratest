import { test, expect } from '@playwright/test';
import { boot, watch, clean, quietStreets } from './helpers';

/** Chase camera must not pop between two positions on the arch bridge (camera collision against ribs/hangers/deck). */
test('chase camera is smooth along the Cannery Channel bridge', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(400, 7.5, -480, 0);
    const v = g.vehicles.spawn('sedan', 400, -480, Math.PI / 2, -1, 7.6); v.persistent = true; g.seatPlayer(v);
    for (let i = 0; i < 30; i++) g.frame(1 / 60, false);
    g.input.press('KeyW');
    const rel: number[][] = [], xs: number[] = [], camV: number[] = [], carV: number[] = [];
    let last = g.renderer.camera.position.clone(); const lastCar = v.position.clone();
    for (let i = 0; i < 60 * 14; i++) {
      const dt = i % 2 ? 1 / 45 : 1 / 144; // uneven frame times, like a real browser tab
      g.frame(dt, false);
      const c = g.renderer.camera.position, q = v.position;
      rel.push([c.x - q.x, c.y - q.y, c.z - q.z]); xs.push(q.x);
      camV.push(c.distanceTo(last) / dt); last = c.clone(); carV.push(q.distanceTo(lastCar) / dt); lastCar.copy(q);
    }
    g.input.release('KeyW');
    // camera offset relative to the car, only while on the bridge span
    const on = rel.filter((_, i) => xs[i] > 480 && xs[i] < 585);
    let maxJump = 0;
    for (let i = 1; i < on.length; i++) maxJump = Math.max(maxJump, Math.hypot(on[i][0] - on[i - 1][0], on[i][1] - on[i - 1][1], on[i][2] - on[i - 1][2]));
    // camera speed should be steady while cruising: deviation from the mean over the bridge (m/s)
    // detrended: deviation of each frame's speed from the local average (accelerating is fine, surging is not)
    const dev = (a: number[]) => { let m = 0; for (let i = 8; i < a.length - 8; i++) { if (!(xs[i] > 480 && xs[i] < 585)) continue; let s = 0; for (let k = -8; k <= 8; k++) s += a[i + k]; m = Math.max(m, Math.abs(a[i] - s / 17)); } return m; };
    const speedDev = dev(camV), carDev = dev(carV), mean = 30;
    return { n: on.length, maxJump, speedDev, carDev, mean, topSpeed: v.speed, x: xs[xs.length - 1] };
  });
  console.log('BRIDGE', JSON.stringify(r));
  expect(r.n).toBeGreaterThan(60);
  expect(r.carDev).toBeLessThan(1.5); // displayed car speed (m/s) vs its local average
  expect(r.speedDev).toBeLessThan(3); // steady, no forward/back surges
  expect(r.maxJump).toBeLessThan(0.6); // metres per 1/60 s frame (smooth follow at ~30 m/s changes the offset by centimetres)
  clean(p);
});
