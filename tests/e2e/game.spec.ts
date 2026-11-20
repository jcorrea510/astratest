import { test, expect } from '@playwright/test';
import { watch, boot, step, tap, state, clean, quietStreets } from './helpers';

test.describe.configure({ mode: 'serial' });

test('title: live city flyover, press any key, menu, credits, Play starts the sandbox with no story', async ({ page }) => {
  const p = watch(page);
  await page.goto('./');
  await expect(page.getByText('Press any key')).toBeVisible({ timeout: 180_000 });
  // the running game renders the city behind the title (no painted backdrop) and the camera follows the scripted flyover
  expect(await page.evaluate(() => document.querySelector('.ma-title')!.classList.contains('is-live'))).toBe(true);
  const cam0 = await page.evaluate(() => (window as any).__game.renderer.camera.position.toArray());
  await page.waitForTimeout(1500);
  const cam1 = await page.evaluate(() => (window as any).__game.renderer.camera.position.toArray());
  expect(cam1).not.toEqual(cam0);
  expect(await page.evaluate(() => (window as any).__game.player.human.root.visible)).toBe(false);
  await page.screenshot({ path: 'test-results/shots/title.png' });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();
  // no save: no Continue, no story entries
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await expect(page.getByText('New game')).toHaveCount(0);
  // keyboard navigation: down to Credits (Play, Highway, Settings, Controls, Fullscreen, Credits), open, back out with Esc
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ma-title-menu .ma-menu-item:focus')).toHaveText('Credits');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Open assets (CC0)')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Open assets (CC0)')).toBeHidden();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await page.waitForFunction(() => !!(window as any).__meridian?.activities, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__game.stop());
  await step(page, 1, { render: true });
  expect(await state<boolean>(page, '!window.__meridian.ui.isMenuOpen()')).toBe(true);
  expect(await state<number>(page, 'window.__game.money')).toBe(2500);
  expect(await state<boolean>(page, 'window.__game.player.human.root.visible && !window.__game.ghost')).toBe(true);
  expect(await state<boolean>(page, 'window.__game.pcombat.inv.weapons.pistol.owned')).toBe(true);
  expect(await state<unknown>(page, 'window.__meridian.missions')).toBeUndefined();
  // map / minimap: shops, garage, safehouse and the rest, but no mission markers
  const kinds = await state<string[]>(page, '[...new Set(window.__meridian.activities.blips().map(b => b.kind))]');
  expect(kinds).toContain('safehouse');
  expect(kinds).not.toContain('mission');
  await page.screenshot({ path: 'test-results/shots/hud.png' });
  clean(p);
});

test('walk, sprint, jump, roll; take a car, drive, handbrake, crash and get out', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const start = await state<{ x: number; z: number }>(page, '({x: window.__game.player.pos.x, z: window.__game.player.pos.z})');
  await step(page, 2, { hold: ['KeyW'] });
  await step(page, 1.5, { hold: ['KeyW', 'ShiftLeft'] });
  const moved = await state<{ x: number; z: number }>(page, '({x: window.__game.player.pos.x, z: window.__game.player.pos.z})');
  expect(Math.hypot(moved.x - start.x, moved.z - start.z)).toBeGreaterThan(8);
  await tap(page, 'Space'); await step(page, 1);
  await tap(page, 'KeyC'); await step(page, 1);
  expect(await state<boolean>(page, 'window.__game.player.alive')).toBe(true);
  // Spawn a car beside the player and get in with F (on a quiet street so the timing checks are deterministic)
  await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; const p = g.player.pos; g.player.place(-280, 0.25, -95.5, Math.PI / 2); g.vehicles.spawn('sedan', -278, -97.5, Math.PI / 2).persistent = true; void p; });
  await step(page, 0.5);
  await tap(page, 'KeyF'); await page.evaluate(() => { const g = (window as any).__game; for (let i = 0; i < 400 && !g.playerVehicle; i++) g.frame(1 / 30, false); for (let i = 0; i < 30; i++) g.frame(1 / 30, false); });
  expect(await state<boolean>(page, '!!window.__game.playerVehicle')).toBe(true);
  await step(page, 3, { hold: ['KeyW'] });
  const v = await state<number>(page, 'window.__game.playerVehicle.speed');
  expect(v).toBeGreaterThan(10);
  await step(page, 1, { hold: ['KeyW', 'KeyA', 'Space'] });
  // Crash: aim at a building and accelerate
  await page.evaluate(() => { const g = (window as any).__game; g.playerVehicle.phys.teleport(-470, 0.6, -102, Math.PI / 2); });
  await page.evaluate(() => { (window as any).__cv = (window as any).__game.playerVehicle; });
  const hp0 = await state<number>(page, 'window.__cv.health');
  await step(page, 5, { hold: ['KeyW'] });
  const hp1 = await state<number>(page, 'window.__cv.health');
  expect(hp1).toBeLessThan(hp0);
  await step(page, 1, { render: true });
  await page.screenshot({ path: 'test-results/shots/crash.png' });
  await tap(page, 'KeyF'); await step(page, 1);
  expect(await state<boolean>(page, '!window.__game.playerVehicle')).toBe(true);
  clean(p);
});

test('shoot, punch, inventory wheel, heat gain and loss', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  // regression: game time never runs backwards (a negative first frame delta once froze weapon cooldowns)
  expect(await state<number>(page, 'window.__game.time')).toBeGreaterThanOrEqual(0);
  // punch a civilian standing in front
  await page.evaluate(() => { const g = (window as any).__game; const n = g.pop.spawn('civilian', g.player.pos.x + Math.sin(g.player.yaw) * 1.2, g.player.pos.z + Math.cos(g.player.yaw) * 1.2); n.persistent = true; n.brain = 'idle'; (window as any).__victim = n; g.cam.yaw = g.player.yaw + Math.PI; });
  await tap(page, 'Mouse0'); await step(page, 0.6);
  expect(await state<number>(page, 'window.__victim.char.health')).toBeLessThan(100);
  expect(await state<number>(page, 'window.__game.police.heat')).toBeGreaterThanOrEqual(1);
  // weapons via the wheel (hold Tab, flick the mouse, release)
  await page.evaluate(() => { const g = (window as any).__game; g.pcombat.give('pistol', 48); g.pcombat.give('shotgun', 12); });
  await page.evaluate(() => { (window as any).__game.input.press('Tab'); });
  await step(page, 0.2);
  expect(await state<boolean>(page, 'window.__game.wheelOpen')).toBe(true);
  expect(await state<number>(page, 'window.__game.timeScale')).toBeLessThan(0.6);
  for (let i = 0; i < 6; i++) await page.evaluate(() => { const g = (window as any).__game; g.input.mouseDX = 40; g.input.mouseDY = -5; g.frame(1 / 30, false); });
  await page.evaluate(() => { (window as any).__game.input.release('Tab'); });
  await step(page, 0.3);
  expect(await state<boolean>(page, 'window.__game.wheelOpen')).toBe(false);
  await page.evaluate(() => (window as any).__game.pcombat.inv.select('pistol'));
  await step(page, 0.4);
  const clip = await state<number>(page, 'window.__game.pcombat.inv.state.clip');
  await page.evaluate(() => { (window as any).__game.input.press('Mouse2'); });
  await step(page, 0.3);
  await tap(page, 'Mouse0'); await step(page, 0.3); await tap(page, 'Mouse0'); await step(page, 0.3);
  await page.evaluate(() => { (window as any).__game.input.release('Mouse2'); });
  expect(await state<number>(page, 'window.__game.pcombat.inv.state.clip')).toBe(clip - 2);
  await tap(page, 'KeyR'); await step(page, 1.6);
  expect(await state<number>(page, 'window.__game.pcombat.inv.state.clip')).toBe(15); // Kestrel P9 magazine
  // escalate and then lose the heat by getting far away and out of sight
  await page.evaluate(() => { const g = (window as any).__game; g.police.report('kill', g.player.pos); });
  expect(await state<number>(page, 'window.__game.police.heat')).toBeGreaterThanOrEqual(2);
  await step(page, 12);
  await step(page, 0.1, { render: true });
  await page.screenshot({ path: 'test-results/shots/heat.png' });
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-430, 0.3, -380, 0); });
  let heat = 5;
  for (let i = 0; i < 20 && heat > 0; i++) { await step(page, 4); heat = await state<number>(page, 'window.__game.police.heat'); if (heat > 0) await page.evaluate(() => { const g = (window as any).__game; const far = [[-430, -380], [440, -380], [-430, 380]][Math.floor(Math.random() * 3)]; if (g.player.alive && g.deathT < 0) g.player.place(far[0], 0.3, far[1], 0); }); }
  expect(heat).toBe(0);
  clean(p);
});

test('WASTED: slow motion, grey, card, hospital bill, respawn at the clinic; ARRESTED waits for the arrest animation hook, then the police station', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.money = 1000; g.player.damage(500, null, g.time); g.playerDown('down'); });
  await step(page, 0.5);
  expect(await state<number>(page, 'window.__game.targetTimeScale')).toBeLessThan(0.5);
  await step(page, 1.2, { render: true });
  await expect(page.locator('.ma-death-word')).toHaveText('Wasted');
  await expect(page.locator('.ma-death.is-card')).toBeVisible();
  expect(await state<number>(page, 'window.__game.renderer.grade.uniforms.uSat.value')).toBeLessThan(0.3);
  expect(await state<number>(page, 'window.__game.money')).toBe(900);
  await page.screenshot({ path: 'test-results/shots/wasted.png' });
  await step(page, 5);
  expect(await state<boolean>(page, 'window.__game.player.alive')).toBe(true);
  expect(await state<number>(page, 'window.__game.deathT')).toBe(-1);
  expect(await state<number>(page, 'window.__game.player.health')).toBe(100);
  expect(await state<number>(page, 'window.__game.renderer.grade.uniforms.uSat.value')).toBeGreaterThan(1);
  expect(await state<number>(page, 'window.__game.timeScale')).toBe(1);
  // arrest with a handcuff-animation hook: nothing is shown until the hook calls back
  await page.evaluate(() => { const g = (window as any).__game; g.events.arrestAnimationDone = (done: () => void) => { (window as any).__cuffed = done; }; g.playerDown('busted'); });
  await step(page, 3);
  expect(await state<number>(page, 'window.__game.deathT')).toBeGreaterThan(2);
  await expect(page.locator('.ma-death.is-card')).toHaveCount(0);
  await page.evaluate(() => (window as any).__cuffed());
  await step(page, 1.5, { render: true });
  await expect(page.locator('.ma-death-word')).toHaveText('Arrested');
  await page.screenshot({ path: 'test-results/shots/arrested.png' });
  await step(page, 5);
  expect(await state<number>(page, 'window.__game.deathT')).toBe(-1);
  expect(await state<number>(page, 'Math.round(window.__game.player.pos.x)')).toBe(40);
  clean(p);
});

test('sandbox save from the pause menu, reload and continue (position, cash, guns, tools, time); settings persist', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game, M = (window as any).__meridian; g.money = 4321; g.hour = 21.5; g.pcombat.give('smg', 60); g.player.place(0, 0.3, 0, 0); M.sandbox.act('god', true); M.activities.found.add(2); });
  await step(page, 0.3);
  // pause opens on the map; the Quit tab has Save game
  await page.evaluate(() => (window as any).__meridian.pause());
  await expect(page.locator('.ma-ptab.is-selected')).toHaveText('Map');
  await page.locator('.ma-ptab', { hasText: 'Quit' }).click();
  await page.getByRole('button', { name: 'Save game' }).click();
  await expect(page.getByText('Game saved')).toBeVisible();
  const cash = await state<number>(page, 'window.__game.money'); // 4321, plus $100 if a postcard was on that corner
  expect(cash).toBeGreaterThanOrEqual(4321);
  await page.evaluate(() => { const m = (window as any).__meridian; m.settings.sensitivity = 1.7; m.settings.quality = 'low'; localStorage.setItem('meridian-afterglow.settings.v1', JSON.stringify(m.settings)); });
  await page.goto('./');
  await expect(page.getByText('Press any key')).toBeVisible({ timeout: 180_000 });
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!(window as any).__meridian?.activities, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__game.stop());
  expect(await state<number>(page, 'window.__meridian.read().money')).toBe(cash);
  expect(await state<number>(page, 'window.__game.money')).toBeGreaterThanOrEqual(cash);
  expect(await state<boolean>(page, 'window.__game.pcombat.inv.weapons.smg.owned')).toBe(true);
  expect(await state<number>(page, 'Math.round(window.__game.hour * 2) / 2')).toBe(21.5);
  expect(await state<number>(page, 'Math.hypot(window.__game.player.pos.x, window.__game.player.pos.z)')).toBeLessThan(4);
  expect(await state<boolean>(page, 'window.__meridian.sandbox.god')).toBe(true);
  expect(await state<boolean>(page, 'window.__meridian.activities.found.has(2)')).toBe(true);
  expect(await state<number>(page, 'window.__meridian.settings.sensitivity')).toBeCloseTo(1.7);
  expect(await state<string>(page, 'window.__game.renderer.qualityName')).toBe('low');
  clean(p);
});

test('phones get a clean desktop-only screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const p = watch(page);
  await page.goto('./');
  await expect(page.getByText(/computer/i).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/mobile.png' });
  clean(p);
  await ctx.close();
});
