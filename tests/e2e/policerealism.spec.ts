import { test, expect, type Page } from '@playwright/test';
import { boot, step, quietStreets, watch, clean } from './helpers';

const civ = (page: Page) => page.evaluate(() => {
  const g = (window as any).__game, p = g.player.pos;
  const n = g.pop.spawn('civilian', p.x + 6, p.z, p.y);
  n.brain = 'idle'; n.persistent = true; return true;
});
const heatOf = (page: Page) => page.evaluate(() => (window as any).__game.police.heat as number);

test.describe('police realism', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await quietStreets(page); await page.evaluate(() => { (window as any).__game.hour = 14; }); });

  test('a crime without witnesses raises no heat', async ({ page }) => {
    const p = watch(page);
    // store clerks/shoppers behind the nearby shop windows are valid witnesses; this test wants an empty street
    await page.evaluate(() => { const g = (window as any).__game; for (const n of [...g.pop.npcs]) if (n.tag === 'shopper' || n.tag === 'clerk') g.pop.remove(n); g.police.report('assault', g.player.pos); });
    await step(page, 10);
    expect(await heatOf(page)).toBe(0);
    clean(p);
  });

  test('witness calls 911 after a few seconds; first unit needs >= 15 s and starts far away', async ({ page }) => {
    const p = watch(page);
    await civ(page);
    await step(page, 1);
    await page.evaluate(() => { const g = (window as any).__game; g.police.report('assault', g.player.pos); });
    expect(await heatOf(page)).toBe(0); // nobody has called yet
    await step(page, 2);
    expect(await heatOf(page)).toBe(0);
    await step(page, 5);
    expect(await heatOf(page)).toBe(1);
    // call went out at 3-6 s; no unit may exist 15 s after the crime
    await step(page, 7);
    expect(await page.evaluate(() => (window as any).__game.police.units.length)).toBe(0);
    await step(page, 10);
    const d = await page.evaluate(() => { const g = (window as any).__game; const u = g.police.units[0]; return u ? u.v.position.distanceTo(g.player.pos) : -1; });
    expect(d).toBeGreaterThan(30);
    clean(p);
  });

  test('killing the only witness cancels the call', async ({ page }) => {
    await civ(page);
    await page.evaluate(() => { const g = (window as any).__game; g.police.report('assault', g.player.pos); for (const n of g.pop.npcs) if (n.role === 'civilian') n.char.damage(999, null, 0); });
    await step(page, 10);
    expect(await heatOf(page)).toBe(0);
  });

  test('army convoy leaves Fort Calder', async ({ page }) => {
    const p = watch(page);
    const r = await page.evaluate(() => {
      const g = (window as any).__game; g.pcombat.give('pistol', 30); g.pcombat.inv.select('pistol'); // armed: no arrest scene
      g.police.setHeat(5, g.player.pos);
      for (let i = 0; i < 40 * 8; i++) g.frame(1 / 30, false);
      const d = g.police.dispatch; const a = g.police.units.find((u: any) => d.kindOf(u) === 'army');
      const t = g.police.units.find((u: any) => d.kindOf(u) === 'tank');
      const pos = (u: any) => u ? { x: u.v.position.x, z: u.v.position.z } : null;
      return { army: pos(a), tank: pos(t), start: { x: g.player.pos.x, z: g.player.pos.z } };
    });
    expect(r.army).not.toBeNull();
    // 8 s after the order the convoy has barely left the east gate (735, -650) and is rolling down the access road (x ~760), nowhere near the player
    expect(Math.hypot(r.army!.x - 760, r.army!.z + 650)).toBeLessThan(160);
    expect(Math.hypot(r.army!.x - r.start.x, r.army!.z - r.start.z)).toBeGreaterThan(400);
    clean(p);
  });

  test('perf: 4-star firefight with 22 cops stays within 1.8x idle frame time', async ({ page }) => {
    test.setTimeout(300_000);
    const r = await page.evaluate(() => {
      const g = (window as any).__game, p = g.player.pos;
      const run = (n: number) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { g.player.health = g.player.maxHealth; g.frame(1 / 60, false); } return (performance.now() - t0) / n; };
      run(60); const idle = run(240);
      g.police.setHeat(4, p);
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2, r = 14 + (i % 4) * 6;
        const n = g.pop.spawn('police', p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, p.y);
        g.police.dispatch.gear(n, 'police', 4); g.police.dispatch.arm(n, 'police', 4, true); g.police.foot.push(n);
      }
      const spawned = g.pop.npcs.length;
      const trace: string[] = [];
      run(120); const fight = (() => { let tot = 0; for (let k = 0; k < 8; k++) { tot += run(60); trace.push(`${k}:h${g.police.heat}:c${g.pop.npcs.filter((n: any) => n.role === 'police').length}:u${g.police.units.length}`); } return tot / 8; })();
      const cops = g.pop.npcs.filter((n: any) => n.role === 'police');
      return { trace: trace.join(' '), idle, fight, npcs: g.pop.npcs.length, spawned, alive: cops.filter((n: any) => n.alive).length, brains: [...new Set(cops.map((n: any) => n.brain))].join(','), playerAlive: g.player.alive, heat: g.police.heat };
    });
    console.log('PERF idle ms', r.idle.toFixed(2), 'fight ms', r.fight.toFixed(2), 'ratio', (r.fight / r.idle).toFixed(2), JSON.stringify(r));
    expect(r.fight).toBeLessThan(r.idle * 1.8 + 1);
  });
});
