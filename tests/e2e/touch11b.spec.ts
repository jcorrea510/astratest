import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets, step } from './helpers';

/** Touch controls, part 2 (iPad Air 11" landscape): helicopter button set, prompts, and settings / shop / garage menus by finger. */
test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

async function ptr(page: Page, sel: string, type: string, id: number) {
  await page.evaluate(({ sel, type, id }) => {
    const el = document.querySelector(sel)!; const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true }));
  }, { sel, type, id });
}
async function tapEl(page: Page, sel: string) {
  const r = await page.locator(sel).first().boundingBox();
  expect(r, sel).toBeTruthy();
  await page.touchscreen.tap(r!.x + r!.width / 2, r!.y + r!.height / 2);
}
async function heights(page: Page, sel: string): Promise<number[]> {
  return page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0).map(r => Math.min(r.width, r.height)), sel);
}

test('helicopter: the touch set has lift, pitch and exit', async ({ page }) => {
  await boot(page, '&touch=1');
  await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-415, 0.25, -55, 0); (window as any).__h = g.spawnHelicopter('news', -410, -55, 0); });
  await step(page, 0.5);
  await ptr(page, '[data-touch-btn=enter]', 'pointerdown', 1); await ptr(page, '[data-touch-btn=enter]', 'pointerup', 1);
  await page.evaluate(() => { const g = (window as any).__game, h = (window as any).__h; for (let i = 0; i < 400 && g.playerHeli !== h; i++) g.frame(1 / 30, false); });
  expect(await page.evaluate(() => !!(window as any).__game.playerHeli)).toBe(true);
  await step(page, 1.5);
  await page.evaluate(() => (window as any).__game.frame(1 / 30, true));
  for (const id of ['up', 'down', 'pitch', 'rev', 'exit']) {
    await expect(page.locator(`[data-touch-btn=${id}]`), id).toBeVisible();
    const sz = await heights(page, `[data-touch-btn=${id}]`); expect(sz[0], id).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('[data-touch-btn=jump]')).toHaveCount(0);
  // UP lifts (handbrake action), DOWN descends (sprint action), FWD pitches
  await ptr(page, '[data-touch-btn=up]', 'pointerdown', 2);
  expect(await page.evaluate(() => (window as any).__game.input.held('handbrake'))).toBe(true);
  await step(page, 2);
  expect(await page.evaluate(() => (window as any).__h.position.y)).toBeGreaterThan(0.5);
  await ptr(page, '[data-touch-btn=up]', 'pointerup', 2);
  await ptr(page, '[data-touch-btn=pitch]', 'pointerdown', 3);
  expect(await page.evaluate(() => (window as any).__game.input.throttle())).toBe(1);
  await ptr(page, '[data-touch-btn=pitch]', 'pointerup', 3);
  await ptr(page, '[data-touch-btn=down]', 'pointerdown', 4);
  expect(await page.evaluate(() => (window as any).__game.input.held('sprint'))).toBe(true);
  await ptr(page, '[data-touch-btn=down]', 'pointerup', 4);
  await page.screenshot({ path: 'test-results/touch-heli.png' });
});

test('menus by finger: pause, settings tabs + slider, key bindings note, shop, garage', async ({ page }) => {
  await boot(page, '&touch=1');
  await step(page, 0.3);
  await page.evaluate(() => (window as any).__game.frame(1 / 30, true));
  // pause with a tap, then Settings
  await tapEl(page, '[data-touch-btn=pause]');
  await step(page, 0.2);
  await page.evaluate(() => (window as any).__meridian.ui.selectPauseTab('settings'));
  await step(page, 0.2);
  await expect(page.locator('.ma-settings.is-open')).toBeVisible();
  for (const s of ['.ma-tab', '.ma-ptab', '.ma-back']) for (const hgt of await heights(page, s)) expect(hgt, s).toBeGreaterThanOrEqual(43);
  // tap the Input tab, then tap the middle of the first slider: the setting changes
  await page.locator('.ma-settings .ma-tab', { hasText: 'Input' }).tap();
  const slider = page.locator('.ma-settings input.ma-range').first();
  await expect(slider).toBeVisible();
  expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(43);
  const before = await slider.inputValue();
  const bb = (await slider.boundingBox())!;
  await page.touchscreen.tap(bb.x + bb.width * 0.9, bb.y + bb.height / 2);
  expect(await slider.inputValue()).not.toBe(before);
  // Key Bindings: a note instead of an unusable list
  await page.locator('.ma-settings .ma-tab', { hasText: 'Key Bindings' }).tap();
  await expect(page.locator('.ma-keys-info')).toContainText('connect a keyboard');
  expect(await page.locator('.ma-keyslot:not([disabled])').count()).toBe(0);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await step(page, 0.1);

  // a shop
  await page.evaluate(() => { const m = (window as any).__meridian; (window as any).__game.exitVehicle?.(true); m.activities.openShop('arms'); });
  await step(page, 0.2);
  await expect(page.locator('.ma-shop-detail')).toBeVisible();
  for (const s of ['.ma-shop-item', '.ma-shop-buy']) for (const hgt of await heights(page, s)) expect(hgt, s).toBeGreaterThanOrEqual(43);
  const first = await page.locator('.ma-shop-dname').innerText();
  await page.locator('.ma-shop-item').nth(2).tap();
  const second = await page.locator('.ma-shop-dname').innerText();
  expect(second.toLowerCase()).not.toBe(first.toLowerCase());
  expect(await page.evaluate(() => (window as any).__game.money)).toBe(2500); // the selecting tap bought nothing
  await page.evaluate(() => (window as any).__meridian.ui.closeShop());

  // garage panel: repair / respray swatch / leave all answer a tap
  await page.evaluate(() => {
    const m = (window as any).__meridian; (window as any).__calls = [];
    const c = (n: string) => () => (window as any).__calls.push(n);
    m.ui.openGarage({ title: 'Glow Garage', money: 5000, car: 'Test car', healthPct: 60, paintName: 'Red', repair: { price: 100, note: '', enabled: true },
      paints: [{ hex: '#ff0000', name: 'Red' }, { hex: '#00ff00', name: 'Green' }, { hex: '#0000ff', name: 'Blue' }], paintPrice: 50, paintNote: '', paintEnabled: true, sell: { price: 900, ok: true, note: '' } },
    { onRepair: c('repair'), onPreview: (hex: string) => (window as any).__calls.push('preview:' + hex), onPaint: c('paint'), onSell: c('sell'), onLeave: c('leave') });
  });
  await expect(page.locator('.ma-garage.is-open')).toBeVisible();
  for (const s of ['.ma-garage-row', '.ma-garage-sw']) for (const hgt of await heights(page, s)) expect(hgt, s).toBeGreaterThanOrEqual(43);
  await tapEl(page, '[data-act=repair]');
  await page.locator('.ma-garage-sw').nth(1).tap();
  const calls = await page.evaluate(() => (window as any).__calls as string[]);
  expect(calls).toContain('repair');
  expect(calls.some(c => c.startsWith('preview:'))).toBe(true);
});
