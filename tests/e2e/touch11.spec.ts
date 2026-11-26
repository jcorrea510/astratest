import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets, step, watch } from './helpers';

/** Touch controls on an iPad Air 11" in landscape (1180x820): layout, hit targets, multi-touch, menus. */
test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

const rect = (page: Page, sel: string) => page.evaluate(s => { const r = document.querySelector(s)!.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
/** Dispatches a pointer event the way a finger would (page.touchscreen only does one tap at a time). */
async function ptr(page: Page, sel: string, type: string, id: number, x: number, y: number) {
  await page.evaluate(({ sel, type, id, x, y }) => {
    const el = document.querySelector(sel)!;
    el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { sel, type, id, x, y });
}
const held = (page: Page, a: string) => page.evaluate(a => (window as any).__game.input.held(a), a);

test('touch controls: layout, targets, multi-touch, menus', async ({ page }) => {
  const p = watch(page);
  await boot(page, '&touch=1');
  await step(page, 0.5);
  await page.evaluate(() => (window as any).__game.frame(1 / 30, true));
  await expect(page.locator('.ma-touch.is-on')).toBeVisible();
  await expect(page.locator('.ma-root.has-touch')).toHaveCount(1);

  // every button is a real hit target (>= 44 px) and inside the viewport / safe area
  const btns = await page.evaluate(() => [...document.querySelectorAll('.ma-touch-btn')].map(b => { const r = b.getBoundingClientRect(); return { id: (b as HTMLElement).dataset.touchBtn, w: r.width, h: r.height, x: r.x, y: r.y, r: r.right, b: r.bottom }; }));
  expect(btns.length).toBeGreaterThanOrEqual(10);
  for (const b of btns) {
    expect(b.w, b.id).toBeGreaterThanOrEqual(44); expect(b.h, b.id).toBeGreaterThanOrEqual(44);
    expect(b.x, b.id).toBeGreaterThanOrEqual(0); expect(b.y, b.id).toBeGreaterThanOrEqual(0); expect(b.r, b.id).toBeLessThanOrEqual(1180); expect(b.b, b.id).toBeLessThanOrEqual(820);
  }
  // the thumb cluster does not sit on the money / weapon block (top right) or the minimap (bottom left)
  const hudTr = await rect(page, '.ma-hud-tr'), radar = await rect(page, '.ma-radar');
  for (const b of btns.filter(b => !['pause', 'map'].includes(b.id!))) {
    expect(b.y >= hudTr.b - 2 || b.r <= hudTr.x, `${b.id} vs top-right HUD`).toBe(true);
    expect(b.x >= radar.r, `${b.id} vs minimap`).toBe(true);
  }
  // no accidental page scroll / zoom / selection
  const css = await page.evaluate(() => ({ ta: getComputedStyle(document.querySelector('.ma-touch-btn')!).touchAction, us: getComputedStyle(document.body).userSelect, ob: getComputedStyle(document.body).overscrollBehaviorY }));
  expect(css.ta).toBe('none'); expect(css.us).toBe('none'); expect(css.ob).toBe('none');
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('user-scalable=no');

  // multi-touch: stick (finger 1) + look drag (finger 2) + fire (finger 3) all at once
  const yaw0 = await page.evaluate(() => (window as any).__game.cam.yaw);
  await ptr(page, '.ma-touch-move', 'pointerdown', 1, 220, 600);
  await ptr(page, '.ma-touch-move', 'pointermove', 1, 220, 520); // pushed up = forward
  await ptr(page, '.ma-touch-look', 'pointerdown', 2, 700, 300);
  await ptr(page, '.ma-touch-look', 'pointermove', 2, 760, 300);
  await ptr(page, '[data-touch-btn=fire]', 'pointerdown', 3, 1050, 700);
  const mv = await page.evaluate(() => (window as any).__game.input.moveAxes());
  expect(mv.y).toBeGreaterThan(0.5);
  expect(await held(page, 'fire')).toBe(true);
  const look = await page.evaluate(() => (window as any).__game.input.lookDelta(0.016));
  expect(look.x).toBeGreaterThan(50);
  await ptr(page, '[data-touch-btn=fire]', 'pointerup', 3, 1050, 700);
  await ptr(page, '.ma-touch-look', 'pointerup', 2, 760, 300);
  await ptr(page, '.ma-touch-move', 'pointerup', 1, 220, 520);
  await step(page, 0.1);
  expect(await held(page, 'fire')).toBe(false);
  expect((await page.evaluate(() => (window as any).__game.input.moveAxes())).y).toBe(0);
  void yaw0;

  // a tap shorter than a frame still fires: held for that frame, justPressed seen
  await ptr(page, '[data-touch-btn=reload]', 'pointerdown', 4, 1000, 500);
  await ptr(page, '[data-touch-btn=reload]', 'pointerup', 4, 1000, 500);
  expect(await page.evaluate(() => { const i = (window as any).__game.input; return [i.held('reload'), i.justPressed('reload')]; })).toEqual([true, true]);
  await step(page, 0.1);
  expect(await held(page, 'reload')).toBe(false);

  // aim is a toggle, sprint button latches
  await ptr(page, '[data-touch-btn=aim]', 'pointerdown', 5, 1000, 500); await ptr(page, '[data-touch-btn=aim]', 'pointerup', 5, 1000, 500);
  expect(await held(page, 'aim')).toBe(true);
  await step(page, 0.1);
  expect(await held(page, 'aim')).toBe(true); // latched across frames
  await ptr(page, '[data-touch-btn=aim]', 'pointerdown', 5, 1000, 500); await ptr(page, '[data-touch-btn=aim]', 'pointerup', 5, 1000, 500);
  await step(page, 0.1);
  expect(await held(page, 'aim')).toBe(false);

  await page.screenshot({ path: 'test-results/touch-foot.png' });

  // pause button opens the pause menu; the controls hide and the menu is touch sized
  await page.touchscreen.tap(...(await centre(page, '[data-touch-btn=pause]')));
  await step(page, 0.2);
  await page.evaluate(() => (window as any).__game.frame(1 / 30, true));
  await expect(page.locator('.ma-touch.is-on')).toHaveCount(0);
  const items = await page.evaluate(() => [...document.querySelectorAll('.ma-pause [data-nav], .ma-layer.is-open [data-nav]')].map(b => b.getBoundingClientRect().height).filter(h => h > 0));
  expect(items.length).toBeGreaterThan(2);
  for (const hgt of items) expect(hgt).toBeGreaterThanOrEqual(43.5);
  expect(p.errors.filter(e => !/GPU|WebGL|swiftshader|Failed to load resource|network error/i.test(e))).toEqual([]);
});

test('touch controls: the CAR button gets in, the layout switches to pedals, EXIT gets out', async ({ page }) => {
  await boot(page, '&touch=1');
  await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-280, 0.25, -95.5, Math.PI / 2); const v = g.vehicles.spawn('sedan', -278, -97.5, Math.PI / 2); v.persistent = true; });
  await step(page, 0.3);
  await expect(page.locator('[data-touch-btn=fire]')).toBeVisible();
  await ptr(page, '[data-touch-btn=enter]', 'pointerdown', 6, 900, 700); await ptr(page, '[data-touch-btn=enter]', 'pointerup', 6, 900, 700);
  await step(page, 6);
  expect(await page.evaluate(() => !!(window as any).__game.playerVehicle)).toBe(true);
  await page.evaluate(() => (window as any).__game.frame(1 / 30, true));
  await expect(page.locator('[data-touch-btn=gas]')).toBeVisible();
  await expect(page.locator('[data-touch-btn=jump]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/touch-car.png' });
  // gas drives, the stick steers (x only), brake reverses the throttle
  await ptr(page, '[data-touch-btn=gas]', 'pointerdown', 7, 1000, 700);
  expect(await page.evaluate(() => (window as any).__game.input.throttle())).toBe(1);
  await step(page, 2);
  expect(await page.evaluate(() => (window as any).__game.playerVehicle.speed)).toBeGreaterThan(3);
  await ptr(page, '[data-touch-btn=gas]', 'pointerup', 7, 1000, 700);
  await ptr(page, '.ma-touch-move', 'pointerdown', 1, 200, 600); await ptr(page, '.ma-touch-move', 'pointermove', 1, 280, 560);
  const mv = await page.evaluate(() => (window as any).__game.input.moveAxes());
  expect(mv.x).toBeGreaterThan(0.5); expect(mv.y).toBe(0);
  await ptr(page, '.ma-touch-move', 'pointerup', 1, 280, 560);
  await ptr(page, '[data-touch-btn=brake]', 'pointerdown', 8, 900, 700);
  expect(await page.evaluate(() => (window as any).__game.input.throttle())).toBe(-1);
  await ptr(page, '[data-touch-btn=brake]', 'pointerup', 8, 900, 700);
});

test('touch controls fit an iPhone in landscape (844x390): targets >= 44 px, inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => { try { localStorage.setItem('meridian-afterglow.mobileOk', '1'); } catch { /* ignore */ } }); // past the phone page ("Continue")
  await boot(page, '&touch=1');
  await step(page, 0.3);
  await page.evaluate(() => (window as any).__game.frame(1 / 30, true));
  const btns = await page.evaluate(() => [...document.querySelectorAll('.ma-touch-btn')].map(b => { const r = b.getBoundingClientRect(); return { id: (b as HTMLElement).dataset.touchBtn, w: r.width, h: r.height, x: r.x, y: r.y, r: r.right, b: r.bottom }; }));
  expect(btns.length).toBeGreaterThanOrEqual(10);
  for (const b of btns) { expect(b.w, b.id).toBeGreaterThanOrEqual(44); expect(b.h, b.id).toBeGreaterThanOrEqual(44); expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0); expect(b.r).toBeLessThanOrEqual(844); expect(b.b).toBeLessThanOrEqual(390); }
  const hudTr = await rect(page, '.ma-hud-tr');
  for (const b of btns.filter(b => !['pause', 'map'].includes(b.id!))) expect(b.y >= hudTr.b - 2 || b.r <= hudTr.x, `${b.id} vs top-right HUD`).toBe(true);
  await page.screenshot({ path: 'test-results/touch-phone.png' });
});

async function centre(page: Page, sel: string): Promise<[number, number]> { const r = await rect(page, sel); return [r.x + r.w / 2, r.y + r.h / 2]; }
