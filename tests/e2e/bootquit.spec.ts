import { test, expect } from '@playwright/test';

/** Quit to title resets in place: no navigation, the same Game object, and Continue starts again (twice in a row). */
test('quit to title does not reload and you can start again', async ({ page }) => {
  test.setTimeout(500_000);
  // count document loads (a reload or a cross-document navigation); dropping ?autostart from the URL with history.replaceState is not one
  let navs = 0;
  page.on('load', () => navs++);
  await page.goto('./?autostart=1');
  await page.waitForFunction(() => !!(window as any).__meridian?.game, null, { timeout: 280_000, polling: 1000 });
  await page.waitForFunction(() => !document.querySelector('.ma-loading.is-open'), null, { timeout: 120_000, polling: 1000 });
  await page.evaluate(() => { (window as any).__marker = 'same-page'; (window as any).__gameRef = (window as any).__game; });
  const startNavs = navs;
  for (let round = 0; round < 2; round++) {
    await page.evaluate(() => { const m = (window as any).__meridian; m.game.money = 1234; m.game.police.setHeat(2, m.game.player.pos); m.quit(); });
    await expect(page.locator('.ma-title')).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => (window as any).__marker)).toBe('same-page');
    expect(navs).toBe(startNavs);
    const s = await page.evaluate(() => { const g = (window as any).__game; return { same: g === (window as any).__gameRef, running: g.isRunning, paused: g.paused, heat: g.police.heat, money: g.money }; });
    expect(s.same).toBe(true); expect(s.running).toBe(true); expect(s.paused).toBe(false); expect(s.heat).toBe(0);
    // click empty space to reveal the title menu; Continue is there because quitting saved
    await page.mouse.click(4, 4); // pointerdown on the title reveals the menu
    const cont = page.getByRole('button', { name: /continue/i }).first();
    await expect(cont).toBeVisible();
    await cont.click();
    await expect(page.locator('.ma-title.is-open')).toHaveCount(0, { timeout: 60_000 });
    await page.waitForFunction(() => { const g = (window as any).__game; return g && !g.paused && !document.querySelector('.ma-loading.is-open'); }, null, { timeout: 60_000, polling: 1000 });
    expect(await page.evaluate(() => (window as any).__game.money)).toBe(1234);
  }
  expect(navs).toBe(startNavs);
});
