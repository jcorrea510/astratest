import { test } from '@playwright/test';
import { boot } from './helpers';
test('probe', async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page);
  const r = await page.evaluate(() => { const g = (window as any).__game; const ls = g.city.lanes.filter((l: any) => !l.connector && l.length > 100); return { n: g.city.lanes.length, long: ls.length, sample: ls.slice(0, 3).map((l: any) => ({ len: l.length, np: l.points.length, lane: l.lane, ys: !!l.ys, p0: l.points[0], pN: l.points[l.points.length - 1] })) }; });
  console.log(JSON.stringify(r));
});
