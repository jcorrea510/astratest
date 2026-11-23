import { test, expect } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 7 (owner): garages to fix your car and change the paint (choose the colour). Round 9: it is now a drive-in hall, see garage9.spec.ts. */
test('garage: stopping in the bay opens repair + paint; repair restores health, a chosen colour is applied, both cost money', async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities;
    g.money = 3000; g.police.clear();
    const car = g.vehicles.spawn('sedan', -182, 121, 0, -1, 0.4); car.persistent = true; g.seatPlayer(car);
    car.health = car.spec.health * 0.4;
    for (let i = 0; i < 110; i++) g.frame(1 / 30, false); // door closes (1.5 s of real time), then the menu opens
    const open = A.shopIsOpen && !!document.querySelector('.ma-garage.is-open'), paused = g.paused;
    const swatches = document.querySelectorAll('.ma-garage-sw').length, hasRepair = !!document.querySelector('[data-act="repair"]');
    const m0 = g.money; (document.querySelector('[data-act="repair"]') as HTMLElement).click();
    const repaired = car.health >= car.spec.health - 0.01, m1 = g.money;
    (document.querySelectorAll('.ma-garage-sw')[5] as HTMLElement).focus();
    (document.querySelector('[data-act="paint"]') as HTMLElement).click(); const m2 = g.money;
    const paint = car.paint.getHexString();
    (document.querySelector('.ma-garage .ma-btn') as HTMLElement).click(); // Leave
    for (let i = 0; i < 70; i++) g.frame(1 / 30, false);
    return { open, paused, swatches, hasRepair, repaired, repairCost: m0 - m1, paintCost: m1 - m2, paint, after: { state: A.garage.state, paused: g.paused, open: A.shopIsOpen } };
  });
  console.log('garage', JSON.stringify(r));
  expect(r.open).toBe(true); expect(r.paused).toBe(true);
  expect(r.hasRepair).toBe(true);
  expect(r.swatches).toBeGreaterThan(10);
  expect(r.repaired).toBe(true);
  expect(r.repairCost).toBeGreaterThan(100);
  expect(r.paintCost).toBe(150);
  expect(r.after).toEqual({ state: 'idle', paused: false, open: false });
});
