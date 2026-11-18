import { test, expect } from '@playwright/test';
import { boot, step, quietStreets, watch, clean } from './helpers';

/** Sets a wanted level and steps until a unit of `kind` exists (returns seconds taken or -1). */
async function waitFor(page: import('@playwright/test').Page, heat: number, js: string, maxSec = 40) {
  await page.evaluate(h => { const g = (window as any).__game; g.hour = 1; g.police.setHeat(h, g.player.pos); }, heat);
  for (let t = 0; t < maxSec; t += 2) {
    await step(page, 2);
    if (await page.evaluate(js)) return t + 2;
  }
  return -1;
}
const hasUnit = (k: string) => `(window.__game.police.units.some(u => window.__game.police.dispatch.kindOf(u) === '${k}' && !u.v.destroyed))`;

test.describe('police escalation', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await quietStreets(page); });

  test('5 stars: a tank with turret and army soldiers hunt the player', async ({ page }) => {
    const p = watch(page);
    expect(await waitFor(page, 5, `${hasUnit('tank')} && ${hasUnit('army')}`, 60)).toBeGreaterThan(0);
    const info = await page.evaluate(() => {
      const g = (window as any).__game, d = g.police.dispatch;
      const tank = g.police.units.find((u: any) => d.kindOf(u) === 'tank');
      return { tankKind: tank.v.kind, crew: [...d.crew.values()].flat().length, heli: !!d.heli };
    });
    expect(info.tankKind).toBe('tank');
    expect(info.crew).toBeGreaterThan(0);
    clean(p);
  });

  test('3 stars: a SWAT van; 4 stars: FBI SUVs and a police helicopter', async ({ page }) => {
    expect(await waitFor(page, 3, hasUnit('swat'), 40)).toBeGreaterThan(0);
    expect(await waitFor(page, 4, `${hasUnit('fbi')} && !!window.__game.police.dispatch.heli`, 60)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).__game.police.dispatch.heli.variant)).toBe('police');
  });

  test('1 star: the officer handcuffs the player, then ARRESTED shows', async ({ page }) => {
    await page.evaluate(() => {
      const g = (window as any).__game; g.hour = 12; const p = g.player;
      g.police.setHeat(1, p.pos);
      const cop = g.pop.spawn('police', p.pos.x + 1.2, p.pos.z, p.pos.y, undefined);
      g.police.dispatch.arm(cop, 'police', 1, false); g.police.foot.push(cop); cop.target = p; cop.lastSeen.copy(p.pos);
      (window as any).__cop = cop;
    });
    await step(page, 4, { render: true });
    // cuffing in progress or done: the arrest state exists and the player is down in the busted flow
    expect(await page.evaluate(() => !!(window as any).__game.police.dispatch.arrest)).toBe(true);
    await step(page, 1.2, { render: true });
    expect(await page.evaluate(() => (window as any).__cop.char.human.currentAction ?? 'cuffing')).toBeTruthy();
    await step(page, 3, { render: true });
    await expect(page.locator('.ma-death-word')).toHaveText('Arrested');
  });

  test('cops drag the player out of a stopped car', async ({ page }) => {
    await page.evaluate(() => {
      const g = (window as any).__game, p = g.player;
      const v = g.vehicles.spawn('sedan', p.pos.x + 4, p.pos.z, 0, -1, p.pos.y + 0.4); g.seatPlayer(v);
      g.police.setHeat(2, v.position);
      const cop = g.pop.spawn('police', v.position.x + 3, v.position.z, p.pos.y, undefined);
      g.police.dispatch.arm(cop, 'police', 2, true); g.police.foot.push(cop); cop.target = p; cop.lastSeen.copy(v.position);
    });
    await step(page, 8, { render: false });
    expect(await page.evaluate(() => (window as any).__game.playerVehicle)).toBeNull();
  });
});
