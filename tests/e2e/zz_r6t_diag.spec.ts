import { test } from '@playwright/test';
import { boot, step } from './helpers';
test('diag', async ({ page }) => {
  test.setTimeout(400000);
  await boot(page);
  await step(page, 20);
  const out = await page.evaluate(() => {
    const g = (window as any).__game;
    const CY = [13, 3, 1.5, 13, 3, 1.5], PER = CY.reduce((a, b) => a + b, 0);
    const sig = (I: any, axis: string, time: number) => { if (!I.signalized) return 'green'; let t = (((time + I.offset) % PER) + PER) % PER; let ph = 0; while (t >= CY[ph]) { t -= CY[ph]; ph++; } const ns = ph < 3; const mine = axis === 'z' ? ns : !ns; const p = ph % 3; if (!mine || p === 2) return 'red'; return p === 0 ? 'green' : 'yellow'; };
    const fs: Record<number, number> = {}; const why: any[] = []; const prev = new Map<any, any>(); const reds: any[] = []; const unj: Record<number, number> = {}; const unjMax: any = {};
    const crowdStill: Record<string, number> = {};
    const stats: any = { n: 0, real: 0, realMoving: 0, far: 0, farMoving: 0, parked: 0, realStill: 0 };
    const chk = (key: any, lane: any, speed: number, kind: string) => {
      const p = prev.get(key);
      if (p && p.lane !== lane && lane.connector && !p.lane.connector && speed > 2) {
        const I = g.city.intersections[p.lane.intersection]; const t = g.time;
        if (sig(I, p.lane.axis, t) === 'red' && sig(I, p.lane.axis, t - 1) === 'red') reds.push({ kind, t: +t.toFixed(1), v: +speed.toFixed(1), inter: p.lane.intersection });
      }
      prev.set(key, { lane });
    };
    for (let i = 0; i < 60 * 30; i++) {
      g.frame(1 / 30, false);
      for (const c of g.traffic.cars) {
        if (c.persistent) continue; const id = c.v.id;
        chk(c, c.lane, Math.abs(c.v.speed), 'real');
        if (Math.abs(c.v.speed) < 0.5 && !c.legitWait) { unj[id] = (unj[id] ?? 0) + 1 / 30; if (unj[id] > 8) unjMax[id] = { t: +unj[id].toFixed(1), lane: c.lane.id, s: +c.s.toFixed(1), conn: c.lane.connector, mode: c.mode, dbg: c.dbg, d: +c.v.position.distanceTo(g.player.pos).toFixed(0) }; } else unj[id] = 0;
      }
      for (const c of g.crowd.cars) chk(c, c.lane, c.v, 'far');
      if (i % 30 === 0) {
        for (const c of g.crowd.cars) { if (c.v > 0.3) { fs[c.id] = 0; continue; } fs[c.id] = (fs[c.id] ?? 0) + 1;
          if (fs[c.id] >= 10) { const L = c.lane; const I = g.city.intersections[L.intersection]; const dS = L.length - c.s - 5.4; const st = L.connector ? 'conn' : sig(I, L.axis, g.time); const same = g.crowd.cars.filter((o: any) => o.lane === L && o !== c && o.s > c.s && o.s - c.s < 15).length; why.push({ id: c.id, st, dS: +dS.toFixed(1), bus: c.bus, dwell: +c.dwell.toFixed(1), lead: same, next: L.next.length, lane: L.id }); fs[c.id] = -1000; } }
        const cars = g.traffic.cars.filter((c: any) => !c.persistent);
        stats.n++; stats.real += cars.length; stats.realMoving += cars.filter((c: any) => Math.abs(c.v.speed) > 1).length;
        stats.far += g.crowd.cars.length; stats.farMoving += g.crowd.cars.filter((c: any) => c.v > 1).length;
        const near = g.crowd.countNear(g.player.pos.x, g.player.pos.z, 150); stats.parked += near.parked;
      }
    }
    for (const k of ['real','realMoving','far','farMoving','parked']) stats[k] = +(stats[k] / stats.n).toFixed(1);
    return { stats, reds: reds.length, redList: reds.slice(0, 12), unj: Object.values(unjMax), why: why.slice(0, 25), nwhy: why.length, tj: g.traffic.stats };
  });
  console.log('DIAG' + JSON.stringify(out));
});
