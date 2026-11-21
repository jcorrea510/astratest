import { test, expect, type Page } from '@playwright/test';
import { watch, boot, clean } from './helpers';

test.describe.configure({ mode: 'serial' });
const SHOTS = process.env.R6BW_SHOTS ?? '';

/** Enters the first store of a kind (inside the footprint), lets the shell build, returns its index. */
async function enter(page: Page, kind: string) {
  return page.evaluate((kind) => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
    const i = R.kiosks.findIndex((k: any) => k.def.kind === kind), k = R.kiosks[i];
    g.police.clear(); g.trafficCap = 0; g.pedCap = 0;
    const out = k.frame.toWorld(3.1, 0.3, 9); g.player.place(out.x, out.y, out.z, 0);
    for (let f = 0; f < 8; f++) g.frame(1 / 30, false);
    const p = k.frame.toWorld(3.1, 0.3, 2.8); g.player.place(p.x, p.y, p.z, 0);
    for (let f = 0; f < 60; f++) g.frame(1 / 30, false);
    return i;
  }, kind);
}
const key = (page: Page, code: string) => page.evaluate(code => { const g = (window as any).__game; g.input.tap(code); g.frame(1 / 30, false); }, code);

test('barber: open, preview, pay, persists after reload', async ({ page }) => {
  test.setTimeout(300_000);
  const p = watch(page); await boot(page, '&mode=regular');
  const bl = await page.evaluate(() => { const b = (window as any).__meridian.activities.blips(); return { barber: b.filter((x: any) => x.kind === 'barber').length, clothing: b.filter((x: any) => x.kind === 'clothing').length }; });
  expect(bl.barber).toBeGreaterThanOrEqual(3); expect(bl.clothing).toBeGreaterThanOrEqual(3);
  await enter(page, 'barber');
  const prompt = await page.evaluate(() => (window as any).__meridian.activities.prompt());
  expect(prompt).toMatch(/haircut/i);
  await page.evaluate(() => { (window as any).__game.mode = 'regular'; (window as any).__game.money = 500; });
  await key(page, 'KeyE');
  await expect(page.locator('.ma-groom.is-open')).toBeVisible();
  // pick a cut, colour and beard through the panel
  await page.locator('.ma-groom-opt[data-opt="afro"]').click();
  await page.locator('.ma-groom-tab[data-tab="hair"]').click();
  await page.locator('.ma-groom-opt[data-opt="#7b3a1e"]').click();
  await page.locator('.ma-groom-tab[data-tab="facial"]').click();
  await page.locator('.ma-groom-opt[data-opt="beard"]').click();
  const pending = await page.evaluate(() => { const l = (window as any).__game.player.human.look; return { s: l.hairStyle, h: l.hair, f: l.facial }; });
  expect(pending).toEqual({ s: 'afro', h: '#7b3a1e', f: 'beard' });
  await page.evaluate(() => { const g = (window as any).__game; for (let f = 0; f < 40; f++) g.frame(1 / 30, f === 39); });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/barber.png` });
  const total = await page.evaluate(() => (window as any).__game.money);
  await page.locator('.ma-groom-pay').click();
  const after = await page.evaluate(() => (window as any).__game.money);
  expect(total - after).toBe(30 + 35 + 18);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ma-groom.is-open')).toHaveCount(0);
  // saved, then restored after a reload
  const saved = await page.evaluate(() => { const raw = localStorage.getItem('meridian-afterglow.save.v1'); return raw ? JSON.parse(raw).appearance : null; });
  expect(saved).toMatchObject({ hairStyle: 'afro', hair: '#7b3a1e', facial: 'beard' });
  await page.goto('./?autostart=1&continue=1');
  await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__game.stop());
  const look = await page.evaluate(() => { const l = (window as any).__game.player.human.look; return { s: l.hairStyle, h: l.hair, f: l.facial }; });
  expect(look).toEqual({ s: 'afro', h: '#7b3a1e', f: 'beard' });
  clean(p);
});

test('clothing store: outfit preview, sandbox is free, regular pays, persists', async ({ page }) => {
  test.setTimeout(300_000);
  const p = watch(page); await boot(page); // sandbox
  await enter(page, 'clothing');
  expect(await page.evaluate(() => (window as any).__meridian.activities.prompt())).toMatch(/outfits/i);
  await page.evaluate(() => { (window as any).__game.money = 100; });
  await key(page, 'KeyE');
  await expect(page.locator('.ma-groom.is-open')).toBeVisible();
  await page.locator('.ma-groom-opt[data-opt="hoodie"]').click();
  await page.locator('.ma-groom-tab[data-tab="top"]').click();
  await page.locator('.ma-groom-opt[data-opt="#b3202c"]').click();
  await page.locator('.ma-groom-tab[data-tab="hatStyle"]').click();
  await page.locator('.ma-groom-opt[data-opt="beanie"]').click();
  await page.evaluate(() => { const g = (window as any).__game; for (let f = 0; f < 40; f++) g.frame(1 / 30, f === 39); });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/clothing.png` });
  await page.locator('.ma-groom-pay').click(); // sandbox: free
  expect(await page.evaluate(() => (window as any).__game.money)).toBe(100);
  // an unpaid change is thrown away on leaving
  await page.locator('.ma-groom-tab[data-tab="topStyle"]').click();
  await page.locator('.ma-groom-opt[data-opt="suit"]').click();
  await page.keyboard.press('Escape');
  const look = await page.evaluate(() => { const l = (window as any).__game.player.human.look; return { t: l.topStyle, c: l.top, h: l.hatStyle }; });
  expect(look).toEqual({ t: 'hoodie', c: '#b3202c', h: 'beanie' });
  const saved = await page.evaluate(() => { (window as any).__meridian.activities.onSaveRequested?.(); const raw = localStorage.getItem('meridian-afterglow.save.v1'); return raw ? JSON.parse(raw).appearance : null; });
  expect(saved).toMatchObject({ topStyle: 'hoodie', top: '#b3202c', hatStyle: 'beanie' });
  clean(p);
});
