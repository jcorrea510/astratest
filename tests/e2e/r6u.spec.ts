import { test, expect, type Page } from '@playwright/test';
import { boot, step, watch, clean } from './helpers';

/** Fake fullscreen: the state lives on the page (so a reload drops it, like the real thing) and the calls are counted in sessionStorage. */
async function mockFullscreen(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__fsOn = false;
    const bump = (k: string) => sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) ?? 0) + 1));
    Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
    Object.defineProperty(document, 'fullscreenElement', { get: () => (w.__fsOn ? document.documentElement : null) });
    Element.prototype.requestFullscreen = function () { w.__fsOn = true; bump('fsEnter'); document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { w.__fsOn = false; bump('fsExit'); document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
}
const count = (page: Page, k: string) => page.evaluate(k2 => Number(sessionStorage.getItem(k2) ?? 0), k);

test('fullscreen: one icon button (no menu row), survives menu/highway transitions, restored after the quit reload', async ({ page }) => {
  test.setTimeout(420_000);
  const prob = watch(page);
  await mockFullscreen(page);
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).__title, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__title.game.stop());
  await page.keyboard.press('Space');
  await expect(page.locator('[data-item="fullscreen"]')).toHaveCount(0); // no Fullscreen menu row any more
  const btn = page.locator('.ma-fs-btn');
  await expect(btn).toBeVisible();
  const box = (await btn.boundingBox())!;
  expect(box.x).toBeGreaterThan(1280 - 120); expect(box.y).toBeLessThan(80); // top-right corner
  await btn.dispatchEvent('click');
  expect(await count(page, 'fsEnter')).toBe(1);
  // into the highway setup and a run: nothing may leave fullscreen
  await page.locator('[data-item="highway"]:visible').click();
  await expect(page.locator('#hw-menu')).toBeVisible();
  await expect(page.locator('#hw-menu .hw-fs-btn')).toBeVisible();
  await expect(page.getByText('Fullscreen', { exact: true })).toHaveCount(0);
  await page.locator('#hw-start').dispatchEvent('click');
  await page.waitForFunction(() => !!(window as any).__highway, null, { timeout: 120_000 });
  await page.evaluate(() => (window as any).__highway.stop());
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  expect(await count(page, 'fsExit')).toBe(0);
  // pause -> quit to title reloads the page; the next key press puts fullscreen back
  await page.evaluate(() => (window as any).__highway.quit());
  await page.waitForFunction(() => !(window as any).__highway && !!document.querySelector('.ma-root'), null, { timeout: 120_000 });
  expect(await page.evaluate(() => sessionStorage.getItem('ma.wantFullscreen'))).toBe('1');
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.keyboard.press('Space');
  expect(await count(page, 'fsEnter')).toBe(2);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  expect(await count(page, 'fsExit')).toBe(0);
  clean({ errors: prob.errors.filter(e => !/WebGL|GPU stall|swiftshader/i.test(e)), failed: prob.failed });
});

test('map: live 3D while rotating, top-down toggle, Q/E never leave the map', async ({ page }) => {
  test.setTimeout(280_000);
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { (window as any).__game.player.place(0, 0.3, 120, 0); });
  await step(page, 1, { render: true });
  await page.keyboard.press('KeyM'); await step(page, 1, { render: true });
  const canvas = page.locator('.ma-map-canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(1500);
  // rotating: the building layer is re-extruded during the turn, not only after it stops
  const live = await page.evaluate(async () => {
    const f = (window as any).__meridian.ui.fullmap;
    const t0 = f.view.tilt as number, target = t0 + Math.PI / 2;
    const mid: number[] = [];
    f.rotate(Math.PI / 2);
    const start = performance.now();
    await new Promise<void>(res => { const tick = () => { const L = f.layerView; if (L && L.tilt > t0 + 0.05 && L.tilt < target - 0.05) mid.push(L.tilt); if (performance.now() - start < 1500) requestAnimationFrame(tick); else res(); }; tick(); });
    return { mid: mid.length };
  });
  expect(live.mid).toBeGreaterThanOrEqual(1); // the extruded buildings were redrawn mid-turn, not only after it stopped
  const view = () => page.evaluate(() => { const f = (window as any).__meridian.ui.fullmap; return { tilt: f.view.tilt, pitch: f.view.pitch, top: f.topDown, layerPitch: f.layerView?.pitch, label: document.querySelector('#ma-map-pitch')!.textContent }; });
  // top-down via the key and via the button
  expect((await view()).label).toBe('Top-down');
  await page.keyboard.press('KeyT'); await page.waitForTimeout(1500);
  const td = await view();
  expect(td.pitch).toBeGreaterThan(0.99); expect(td.layerPitch).toBeGreaterThan(0.99); expect(td.label).toBe('3D view');
  await page.screenshot({ path: '/tmp/claude-0/shots/u-map-top.png' });
  await page.locator('#ma-map-pitch').click(); await page.waitForTimeout(1500);
  const back = await view();
  expect(back.pitch).toBeLessThan(0.7); expect(back.label).toBe('Top-down');
  await page.keyboard.press('KeyF'); await page.waitForTimeout(800);
  expect((await view()).pitch).toBeLessThan(back.pitch! - 0.05);
  await page.keyboard.press('KeyN'); await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/claude-0/shots/u-map-3d.png' });
  // paused: the map is the pause menu's first tab; E rotates it and must not switch to the Sandbox tab
  await page.keyboard.press('KeyM'); await step(page, 0.3);
  await page.keyboard.press('Escape'); await step(page, 0.3);
  await page.waitForTimeout(600);
  const t1 = (await view()).tilt!;
  await page.keyboard.press('KeyE'); await page.waitForTimeout(900);
  expect((await view()).tilt).toBeGreaterThan(t1 + 0.1);
  expect(await page.evaluate(() => (window as any).__meridian.ui.fullmap.isOpen())).toBe(true);
  await expect(page.locator('.ma-sandbox.is-open')).toHaveCount(0);
  clean(p);
});
