import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

/** Overnight O2 (owner): people walk correctly (sidewalks, crosswalks), keep moving, and shop without piling up. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

test('2 min downtown: walkers stay off the roadway except at crossings, nobody freezes without a reason', async () => {
  test.setTimeout(900_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, P = g.pop;
    const I = g.city.intersections.find((i: any) => i.ix === 3 && i.iz === 4) ?? g.city.intersections[40];
    g.player.place(I.x + I.halfX + 4, 0.3, I.z + I.halfZ + 4, 0);
    for (let i = 0; i < 20 * 30; i++) g.frame(1 / 30, false);
    const still = new Map<any, number>(); let onRoad = 0, samples = 0, frozen = 0; const roadWhere: any[] = [];
    const nearX = (x: number, z: number) => g.city.intersections.some((q: any) => Math.abs(x - q.x) < q.halfX + 6.5 && Math.abs(z - q.z) < q.halfZ + 6.5);
    for (let f = 0; f < 120 * 30; f++) {
      g.frame(1 / 30, false);
      if (f % 15) continue;
      for (const n of P.npcs) {
        if (!n.alive || n.far || n.char.inVehicle || n.brain !== 'wander' || n.char.ragdoll || n.activity === 'taxi') continue; // (getting into a cab at the kerb)
        samples++;
        const surf = g.combat.groundSurface(n.pos.x, n.pos.z);
        if (surf === 'road' && !nearX(n.pos.x, n.pos.z)) { onRoad++; if (roadWhere.length < 8 && f % 90 === 0) { const a = g.city.pedNodes[n.node], b = g.city.pedNodes[n.nextNode]; roadWhere.push([+n.pos.x.toFixed(1), +n.pos.z.toFixed(1), n.id, n.activity, !!n.buddy, +n.laneOffset.toFixed(2), +n.sideT.toFixed(2), a ? [a.x, a.z] : null, b ? [b.x, b.z] : null, n.onCross, n.pend?.crossing ? 'pc' : '']); } }
        const st = n.char.speed < 0.15 && !n.activity && !n.pend?.crossing ? (still.get(n) ?? 0) + 0.5 : 0; still.set(n, st); if (st === 20) frozen++; // (waiting for WALK at a crossing is not frozen)
      }
    }
    return { samples, onRoad, roadWhere, frozen, npcs: P.npcs.length };
  });
  console.log('peds', JSON.stringify(r));
  expect(r.samples).toBeGreaterThan(500);
  expect(r.onRoad / r.samples).toBeLessThan(0.025); // was 3-6.5 % (beelines through the road); residual: a few walkers hugging the gutter at the kerb
  expect(r.frozen).toBeLessThanOrEqual(2);
});
