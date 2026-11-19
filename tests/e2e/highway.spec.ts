import { test, expect, type Page } from '@playwright/test';
import { watch, boot } from './helpers';

type Hw = { stats(): any; step(dt: number): void; stop(): void; render(): void; override: any; player: any; traffic: any; setCamera(m: string): void; cameraMode: string; paused: boolean };
const hw = (page: Page) => page.evaluate(() => (window as any).__highway.stats());

test('US units: 12-hour clock with AM/PM and mph on the speedometer', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    return { clock: g.hudState(null, null).clock, unit: document.querySelector('.ma-speed-unit')?.textContent };
  });
  expect(r.clock).toMatch(/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/);
  expect(r.unit).toBe('mph');
});

test('fullscreen button + Alt+Enter call requestFullscreen; highway boots from the title and runs', async ({ page }) => {
  test.setTimeout(420_000);
  const prob = watch(page);
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).__title, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__title.game.stop()); // (the city flyover is slow in software GL; the menu works without it)
  await page.evaluate(() => { (window as any).__fsCalls = 0; Element.prototype.requestFullscreen = function () { (window as any).__fsCalls++; return Promise.resolve(); }; });
  await page.keyboard.press('Space'); // press any key -> menu
  await page.locator('[data-item="fullscreen"]:visible').click();
  expect(await page.evaluate(() => (window as any).__fsCalls)).toBe(1);
  await page.keyboard.press('Alt+Enter');
  expect(await page.evaluate(() => (window as any).__fsCalls)).toBe(2);

  // Highway entry on the title menu -> setup screen -> run
  await page.locator('[data-item="highway"]:visible').click();
  await expect(page.locator('#hw-menu')).toBeVisible();
  await page.locator('#hw-cars button', { hasText: 'Vantor 360 GT' }).dispatchEvent('click'); // (dispatch: the city flyover behind the menu renders slowly in software GL, so Playwright's stability wait would stall)
  await page.locator('#hw-start').dispatchEvent('click');
  await page.waitForFunction(() => !!(window as any).__highway, null, { timeout: 120_000 });
  await page.evaluate(() => (window as any).__highway.stop());
  await expect(page.locator('#hw-fs')).toBeVisible();

  // 60 simulated seconds of driving a lane with the player invulnerable so the run is not cut short by a crash
  const res = await page.evaluate(() => {
    const h = (window as any).__highway as Hw;
    h.override = { throttle: 0.35 };
    const s0 = h.player.s;
    for (let i = 0; i < 60 * 30; i++) { h.step(1 / 30); h.player.health = 100; h.player.wrecked = false; }
    h.render();
    const log = h.traffic.lcLog as { signalLead: number }[];
    return { km: (h.player.s - s0) / 1000, st: h.stats(), lc: log.length, minLead: Math.min(...log.map(e => e.signalLead)), lanesMoved: new Set(h.traffic.npcs.map((n: any) => n.lane)).size };
  });
  expect(res.lc).toBeGreaterThan(5);
  expect(res.minLead).toBeGreaterThanOrEqual(0.3); // blinker on before any car moves over
  expect(res.st.npcs).toBeGreaterThan(35);
  expect(res.st.chunks).toBeLessThan(16); // road chunks are recycled, not accumulated
  expect(res.st.avgStepMs).toBeLessThan(4); // sim cost per frame (CPU budget)
  expect(res.st.calls).toBeLessThan(140); // draw calls
  expect(res.st.triangles).toBeLessThan(1_200_000);
  expect(res.km).toBeGreaterThan(0.5);

  // camera toggle (V) and pause menu (Esc)
  await page.evaluate(() => { (window as any).__highway.override = null; });
  await page.keyboard.press('KeyV');
  expect((await hw(page)).camera).toBe('first');
  await page.evaluate(() => (window as any).__highway.render());
  await page.screenshot({ path: 'docs/screenshots/highway-first.jpg', type: 'jpeg', quality: 70 });
  await page.keyboard.press('KeyV');
  expect((await hw(page)).camera).toBe('third');
  await page.evaluate(() => (window as any).__highway.render());
  await page.screenshot({ path: 'docs/screenshots/highway-third.jpg', type: 'jpeg', quality: 70 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#hw-resume')).toBeVisible();
  await page.locator('#hw-pause-fs').click();
  expect(await page.evaluate(() => (window as any).__fsCalls)).toBe(3);
  await page.locator('#hw-resume').click();
  expect(await page.evaluate(() => (window as any).__highway.paused)).toBe(false);
  expect(prob.errors.filter(e => !/GPU stall|swiftshader/i.test(e))).toEqual([]);
});

test('direct highway boot (no city): collisions wreck cars and hurt the player; a long run stays stable', async ({ page }) => {
  await page.goto('./?highway=1&car=sedan&time=night&traffic=1.5');
  await page.waitForFunction(() => !!(window as any).__highway, null, { timeout: 120_000 });
  const r = await page.evaluate(() => {
    const h = (window as any).__highway as Hw;
    h.stop(); h.override = { throttle: 1 };
    let crashed = 0; const mile0 = h.player.s;
    for (let i = 0; i < 3000 && !h.player.wrecked; i++) h.step(1 / 30);
    crashed = h.player.wrecked ? 1 : 0;
    const wrecks = h.traffic.npcs.filter((n: any) => n.state === 'wreck').length;
    return { crashed, wrecks, health: h.player.health, s: h.player.s - mile0, st: h.stats() };
  });
  expect(r.health).toBeLessThan(100); // flat-out into traffic hurts
  expect(r.st.chunks).toBeLessThan(16);
});
