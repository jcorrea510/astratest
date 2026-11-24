import { test, expect } from '@playwright/test';
import { boot } from './helpers';

/** Round 10 (owner): "the goals UI is broken. It looks weird, like all the text overlaps." */
test('goals panel: every row is as tall as its text, rows never overlap, the text gets the wide column', async ({ page }) => {
  test.setTimeout(300_000);
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
    await page.setViewportSize(size);
    await boot(page);
    const r = await page.evaluate(() => {
      const m = (window as any).__meridian, g = (window as any).__game;
      g.mode = 'regular'; m.ui.setMode('regular'); m.activities.openGoals();
      const rows = [...document.querySelectorAll<HTMLElement>('.ma-shop-item')];
      const panel = document.querySelector<HTMLElement>('.ma-shop-list')!.getBoundingClientRect();
      let overlap = 0, clipped = 0, narrow = 0;
      rows.forEach((row, i) => {
        const b = row.getBoundingClientRect(), text = row.querySelector<HTMLElement>('.ma-shop-text')!;
        if (i > 0 && b.top < rows[i - 1].getBoundingClientRect().bottom - 0.5) overlap++;
        if (text.scrollHeight > row.clientHeight + 1) clipped++;
        if (text.getBoundingClientRect().width < panel.width * 0.5) narrow++;
      });
      return { n: rows.length, overlap, clipped, narrow };
    });
    expect(r.n).toBeGreaterThan(4);
    expect(r).toMatchObject({ overlap: 0, clipped: 0, narrow: 0 });
  }
});
