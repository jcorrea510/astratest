import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { watch } from './helpers';

test('first paint: dark background, splash and noscript are inline in index.html', () => {
  const html = readFileSync('index.html', 'utf8');
  expect(html).toMatch(/<style id="ma-first-paint">[\s\S]*background:#061416/);
  expect(html).toContain('class="ma-splash"');
  expect(html).toMatch(/<noscript>[\s\S]*needs JavaScript/);
});

test('no WebGL 2: a graphics error screen with Retry (not the phone gate)', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('./');
  const panel = page.locator('.ma-boot-error[data-kind="no-webgl"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/graphics/i);
  await expect(panel.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Copy details' })).toBeVisible();
  await expect(panel.locator('.ma-boot-ver')).toHaveText(/^v\d/);
  await expect(page.getByText(/bigger screen|best on a computer/i)).toHaveCount(0);
  // Retry reloads the page (and fails the same way here, so the panel comes back)
  await Promise.all([page.waitForNavigation(), panel.getByRole('button', { name: 'Retry' }).click()]);
  await expect(page.locator('.ma-boot-error[data-kind="no-webgl"]')).toBeVisible();
});

for (const w of [390, 360]) {
  test(`phone gate fits at ${w}px, shows no URL and Continue anyway proceeds`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto('./?mobile=1');
    const gate = page.locator('.ma-mobile.is-open');
    await expect(gate).toBeVisible();
    await expect(gate).toContainText(/has touch controls/i); // Round 13 touch controls: the gate now says how to play on a phone
    await expect(gate).toContainText(/bigger screen/i);
    await expect(gate).not.toContainText(/mobile=1|localhost|http/i);
    const m = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const logo = r('.ma-logo-mobile'), box = r('.ma-mobile-box');
      return { logoR: logo.right, boxL: box.left, boxR: box.right, sw: document.documentElement.scrollWidth, iw: window.innerWidth };
    });
    expect(m.sw).toBeLessThanOrEqual(m.iw);
    expect(m.boxL).toBeGreaterThanOrEqual(0); expect(m.boxR).toBeLessThanOrEqual(m.iw);
    expect(m.logoR).toBeLessThanOrEqual(m.boxR);
    await gate.getByRole('button', { name: 'Continue anyway' }).click();
    await expect(page.locator('.ma-mobile.is-open')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('meridian-afterglow.mobileOk'))).toBe('1');
    await ctx.close();
  });
}

test('context loss pauses with a recovering overlay, then resumes; a looping crash shows the crash screen', async ({ page }) => {
  test.setTimeout(240_000);
  const p = watch(page);
  await page.goto('./?autostart=1');
  await page.waitForFunction(() => !!(window as unknown as { __meridian?: unknown }).__meridian, null, { timeout: 180_000 });
  await page.evaluate(() => {
    const gl = (document.getElementById('view') as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __ext: unknown }).__ext = ext;
    (ext as { loseContext(): void }).loseContext();
  });
  await expect(page.locator('.ma-boot-error[data-kind="context-lost"]')).toContainText(/recovering/i);
  await page.evaluate(() => (window as unknown as { __ext: { restoreContext(): void } }).__ext.restoreContext());
  await expect(page.locator('.ma-boot-error')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __game: { isRunning: boolean } }).__game.isRunning)).toBe(true);
  // a frame that throws every time: logged once, then the crash screen offers Retry
  await page.evaluate(() => { (window as unknown as { __game: { frame: () => void } }).__game.frame = () => { throw new Error('test crash'); }; });
  const crash = page.locator('.ma-boot-error[data-kind="crashed"]');
  await expect(crash).toBeVisible({ timeout: 30_000 });
  await expect(crash.getByRole('button', { name: 'Retry' })).toBeVisible();
  expect(p.errors.filter(e => e.includes('frame error')).length).toBe(1);
});
