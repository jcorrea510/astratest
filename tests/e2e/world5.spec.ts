import { test, expect } from '@playwright/test';
import { boot, quietStreets, step, watch, clean } from './helpers';

// Round 5 world fixes: signals, precinct, East River bridges, near plane while flying over roofs.
test('world r5: precinct + signals + bridges exist, near plane grows with altitude', async ({ page }) => {
  test.setTimeout(400_000);
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const pads = g.visuals.helipads.map((h: any) => h.name);
    const lensCount = g.visuals.signalLamps.count;
    const bridges = g.city.paths.filter((q: any) => /Bridge/.test(q.name)).length;
    return { pads, lensCount, bridges, heads: g.visuals.signalHeads.length };
  });
  expect(r.pads).toContain('Metro Police roof helipad');
  expect(r.heads).toBeGreaterThan(100);
  expect(r.lensCount).toBe(r.heads * 3);
  expect(r.bridges).toBeGreaterThanOrEqual(2);
  // at the top of a bridge tower and over roofs the camera near plane moves out; at street level it returns
  const near = await page.evaluate(() => {
    const g = (window as any).__game; const out: number[] = [];
    for (const y of [0.3, 150, 0.3]) { g.player.place(0, y, 60, 0); g.frame(1 / 60, true); out.push(g.renderer.camera.near); }
    return out;
  });
  expect(near[1]).toBeGreaterThan(1);
  expect(near[0]).toBeLessThan(0.3);
  await step(page, 0.5);
  clean(p);
});
