import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 7 (owner): aiming with a Mac trackpad could not move the aim; in a car, Tab should open the gun wheel and aiming should draw the last gun. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await browser.newPage(); await boot(page); await quietStreets(page); });
test.afterAll(async () => { await page.close(); });

test('click-to-aim latches aim; a trackpad swipe moves the aim while aiming', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game, inp = g.input, cv = g.renderer.renderer.domElement;
    g.settings.aimToggle = true; inp.locked = true; inp.lastSource = 'kbm';
    const click = (t: string) => window.dispatchEvent(Object.assign(new MouseEvent(t, { button: 2, bubbles: true }), {}));
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true })); click('mouseup');
    const latched = inp.held('aim');
    inp.mouseDX = 0; window.dispatchEvent(new WheelEvent('wheel', { deltaX: 12.5, deltaY: 3.25, deltaMode: 0 }));
    const look = inp.mouseDX;
    cv.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true })); click('mouseup');
    const off = !inp.held('aim');
    g.settings.aimToggle = false; inp.aimLatch = false;
    return { latched, look, off };
  });
  console.log('aim', JSON.stringify(r));
  expect(r.latched).toBe(true);
  expect(r.look).toBeGreaterThan(5);
  expect(r.off).toBe(true);
});

test('in a car: aiming with fists out draws the last gun; the wheel offers drive-by guns only', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game, M = (window as any).__meridian;
    g.pcombat.give('pistol', 30); g.pcombat.give('rpg', 2); g.pcombat.inv.select('pistol'); g.frame(1 / 30, false);
    g.pcombat.inv.select('fists');
    const car = g.vehicles.spawn('sedan', g.player.pos.x + 4, g.player.pos.z, 0, -1, 0.4); car.persistent = true;
    g.seatPlayer(car); for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
    g.input.press('Mouse2'); for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
    const drawn = g.pcombat.inv.current, aiming = g.pcombat.driveAim;
    g.input.release('Mouse2'); g.frame(1 / 30, false);
    const slots = M.wheelSlots ? M.wheelSlots() : null;
    return { drawn, aiming, heavy: slots ? slots.find((s: any) => s.id.endsWith('heavy'))?.enabled : null };
  });
  console.log('car', JSON.stringify(r));
  expect(r.drawn).toBe('pistol');
  expect(r.aiming).toBe(true);
  if (r.heavy !== null) expect(r.heavy).toBe(false);
});
