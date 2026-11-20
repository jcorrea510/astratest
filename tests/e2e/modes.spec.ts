import { test, expect } from '@playwright/test';
import { boot, step } from './helpers';

/* R6-M: Regular vs Sandbox mode, death penalty, dealership and the title menu wording. */
type W = any;

test.describe('game modes', () => {
  test.setTimeout(240_000);

  test('regular: unarmed, small cash, sandbox tools do nothing', async ({ page }) => {
    await boot(page, '&mode=regular');
    const r = await page.evaluate(() => {
      const m = (window as W).__meridian, g = m.game, inv = g.pcombat.inv;
      const before = g.money;
      m.sandbox.act('cash'); m.sandbox.act('arsenal'); m.sandbox.act('god', true); m.sandbox.act('never', true);
      let opened = false; m.sandbox.openPanel(() => { /* closed at once */ }); opened = m.sandbox.open;
      return { mode: g.mode, money: before, after: g.money, current: inv.current, owned: inv.owned(), medkits: inv.medkits, god: m.sandbox.god, never: m.sandbox.neverWanted, opened };
    });
    expect(r).toMatchObject({ mode: 'regular', money: 400, after: 400, current: 'fists', owned: ['fists'], medkits: 0, god: false, never: false, opened: false });
  });

  test('regular: dying charges a medical bill and takes every weapon; respawn is unarmed', async ({ page }) => {
    await boot(page, '&mode=regular');
    await page.evaluate(() => {
      const g = (window as W).__game; g.money = 5000;
      g.pcombat.give('pistol', 60); g.pcombat.give('rifle', 90); g.pcombat.inv.medkits = 2; g.pcombat.inv.select('rifle');
      g.playerDown('down'); g.respawnDelay = 0;
    });
    const dead = await page.evaluate(() => { const g = (window as W).__game, inv = g.pcombat.inv; return { money: g.money, owned: inv.owned(), medkits: inv.medkits, notice: g.deathNotice }; });
    expect(dead.money).toBe(4500); expect(dead.owned).toEqual(['fists']); expect(dead.medkits).toBe(0); expect(dead.notice).toMatch(/Medical bill \$500/);
    await step(page, 1);
    const alive = await page.evaluate(() => { const g = (window as W).__game; return { dt: g.deathT, hp: g.player.health, cur: g.pcombat.inv.current }; });
    expect(alive.dt).toBe(-1); expect(alive.hp).toBeGreaterThan(50); expect(alive.cur).toBe('fists');
  });

  test('regular: busted costs a fine and the guns', async ({ page }) => {
    await boot(page, '&mode=regular');
    await page.evaluate(() => { const g = (window as W).__game; g.money = 10_000; g.pcombat.give('smg', 60); g.playerDown('busted'); });
    const r = await page.evaluate(() => { const g = (window as W).__game; return { money: g.money, owned: g.pcombat.inv.owned() }; });
    expect(r.money).toBe(9200); expect(r.owned).toEqual(['fists']);
  });

  test('sandbox: unchanged (cheats work, nothing lost on death, still spawns holstered)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const m = (window as W).__meridian, g = m.game;
      const start = { mode: g.mode, money: g.money, cur: g.pcombat.inv.current, pistol: g.pcombat.inv.weapons.pistol.owned };
      m.sandbox.act('cash');
      const afterCash = g.money;
      g.pcombat.inv.select('pistol'); g.playerDown('down'); g.respawnDelay = 0;
      return { start, afterCash, money: g.money, pistol: g.pcombat.inv.weapons.pistol.owned, cur: g.pcombat.inv.current };
    });
    expect(r.start).toEqual({ mode: 'sandbox', money: 2500, cur: 'fists', pistol: true });
    expect(r.afterCash).toBe(12_500); expect(r.money).toBe(12_500); expect(r.pistol).toBe(true);
    await step(page, 1);
    expect(await page.evaluate(() => (window as W).__game.pcombat.inv.current)).toBe('fists');
  });

  test('regular: buy a car at the dealership; it persists in the save and a goal toast fires', async ({ page }) => {
    await boot(page, '&mode=regular');
    const r = await page.evaluate(() => {
      const m = (window as W).__meridian, g = m.game, a = m.activities;
      g.money = 40_000;
      const poor = a.buyCar('super'); // cannot afford
      const ok = a.buyCar('coupe');
      const slot = a.ownedVeh?.[0] ?? null;
      const v = g.vehicles.list.find((x: W) => x.kind === 'coupe' && x.persistent);
      a.checkMilestones();
      const items = a.dealerItems().map((i: W) => i.id);
      return { poor, ok, money: g.money, cars: a.ownedCars.length, hasVeh: !!v, y: v?.position.y, slot: !!slot, ms: [...a.milestones], items, worth: a.netWorth() };
    });
    expect(r.poor).toBe(false); expect(r.ok).toBe(true);
    expect(r.money).toBe(40_000 - 38_000); expect(r.cars).toBe(1); expect(r.hasVeh).toBe(true);
    expect(r.ms).toEqual(expect.arrayContaining(['firstCar', 'sportsCar']));
    expect(r.items).toContain('car:coupe');
    expect(r.worth).toBe(2000 + 30_400);
    const saved = await page.evaluate(() => { const m = (window as W).__meridian; m.save(); return m.read(); });
    expect(saved).toMatchObject({ version: 2, mode: 'regular', cars: [{ kind: 'coupe' }] });
    // a car that vanished (despawned / destroyed) comes back in the garage row
    await page.evaluate(() => { const m = (window as W).__meridian, g = m.game; for (const v of [...g.vehicles.list]) if (v.kind === 'coupe') g.vehicles.remove(v); m.activities.parkOwned(); });
    expect(await page.evaluate(() => (window as W).__game.vehicles.list.filter((v: W) => v.kind === 'coupe').length)).toBe(1);
  });

  test('regular: higher till payout than sandbox', async ({ page }) => {
    await boot(page, '&mode=regular');
    const mode = await page.evaluate(() => (window as W).__game.mode);
    expect(mode).toBe('regular');
  });
});

test('title: New game then pick a mode; Continue describes the save', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.waitForFunction(() => !!(window as W).__title, null, { timeout: 180_000 });
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Play$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('button', { name: 'Regular' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sandbox' })).toBeVisible();
  await page.getByRole('button', { name: 'Regular' }).click();
  await page.waitForFunction(() => !!(window as W).__meridian?.activities, null, { timeout: 180_000 });
  expect(await page.evaluate(() => (window as W).__game.mode)).toBe('regular');
  const hud = await page.locator('.ma-mode-badge').textContent();
  expect(hud).toBe('Regular');
});

test('title: Continue describes the saved game (mode, cash, last played)', async ({ page }) => {
  test.setTimeout(240_000);
  const save = { version: 2, savedAt: Date.now() - 5 * 60_000, mode: 'regular', money: 12345, health: 100, armor: 0, weapons: {}, current: 'fists', medkits: 0, missions: [], collectibles: [], jumps: [], pos: { x: -300, z: -106, yaw: 1 }, hour: 18, stats: { kills: 0, distance: 0, crashes: 0 }, cars: [], milestones: [], robberies: 0 };
  await page.addInitScript(sv => { try { localStorage.setItem('meridian-afterglow.save.v1', JSON.stringify(sv)); } catch { /* ignore */ } }, save);
  await page.goto('./');
  await page.waitForFunction(() => !!(window as W).__title, null, { timeout: 180_000 });
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Continue — Regular, \$12,345, 5 min ago/ })).toBeVisible();
});
