import { test, expect } from '@playwright/test';

// The game runs in a shell iframe so reloading the game (quit to title, leave highway) keeps the top page fullscreen.
test('fullscreen survives a game reload inside the shell', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
  await page.goto('./');
  const frameEl = page.locator('#game-frame');
  await expect(frameEl).toHaveCount(1);
  const frame = page.frameLocator('#game-frame');
  const btn = frame.locator('.ma-fs-btn').first();
  await btn.waitFor({ state: 'visible', timeout: 150_000 });
  await btn.click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), { timeout: 10_000 }).toBe(true);
  const f = page.frames().find(fr => fr !== page.mainFrame())!;
  await f.evaluate(() => { location.href = location.pathname; }); // what quit-to-title / leave-highway do
  await page.waitForTimeout(3000);
  await expect(page.locator('#game-frame')).toHaveCount(1);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
});
