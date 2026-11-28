import { test, expect } from '@playwright/test';
import { boot, watch, clean, quietStreets } from './helpers';

/**
 * Batch 1 Driving Feel E2E regression tests (single boot for CI speed):
 * - D1: scraping the Cannery Channel bridge median at 69 mph (linvel x=31) while holding W+A slows the car
 *   (>= 15% speed loss/s), stays at road height (rise < 0.08 m), stays on its side of the median,
 *   and takes <= 10% health damage on a glancing scrape.
 * - D5: severe >= 45 mph head-on crash shatters the windscreen and triggers camera pull-back + trauma.
 */
test('D1 + D5: bridge median scrape resists climbing & sheds speed; >= 45 mph head-on shatters glass & kicks camera', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);

  const r = await page.evaluate(() => {
    const g = (window as any).__game;

    // --- D1: Cannery Channel bridge median scrape ---
    g.player.place(400, 7.5, -478, 0);
    const v1 = g.vehicles.spawn('sportsedan', 400, -478, Math.PI / 2, -1, 7.6);
    v1.persistent = true;
    g.seatPlayer(v1);
    for (let i = 0; i < 45; i++) g.frame(1 / 60, false);

    const restY = v1.position.y;
    const startHp = v1.health;
    const maxHp = v1.spec.health;
    v1.phys.setVelocity(31, 0, 0); // 69 mph along the bridge

    g.input.press('KeyW');
    g.input.press('KeyA');

    let maxRise = 0;
    let minZ = Infinity;
    let scrapeSteps = 0;
    let speedAtContact = -1;

    for (let i = 0; i < 60; i++) {
      g.frame(1 / 60, false);
      maxRise = Math.max(maxRise, v1.position.y - restY);
      minZ = Math.min(minZ, v1.position.z);
      if (v1.phys.scrapeActive) {
        scrapeSteps++;
        if (speedAtContact < 0) speedAtContact = v1.speed;
      }
    }

    g.input.release('KeyW');
    g.input.release('KeyA');

    const endSpeed = v1.speed;
    const contactSec = scrapeSteps / 60;
    const lossPerSec = speedAtContact > 0 && contactSec > 0.1
      ? ((speedAtContact - endSpeed) / speedAtContact) / contactSec
      : 0;
    const hpLostFrac = (startHp - v1.health) / maxHp;

    // --- D5: severe head-on crash (>= 45 mph) ---
    g.exitVehicle(true);
    g.vehicles.remove(v1);
    g.settings.cameraShake = 1;
    g.cam.shakeScale = 1;
    g.player.place(420, 7.5, -478, 0);
    const v2 = g.vehicles.spawn('sportsedan', 420, -478, Math.PI, -1, 7.6);
    v2.persistent = true;
    g.seatPlayer(v2);
    for (let i = 0; i < 30; i++) g.frame(1 / 60, false);

    // Drive straight north (-Z) at ~52 mph (~23.5 m/s) into the median barrier at z=-480
    v2.phys.setVelocity(0, 0, -23.5);
    let peakTrauma = 0;
    let peakPull = 0;
    for (let i = 0; i < 20; i++) {
      g.frame(1 / 60, false);
      peakTrauma = Math.max(peakTrauma, g.cam.trauma);
      peakPull = Math.max(peakPull, g.cam.crashPullOffset);
    }
    const ws = v2.panes.find((x: any) => x.name === 'windshield');

    return {
      d1: { restY, maxRise, minZ, scrapeSteps, speedAtContact, endSpeed, lossPerSec, hpLostFrac },
      d5: { wsBroken: !!ws?.broken, peakTrauma, peakPull, hpFrac: v2.health / v2.spec.health },
    };
  });

  console.log('DRIVING_FEEL', JSON.stringify(r));

  expect(r.d1.scrapeSteps).toBeGreaterThan(10);
  expect(r.d1.endSpeed).toBeLessThan(31);
  expect(r.d1.lossPerSec).toBeGreaterThanOrEqual(0.15);
  expect(r.d1.maxRise).toBeLessThan(0.08);
  expect(r.d1.minZ).toBeGreaterThan(-480.2);
  expect(r.d1.hpLostFrac).toBeLessThanOrEqual(0.10);

  expect(r.d5.wsBroken).toBe(true);
  expect(r.d5.peakTrauma).toBeGreaterThan(0.6);
  expect(r.d5.peakPull).toBeGreaterThan(0.5);
  expect(r.d5.hpFrac).toBeLessThan(0.75);

  clean(p);
});
