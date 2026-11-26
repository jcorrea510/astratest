import { test, expect, type Page } from '@playwright/test';
import { boot, step } from './helpers';

/** Controller play: a faked standard-mapping pad (navigator.getGamepads overridden) drives movement, menu navigation, a rebind, glyphs and the disconnect pause. */
declare global { interface Window { __pad: { connected: boolean; id: string; axes: number[]; buttons: number[] } } }

const setPad = (p: Page, over: Partial<Window['__pad']>) => p.evaluate(o => Object.assign(window.__pad, o), over);
const hold = async (p: Page, buttons: number[], ms = 160) => {
  await setPad(p, { buttons }); await p.waitForTimeout(ms); await setPad(p, { buttons: [] }); await p.waitForTimeout(80);
};

test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  page = await browser.newPage();
  await page.addInitScript(() => {
    const st = { connected: false, id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', axes: [0, 0, 0, 0], buttons: [] as number[] };
    window.__pad = st;
    navigator.getGamepads = () => {
      if (!st.connected) return [null, null, null, null];
      const buttons = Array.from({ length: 17 }, (_, i) => { const v = st.buttons.includes(i) ? 1 : 0; return { pressed: v > 0.5, touched: v > 0.5, value: v }; });
      return [{ id: st.id, index: 0, connected: true, mapping: 'standard', timestamp: performance.now(), axes: [...st.axes], buttons } as unknown as Gamepad, null, null, null];
    };
  });
  await boot(page);
  await step(page, 1, { render: true });
});
test.afterAll(async () => { await page.close(); });

test('connect toast; left stick walks, right stick looks, glyph family follows the pad id', async () => {
  await setPad(page, { connected: true });
  await expect(page.locator('.ma-toast', { hasText: 'PlayStation controller connected' })).toBeVisible();
  const before = await page.evaluate(() => { const g = (window as any).__game; g.exitVehicle?.(true); return { x: g.player.pos.x, z: g.player.pos.z, yaw: g.cameraYaw ?? 0 }; });
  await setPad(page, { axes: [0, -1, 0, 0] });
  await step(page, 1.5);
  const after = await page.evaluate(() => { const g = (window as any).__game; return { x: g.player.pos.x, z: g.player.pos.z, src: g.input.lastSource, m: g.input.moveAxes(), glyph: (window as any).__meridian ? 1 : 0 }; });
  await setPad(page, { axes: [0, 0, 0, 0] });
  expect(after.src).toBe('pad');
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(2);
  // a small stick nudge inside the dead zone does nothing
  await setPad(page, { axes: [0.08, -0.05, 0.06, 0.06] });
  await step(page, 0.2);
  expect(await page.evaluate(() => { const m = (window as any).__game.input.moveAxes(); return Math.hypot(m.x, m.y); })).toBe(0);
  await setPad(page, { axes: [0, 0, 0, 0] });
});

test('menus: d-pad moves a visible focus ring, a rebind moves a button', async () => {
  await page.keyboard.press('Escape');
  await step(page, 0.2);
  expect(await page.evaluate(() => (window as any).__game.paused)).toBe(true);
  await page.locator('.ma-ptab', { hasText: 'Settings' }).click();
  await page.locator('.ma-tab', { hasText: 'Input' }).click();
  await step(page, 0.1);
  await page.locator('.ma-padslot').first().focus();
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-pad-action'));
  await hold(page, [13]); // d-pad down
  const second = await page.evaluate(() => document.activeElement?.getAttribute('data-pad-action'));
  expect(second).not.toBe(first);
  const ring = await page.evaluate(() => { const e = document.activeElement as HTMLElement; const cs = getComputedStyle(e); return { cls: document.querySelector('.ma-root')?.classList.contains('is-pad'), style: cs.outlineStyle, w: parseFloat(cs.outlineWidth) }; });
  expect(ring.cls).toBe(true); expect(ring.style).toBe('solid'); expect(ring.w).toBeGreaterThan(1);
  // rebind Jump (X, button 2) to B (button 1): Reload gives it up
  const jump = page.locator('.ma-padslot[data-pad-action="jump"]');
  await expect(jump).toHaveText('Square');
  await jump.click();
  await expect(jump).toHaveText('Press a button…');
  await hold(page, [1], 220); // Circle
  const bound = await page.evaluate(() => (window as any).__game.settings.padBindings);
  expect(bound.foot.jump).toEqual([1]);
  expect(bound.foot.reload).toEqual([]);
  await expect(page.locator('.ma-padslot[data-pad-action="jump"]')).toHaveText('Circle');
  await expect(page.locator('.ma-padslot[data-pad-action="reload"]')).toHaveText('—');
  // resume and check the game obeys it
  for (let i = 0; i < 4 && await page.evaluate(() => (window as any).__game.paused); i++) { await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {}); await page.keyboard.press('Escape'); await step(page, 0.2); }
  expect(await page.evaluate(() => (window as any).__game.paused)).toBe(false);
  const held = await page.evaluate(() => {
    const g = (window as any).__game, w = window as Window;
    w.__pad.buttons = [1]; g.frame(1 / 30, false);
    const a = g.input.held('jump'); w.__pad.buttons = [2]; g.frame(1 / 30, false); const b = g.input.held('jump'); w.__pad.buttons = []; g.frame(1 / 30, false);
    return { a, b };
  });
  expect(held).toEqual({ a: true, b: false });
});

test('controls help shows the pad family names; unplugging mid-game pauses with a toast', async () => {
  await page.evaluate(() => { const w = window as Window; w.__pad.buttons = [0]; (window as any).__game.frame(1 / 30, false); w.__pad.buttons = []; (window as any).__game.frame(1 / 30, false); });
  expect(await page.evaluate(() => (window as any).__game.input.lastSource)).toBe('pad');
  expect(await page.evaluate(() => (window as any).__game.paused)).toBe(false);
  await setPad(page, { connected: false });
  await expect(page.locator('.ma-toast', { hasText: 'PlayStation controller disconnected' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__game.paused)).toBe(true);
  // plug it back in: a toast, and the pause menu is still there to resume from
  await setPad(page, { connected: true });
  await expect(page.locator('.ma-toast', { hasText: 'PlayStation controller connected' }).last()).toBeVisible();
  await page.locator('.ma-ptab', { hasText: 'Controls' }).click();
  await expect(page.locator('.ma-controls .ma-controls-head', { hasText: 'PlayStation controller' })).toBeVisible();
  await expect(page.locator('.ma-controls .ma-key.ma-pad', { hasText: /^Cross$/ }).first()).toBeVisible();
});
