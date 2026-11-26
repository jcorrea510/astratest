import { test, expect } from '@playwright/test';
import { boot, step } from './helpers';

/** Round 12c: the touch controls show on any touchscreen without ?touch=1 (iPad Safari reports as a Mac with a
 *  fine pointer), and Settings > Controls > Touch Controls = Off hides them. */
test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

test('touch controls show by themselves on a touchscreen, and the Off setting hides them', async ({ page }) => {
  await page.addInitScript(() => { try { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); } catch { /* */ } });
  await boot(page);
  await step(page, 0.3);
  await page.evaluate(() => (window as any).__game.frame(1 / 30, true));
  await expect(page.locator('.ma-touch.is-on')).toBeVisible();

  await page.evaluate(() => localStorage.setItem('meridian-afterglow.settings.v1', JSON.stringify({ touchControls: 'off' })));
  await boot(page);
  await step(page, 0.3);
  await page.evaluate(() => (window as any).__game.frame(1 / 30, true));
  await expect(page.locator('.ma-touch.is-on')).toHaveCount(0);
});
