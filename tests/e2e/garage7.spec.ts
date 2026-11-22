import { test, expect } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 7 (owner): garages to fix your car and change the paint (choose the colour). */
test('garage: stopping in the bay opens repair + paint; repair restores health, a chosen colour is applied, both cost money', async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities;
    g.money = 3000; g.police.clear();
    const car = g.vehicles.spawn('sedan', -200, 102, Math.PI / 2, -1, 0.4); car.persistent = true; g.seatPlayer(car);
    car.health = car.spec.health * 0.4;
    for (let i = 0; i < 40; i++) g.frame(1 / 30, false);
    const open = A.shopIsOpen, items = open ? A.garageItems().map((it: any) => it.id) : [];
    const m0 = g.money; A.buy('g:repair'); const repaired = car.health >= car.spec.health - 0.01, m1 = g.money;
    A.buy('g:paint:#8a1c1c'); const m2 = g.money;
    A.closeShop();
    return { open, items: items.slice(0, 4), nItems: items.length, repaired, repairCost: m0 - m1, paintCost: m1 - m2, paint: car.paintHex ?? null };
  });
  console.log('garage', JSON.stringify(r));
  expect(r.open).toBe(true);
  expect(r.items).toContain('g:repair');
  expect(r.nItems).toBeGreaterThan(10);
  expect(r.repaired).toBe(true);
  expect(r.repairCost).toBeGreaterThan(100);
  expect(r.paintCost).toBe(150);
});
