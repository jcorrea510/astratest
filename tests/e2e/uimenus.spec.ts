import { test, expect, type Page } from '@playwright/test';
import { boot, step, watch, clean, quietStreets } from './helpers';

const paused = (p: Page) => p.evaluate(() => (window as any).__game.paused as boolean);
const menu = (p: Page) => p.evaluate(() => (window as any).__meridian.ui.isMenuOpen() as boolean);
const gameKey = async (p: Page, k: string) => { await p.keyboard.press(k); await step(p, 0.1); };

test.describe('menus: Esc backs out one level', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await step(page, 1, { render: true }); });

  for (const tab of ['Sandbox', 'Settings', 'Controls']) {
    test(`Esc in pause > ${tab} returns to the pause menu, then resumes`, async ({ page }) => {
      const p = watch(page);
      await gameKey(page, 'Escape');
      expect(await paused(page)).toBe(true);
      await page.locator('.ma-ptab', { hasText: tab }).click();
      await step(page, 0.1);
      await page.screenshot({ path: `/tmp/claude-0/s/pause-${tab}.png` });
      await page.keyboard.press('Escape');
      await step(page, 0.1);
      expect(await paused(page)).toBe(true); // still paused: only one level
      expect(await page.locator('.ma-pause.is-open').count()).toBe(1);
      expect(await page.locator('.ma-pause.is-docked').count()).toBe(0);
      await page.keyboard.press('Escape');
      await step(page, 0.1);
      expect(await paused(page)).toBe(false);
      expect(await menu(page)).toBe(false);
      // and the game still pauses again afterwards (pausing opens on the map: Esc from there resumes at once)
      await gameKey(page, 'Escape');
      expect(await paused(page)).toBe(true);
      await page.keyboard.press('Escape');
      await step(page, 0.1);
      expect(await paused(page)).toBe(false);
      expect(await menu(page)).toBe(false);
      clean(p);
    });
  }

  test('every sub-panel has a visible Back button that works', async ({ page }) => {
    await gameKey(page, 'Escape');
    for (const tab of ['Map', 'Sandbox', 'Settings', 'Controls']) {
      await page.locator('.ma-ptab', { hasText: tab }).click();
      const back = page.locator('.ma-layer.is-open [data-back]');
      await page.screenshot({ path: `/tmp/claude-0/s/back-${tab}.png` });
      await expect(back, tab).toBeVisible();
      await back.click();
      await step(page, 0.1);
      expect(await page.locator('.ma-pause.is-docked').count()).toBe(0);
      expect(await paused(page)).toBe(true);
    }
  });

  test('Esc while rebinding a key cancels the rebind only', async ({ page }) => {
    await gameKey(page, 'Escape');
    await page.locator('.ma-ptab', { hasText: 'Settings' }).click();
    await page.locator('.ma-settings .ma-tab', { hasText: 'Key bindings' }).click();
    const slot = page.locator('.ma-settings .ma-keyslot').first();
    const before = await slot.textContent();
    await slot.click();
    await expect(slot).toHaveText('Press a key…');
    await page.keyboard.press('Escape');
    await step(page, 0.1);
    await expect(slot).toHaveText(before!);
    expect(await paused(page)).toBe(true);
    expect(await page.locator('.ma-settings.is-open').count()).toBe(1); // still in settings
    await page.keyboard.press('Escape'); await step(page, 0.1); // settings -> pause menu
    expect(await page.locator('.ma-settings.is-open').count()).toBe(0);
    expect(await paused(page)).toBe(true);
    await page.keyboard.press('Escape'); await step(page, 0.1); // pause menu -> game
    expect(await paused(page)).toBe(false);
    expect(await menu(page)).toBe(false);
  });
});

test.describe('save safety and wheel', () => {
  test('saving on a rooftop stores street ground; Continue from a roof-position save resumes on valid ground', async ({ page }) => {
    const p = watch(page);
    await boot(page); await quietStreets(page); await step(page, 1);
    // stand in the middle of a building lot, save, and read it back
    const lot = await page.evaluate(() => {
      const g = (window as any).__game, c = g.city;
      for (const b of c.blocks) { const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2; if (b.kind !== 'park') return { x, z }; }
      return null;
    });
    expect(lot).not.toBeNull();
    await page.evaluate(({ x, z }) => { (window as any).__game.player.place(x, 40, z, 0); }, lot!);
    expect(await page.evaluate(() => (window as any).__meridian.save())).toBe(true);
    const saved = await page.evaluate(() => (window as any).__meridian.read().pos);
    expect(Math.hypot(saved.x - lot!.x, saved.z - lot!.z) > 1).toBe(true);
    // an old save that sits on a roof / in the sea is repaired on load
    await page.evaluate(({ x, z }) => {
      const raw = JSON.parse(localStorage.getItem('meridian-afterglow.save.v1')!);
      raw.pos = { x, z, yaw: 1 };
      localStorage.setItem('meridian-afterglow.save.v1', JSON.stringify(raw));
    }, lot!);
    await page.goto('./?autostart=1&continue=1');
    await page.waitForFunction(() => !!(window as any).__meridian?.activities, null, { timeout: 180_000 });
    await page.evaluate(() => (window as any).__game.stop());
    await step(page, 2);
    const r = await page.evaluate(() => { const g = (window as any).__game; return { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z, alive: g.player.alive, paused: g.paused }; });
    expect(r.alive).toBe(true);
    expect(r.y).toBeLessThan(15);
    expect(Math.hypot(r.x - lot!.x, r.z - lot!.z) > 1).toBe(true);
    expect(await page.evaluate(() => (window as any).__game.deathT)).toBeLessThan(0);
    clean(p);
  });

  test('weapon wheel renders realistic icons', async ({ page }) => {
    await boot(page); await quietStreets(page); await step(page, 1);
    await page.waitForFunction(() => document.querySelectorAll('.ma-wheel').length > 0);
    await page.evaluate(() => (window as any).__meridian.openWheel());
    await step(page, 0.2, { render: true });
    const n = await page.locator('.ma-wheel-slot image').count();
    expect(n).toBeGreaterThan(1);
    await page.screenshot({ path: '/tmp/claude-0/s/wheel.png' });
    await page.evaluate(() => (window as any).__meridian.closeWheel(true));
  });
});

test('title menu describes the Sandbox mode choice', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Press any key')).toBeVisible({ timeout: 180_000 });
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('button', { name: 'Sandbox' }).focus();
  await expect(page.locator('.ma-title-desc')).toContainText('Sandbox');
  await page.screenshot({ path: '/tmp/claude-0/s/title.png' });
});
