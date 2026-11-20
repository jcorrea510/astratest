import { test } from '@playwright/test';
import { boot } from './helpers';
test('inter', async ({ page }) => {
  await boot(page);
  const o = await page.evaluate(() => { const g = (window as any).__game; const I = g.city.intersections; const ls = g.city.lanes;
    const sig = I.filter((i: any) => i.signalized).length; 
    const approach = new Map<number, number>(); for (const l of ls) if (!l.connector) approach.set(l.intersection, (approach.get(l.intersection) ?? 0) + 1);
    const uns = I.filter((i: any) => !i.signalized && (approach.get(i.id) ?? 0) >= 3);
    const conn = ls.filter((l: any) => l.connector).length;
    return { total: I.length, sig, unsWithApproaches: uns.length, conn, lanesNonConn: ls.length - conn, sample: I[0], lane: Object.keys(ls.find((l: any) => !l.connector)), connSample: Object.keys(ls.find((l: any) => l.connector)), laneCountSample: [...approach.values()].slice(0, 30) }; });
  console.log('INTER' + JSON.stringify(o));
});
