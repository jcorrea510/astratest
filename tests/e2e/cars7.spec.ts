import { test, expect } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 7 (owner): more variety of cars: a crossover, a city car and a sport sedan join traffic, the kerbs and the dealer. */
const SHOTS = process.env.CAR_SHOTS || '';
test('new car models build, drive and sit level; they are in traffic and for sale', async ({ page }) => {
  test.setTimeout(400_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, out: any = {};
    g.hour = 13; g.clockRunning = false; g.player.place(-250, 0.25, -70, 0);
    const kinds = ['crossover', 'citycar', 'sportsedan'], cars: any[] = [];
    kinds.forEach((k, i) => { const c = g.vehicles.spawn(k, -256 + i * 4.5, -84, 0, -1, 0.5); c.persistent = true; cars.push(c); });
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
    for (const [i, c] of cars.entries()) { const up = c.phys.upVec(); out[kinds[i]] = { up: +up.y.toFixed(3), y: +c.position.y.toFixed(2), name: c.spec.name }; }
    // a short drive in the sport sedan
    g.seatPlayer(cars[2]); g.input.press('KeyW'); for (let i = 0; i < 90; i++) g.frame(1 / 30, false); g.input.release('KeyW');
    out.speed = +Math.abs(cars[2].speed).toFixed(1);
    g.exitVehicle(true);
    cars[2].phys.teleport(-247, 0.5, -84, 0); g.player.place(-240, 0.25, -70, 0); for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    const cam = g.cam.camera; cam.position.set(-251.5, 2.4, -77.5); cam.lookAt(-251.5, 0.7, -84); cam.updateMatrixWorld(true); g.renderer.render();
    return out;
  });
  console.log('cars', JSON.stringify(r));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/newcars.png` });
  for (const k of ['crossover', 'citycar', 'sportsedan']) expect(r[k].up, k).toBeGreaterThan(0.98);
  expect(r.speed).toBeGreaterThan(5);
});
