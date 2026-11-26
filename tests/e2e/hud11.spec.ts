import { test, expect } from '@playwright/test';
import { boot } from './helpers';

/** Round 11 (owner: "the UIs are terrible"): the mission card, the death title and the toasts must actually be visible, and never collide. */
test('hud: mission card + death title are visible with text; toasts do not overlap the hint', async ({ page }) => {
  test.setTimeout(300_000);
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
    await page.setViewportSize(size);
    await boot(page);
    // mission card
    await page.evaluate(() => (window as any).__meridian.ui.missionCard('Bank job', 'Tellers first, then drill the vault.', 'start'));
    await page.waitForTimeout(900);
    const card = await page.evaluate(() => {
      const t = document.querySelector<HTMLElement>('.ma-card-title')!, r = t.getBoundingClientRect();
      const band = document.querySelector<HTMLElement>('.ma-card-band')!;
      let o = 1; for (let e: HTMLElement | null = t; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return { w: r.width, h: r.height, o, text: t.textContent, bandO: getComputedStyle(band).opacity };
    });
    expect(card.text).toBe('Bank job');
    expect(card.w).toBeGreaterThan(40); expect(card.h).toBeGreaterThan(20); expect(card.o).toBeGreaterThan(0.5);
    // toasts + hint never overlap
    await page.evaluate(() => {
      const u = (window as any).__meridian.ui;
      u.showControlsHint('WASD to move, mouse to look, Shift to sprint, Space to jump. Esc opens the pause menu: map, sandbox tools and saving.', 30);
      for (const [t, k] of [['Deposit box: $640 in jewelry and cash', 'money'], ['The guard drew on you!', 'warning'], ['Heat 3', 'heat'], ['Postcard 3 / 12 found', 'mission'], ['Saved', 'info']]) u.toast(t, k);
    });
    await page.waitForTimeout(500);
    const ov = await page.evaluate(() => {
      const hint = document.querySelector<HTMLElement>('.ma-hint')!.getBoundingClientRect();
      const toasts = [...document.querySelectorAll<HTMLElement>('.ma-toast:not(.is-leaving)')].map(e => e.getBoundingClientRect());
      const money = document.querySelector<HTMLElement>('.ma-money')!.getBoundingClientRect();
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return { n: toasts.length, hintW: hint.width, toastHint: toasts.some(t => hit(t, hint)), hintMoney: hit(hint, money), toastMoney: toasts.some(t => hit(t, money)) };
    });
    expect(ov.n).toBeLessThanOrEqual(4);
    expect(ov.hintW).toBeGreaterThan(100);
    expect(ov.toastHint).toBe(false); expect(ov.hintMoney).toBe(false); expect(ov.toastMoney).toBe(false);
    // death title
    for (const [kind, word] of [['down', 'Flatlined'], ['busted', 'Arrested']] as const) {
      await page.evaluate(([k]) => {
        const u = (window as any).__meridian.ui;
        u.showDeath(k, 'Medical bill -$250');
        for (let i = 0; i < 14; i++) u.advanceDeath(0.1);
      }, [kind]);
      await page.waitForTimeout(1000);
      const d = await page.evaluate(() => {
        const t = document.querySelector<HTMLElement>('.ma-death-word')!, r = t.getBoundingClientRect();
        let o = 1; for (let e: HTMLElement | null = t; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        const detail = document.querySelector<HTMLElement>('.ma-death-detail')!.getBoundingClientRect();
        return { w: r.width, h: r.height, o, text: t.textContent, dh: detail.height, fits: r.right <= innerWidth && r.left >= 0 };
      });
      expect(d.text).toBe(word);
      expect(d.w).toBeGreaterThan(100); expect(d.h).toBeGreaterThan(40); expect(d.o).toBeGreaterThan(0.5); expect(d.dh).toBeGreaterThan(10); expect(d.fits).toBe(true);
    }
  }
});

/** Round 11: at 960x540 the controls tip and the opening "Port Meridian" card overlapped; the tip steps aside for a card. */
test('hud: a showing mission card hides the controls tip (small window)', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 960, height: 540 });
  await boot(page);
  const r = await page.evaluate(async () => {
    const u = (window as any).__meridian.ui;
    u.showControlsHint('WASD to move, mouse to look, Shift to sprint, Space to jump. Esc opens the pause menu: map, sandbox tools (spawn cars, set the clock, wanted level, teleport) and saving.', 30);
    u.missionCard('Port Meridian', 'Golden hour. The city is yours.', 'start');
    await new Promise(res => setTimeout(res, 900));
    const hint = document.querySelector<HTMLElement>('.ma-hint')!, card = document.querySelector<HTMLElement>('.ma-card-title')!.getBoundingClientRect();
    const hr = hint.getBoundingClientRect(), overlap = hr.bottom > card.top && hr.top < card.bottom && hr.right > card.left && hr.left < card.right;
    const cs = getComputedStyle(hint);
    return { overlap, shown: Number(cs.opacity) > 0.1 && cs.visibility !== 'hidden' && cs.display !== 'none' };
  });
  expect(r.overlap && r.shown).toBe(false);
});
