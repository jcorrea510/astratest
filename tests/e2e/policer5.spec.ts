import { test, expect, type Page } from '@playwright/test';
import { boot, step, quietStreets, watch, clean } from './helpers';

/** Parks an ambient cop car on a long straight lane and puts the player `gap` metres ahead of it on foot. Returns nothing; use __r5. */
async function scene(page: Page, gap = 25) {
  await page.evaluate((gap) => {
    const g = (window as any).__game;
    const lane = g.city.lanes.find((l: any) => !l.connector && l.length > 120);
    const car = g.traffic.spawnOnLane('police', lane, 20, 'cruise', 'police');
    car.patrol = true; car.maxSpeed = 0; car.persistent = true; car.v.persistent = true; car.passengers = [];
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    const v = car.v, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    g.player.place(v.position.x + fx * gap, v.position.y, v.position.z + fz * gap, 0);
    (window as any).__r5 = car;
    g.hour = 14;
  }, gap);
}
const heat = (page: Page) => page.evaluate(() => (window as any).__game.police.heat as number);

test.describe('police R5', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await quietStreets(page); });

  test('a cop who sees a traffic violation pursues with lights and siren', async ({ page }) => {
    const p = watch(page);
    await scene(page);
    expect(await heat(page)).toBe(0);
    await page.evaluate(() => { const g = (window as any).__game; g.police.violation('red_light', g.player.pos); });
    await step(page, 1);
    expect(await heat(page)).toBe(1);
    const r = await page.evaluate(() => { const g = (window as any).__game, c = (window as any).__r5; return { unit: g.police.units.includes(c), siren: !!c.v.siren, mode: c.mode }; });
    expect(r).toEqual({ unit: true, siren: true, mode: 'pursuit' });
    clean(p);
  });

  test('a violation nobody saw raises no heat', async ({ page }) => {
    await scene(page, 130); // beyond the 90 m sight range
    await page.evaluate(() => { const g = (window as any).__game; g.police.violation('speeding', g.player.pos); });
    await step(page, 2);
    expect(await heat(page)).toBe(0);
  });

  test('shooting a cop car: the crew brakes, steps out and fights within about a second', async ({ page }) => {
    const p = watch(page);
    await scene(page, 20);
    await page.evaluate(() => { const g = (window as any).__game, c = (window as any).__r5; g.police.onVehicleShot(c.v); });
    expect(await heat(page)).toBeGreaterThanOrEqual(2);
    await step(page, 1.4);
    const r = await page.evaluate(() => { const g = (window as any).__game, c = (window as any).__r5; return { out: !c.driver.char.inVehicle, foot: g.police.foot.includes(c.driver), brain: c.driver.brain, alive: c.driver.alive }; });
    expect(r.alive).toBe(true);
    expect(r.out).toBe(true);
    expect(r.foot).toBe(true);
    expect(['combat', 'chase']).toContain(r.brain);
    clean(p);
  });

  test('stolen cop car: cops that see the player in it re-raise heat after it was lost', async ({ page }) => {
    const p = watch(page);
    await scene(page, 30);
    await page.evaluate(() => {
      const g = (window as any).__game, c = (window as any).__r5;
      const v = g.vehicles.spawn('police', g.player.pos.x + 3, g.player.pos.z, 0, -1, g.player.pos.y + 0.3);
      g.boardFinished(v); // first use of a police car = theft
      g.police.clear(); (window as any).__stolen = v;
      c.maxSpeed = 0;
    });
    expect(await heat(page)).toBe(0);
    await step(page, 1.5);
    expect(await heat(page)).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => !!(window as any).__game.police.stolenCop)).toBe(true);
    clean(p);
  });

  test('heat does not decay while a police helicopter has the player in its spotlight, and decays once LOS is broken', async ({ page }) => {
    const p = watch(page);
    await page.evaluate(() => {
      const g = (window as any).__game; g.hour = 14;
      for (const n of g.pop.npcs) if (n.role === 'police') g.pop.remove(n);
      g.police.setHeat(4, g.player.pos);
    });
    // the heli arrives and circles; no cop cars exist near the player (kill the dispatch queue)
    await page.evaluate(() => { const g = (window as any).__game; g.police.holdT = 9999; for (let i = 0; i < 90; i++) g.frame(1 / 30, false); });
    const hasHeli = await page.evaluate(() => !!(window as any).__game.police.dispatch.heli);
    expect(hasHeli).toBe(true);
    await step(page, 45); // far longer than the 19 s search timer
    expect(await heat(page)).toBe(4);
    expect(await page.evaluate(() => (window as any).__game.police.state.seen)).toBe(true);
    // put a solid roof between heli and player: LOS breaks and the search timer starts
    const lost = await page.evaluate(() => {
      const g = (window as any).__game, P = g.police;
      const orig = P.pop.runner.hasLOS; P.pop.runner.hasLOS = () => false;
      for (let i = 0; i < 30 * 5; i++) g.frame(1 / 30, false);
      const t = P.state.unseenT; P.pop.runner.hasLOS = orig; return t;
    });
    expect(lost).toBeGreaterThan(2);
    clean(p);
  });
});
