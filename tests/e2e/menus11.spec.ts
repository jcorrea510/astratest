import { test, expect, type Page } from '@playwright/test';
import { boot, step } from './helpers';

/** Round 11 (owner: "the UIs are terrible"): the pause header, every pause tab and the store detail pane. */
const SIZES = [{ width: 1024, height: 700 }, { width: 1440, height: 900 }];
const box = (p: Page, sel: string) => p.locator(sel).first().evaluate(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });

test('pause: wordmark never touches the tab bar, every tab shows its pane; stores show a detail pane', async ({ page }) => {
  test.setTimeout(300_000);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await boot(page);
    await step(page, 0.5, { render: true });
    await page.keyboard.press('Escape');
    await step(page, 0.1);
    // header: wordmark | tabs | status in one row, nothing overlapping, nothing clipped by the screen
    const brand = await box(page, '.ma-pause-brand'), tabs = await box(page, '.ma-pause-tabs'), meta = await box(page, '.ma-pause-meta');
    expect(brand.t).toBeGreaterThanOrEqual(0);
    expect(brand.r).toBeLessThanOrEqual(tabs.l);
    expect(tabs.r).toBeLessThanOrEqual(meta.l);
    expect(meta.r).toBeLessThanOrEqual(size.width);
    const head = await box(page, '.ma-pause-head');
    expect(brand.b).toBeLessThanOrEqual(head.b);
    expect(tabs.b).toBeLessThanOrEqual(head.b);
    // each tab shows its content
    const views: Record<string, string> = { map: '.ma-map.is-open', sandbox: '.ma-sandbox.is-open', settings: '.ma-settings.is-open', controls: '.ma-controls.is-open', quit: '.ma-pane-quit.is-active' };
    for (const [tab, sel] of Object.entries(views)) {
      await page.evaluate(t => (window as any).__meridian.ui.selectPauseTab(t), tab);
      await step(page, 0.1);
      await expect(page.locator(sel).first(), tab).toBeVisible();
      const v = await box(page, sel);
      expect(v.t, `${tab} sits under the header`).toBeGreaterThanOrEqual(head.b - 1);
      expect(v.b).toBeLessThanOrEqual(size.height + 1);
    }
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await step(page, 0.1);
    // store: the detail pane follows the focused row and carries the buy state
    await page.evaluate(() => { const m = (window as any).__meridian; (window as any).__game.exitVehicle?.(true); m.activities.openShop('arms'); });
    await step(page, 0.1);
    await expect(page.locator('.ma-shop-detail')).toBeVisible();
    const first = await page.locator('.ma-shop-item.is-selected .ma-shop-name').first().innerText();
    expect((await page.locator('.ma-shop-dname').innerText()).toLowerCase()).toBe(first.toLowerCase());
    await expect(page.locator('.ma-shop-buy')).toBeVisible();
    await page.locator('.ma-shop-item').nth(2).hover();
    const third = await page.locator('.ma-shop-item').nth(2).locator('.ma-shop-name').innerText();
    expect((await page.locator('.ma-shop-dname').innerText()).toLowerCase()).toBe(third.toLowerCase());
    expect(await page.locator('.ma-shop-stat').count()).toBeGreaterThan(0);
    const panel = await box(page, '.ma-shop-panel');
    expect(panel.l).toBeGreaterThanOrEqual(0); expect(panel.r).toBeLessThanOrEqual(size.width); expect(panel.b).toBeLessThanOrEqual(size.height);
    await page.evaluate(() => (window as any).__meridian.ui.closeShop());
  }
});
