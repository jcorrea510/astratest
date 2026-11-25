import { test, expect, type Page } from '@playwright/test';
import { boot, step } from './helpers';

/** R6-T: AI traffic obeys lights and stop signs, never idles without a reason, and outnumbers parked cars. 60 s of headless sim. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await boot(page); await step(page, 20); });
test.afterAll(async () => { await page.close(); });

test('60 s of traffic: no red-light running, no idle car without a reason, moving traffic outnumbers parked', async () => {
  test.setTimeout(400_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    // Round 10: the game's own signal function (a copy of the cycle here went stale when Round 9 added the Broadway phase)
    const M = (window as any).__meridian, sig = (I: any, lane: any, time: number): string => I.signalized ? M.signal(I.id, lane.id, time) : 'green';
    const approaches = new Map<number, number>(); for (const l of g.city.lanes) if (!l.connector) approaches.set(l.intersection, (approaches.get(l.intersection) ?? 0) + 1);
    const prev = new Map<any, any>(); const reds: any[] = [], rolled: any[] = [];
    const chk = (key: any, lane: any, speed: number, kind: string) => {
      const p = prev.get(key);
      if (p && p.lane !== lane && lane.connector && !p.lane.connector && speed > 2) {
        const I = g.city.intersections[p.lane.intersection], t = g.time;
        if (sig(I, p.lane, t) === 'red' && sig(I, p.lane, t - 1) === 'red') reds.push({ kind, t, v: speed, inter: I.id, h: [...p.h], pl: p.lane.id, pll: p.lane.length, nl: lane.id, ps: p.s, ns: key.s, st: sig(I, p.lane, t), st2: sig(I, p.lane, t - 1), st3: sig(I, p.lane, t - 3), sig: I.signalized });
        if (!I.signalized && (approaches.get(I.id) ?? 0) >= 3 && speed > 5) rolled.push({ kind, t, v: speed, inter: I.id });
      }
      const h = p ? p.h : []; { h.push([+(lane.length - (key.s ?? 0) - 5.4).toFixed(1), +speed.toFixed(1), sig(g.city.intersections[lane.intersection], lane, g.time)[0] + (lane.connector ? 'C' : ''), lane.id + '@' + Math.round(lane.length), key.ox !== undefined ? +(key.ox).toFixed(1) : 0]); if (h.length > 150) h.shift(); }
      prev.set(key, { lane, h, s: key.s });
    };
    const lastPos = new Map<any, any>(); const jumps: any[] = []; const idle: Record<number, number> = {}, idleWorst: any[] = [];
    const farIdle: Record<number, number> = {}, farWorst: any[] = [];
    let samples = 0, moving = 0, parked = 0, allMoving = 0, allCars = 0;
    const fp = g.player.pos;
    for (let i = 0; i < 60 * 30; i++) {
      g.frame(1 / 30, false);
      for (const c of g.traffic.cars) {
        if (c.persistent) continue;
        chk(c, c.lane, Math.abs(c.v.speed), 'real');
        const id = c.v.id;
        if (c.mode === 'cruise' && Math.abs(c.v.speed) < 0.5 && !c.legitWait) { idle[id] = (idle[id] ?? 0) + 1 / 30; if (idle[id] > 8 && !idleWorst.some(w => w.id === id)) idleWorst.push({ id, lane: c.lane.id, t: idle[id], s: c.s, len: c.lane.length, sig: c.lane.connector ? '-' : sig(g.city.intersections[c.lane.intersection], c.lane, g.time), ss: c.ssWait, jam: c.jamT, blk: c.blockedBy?.id, stopT: c.stopT, inter: g.city.intersections[c.lane.intersection].signalized }); } else idle[id] = 0;
      }
      for (const c of g.crowd.cars) { chk(c, c.lane, c.v, 'far'); const q = lastPos.get(c); if (q && Math.hypot(c.x - q.x, c.z - q.z) > 3) jumps.push({ id: c.id, d: Math.hypot(c.x - q.x, c.z - q.z), from: q.lane, to: c.lane.id, conn: c.lane.connector, s: c.s, v: c.v, ql: q.s }); lastPos.set(c, { x: c.x, z: c.z, lane: c.lane.id, s: c.s }); }
      if (i % 30 === 0) {
        for (const c of g.crowd.cars) {
          const id = c.id;
          if (c.v > 0.3) { farIdle[id] = 0; continue; }
          const L = c.lane, I = g.city.intersections[L.intersection], dS = L.length - c.s - 5.4;
          const atLine = !L.connector && dS < 12 && (sig(I, L, g.time) !== 'green' || !I.signalized);
          const ahead = (o: any, rs: number, ln: any) => (ln === L ? rs > c.s && rs - c.s < 45 : L.next.includes(ln.id) && rs < 45 - (L.length - c.s));
          const queued = g.crowd.cars.some((o: any) => o !== c && ahead(o, o.s, o.lane)) || g.traffic.cars.some((o: any) => ahead(o, o.s, o.lane));
          if (atLine || queued || c.dwell > 0) farIdle[id] = 0; else { farIdle[id] = (farIdle[id] ?? 0) + 1; if (farIdle[id] > 10 && !farWorst.some(w => w.id === id)) farWorst.push({ id, lane: L.id, dS }); }
        }
        samples++;
        { const rc = g.traffic.cars.filter((c: any) => !c.persistent); allCars += rc.length + g.crowd.cars.length; allMoving += rc.filter((c: any) => Math.abs(c.v.speed) > 0.3).length + g.crowd.cars.filter((c: any) => c.v > 0.3).length; }
        const near = (x: number, z: number) => (x - fp.x) ** 2 + (z - fp.z) ** 2 < 150 * 150;
        moving += g.traffic.cars.filter((c: any) => !c.persistent && Math.abs(c.v.speed) > 1 && near(c.v.position.x, c.v.position.z)).length + g.crowd.cars.filter((c: any) => c.v > 1 && near(c.x, c.z)).length;
        parked += g.crowd.countNear(fp.x, fp.z, 150).parked + g.vehicles.list.filter((v: any) => v.parked && near(v.position.x, v.position.z)).length;
      }
    }
    return { jumps: jumps.slice(0, 6), reds, rolled, idleWorst, farWorst, moving: moving / samples, parked: parked / samples, movingFraction: allMoving / Math.max(1, allCars) };
  });
  console.log('TRAFFIC6', JSON.stringify({ ...r, reds: r.reds.length, rolled: r.rolled.length })); console.log('JUMPS', JSON.stringify(r.jumps)); if (r.reds.length) console.log('REDS', JSON.stringify(r.reds.map((x: any) => ({ ...x, h: x.h.filter((_: any, i2: number, a: any[]) => (a.length - i2) % 5 === 0).map((e: any) => e.join('/')).join(' ') }))));
  expect(r.reds, JSON.stringify(r.reds)).toEqual([]);
  expect(r.rolled, JSON.stringify(r.rolled)).toEqual([]);
  expect(r.idleWorst, JSON.stringify(r.idleWorst)).toEqual([]);
  expect(r.farWorst, JSON.stringify(r.farWorst)).toEqual([]);
  expect(r.moving).toBeGreaterThanOrEqual(r.parked);
  expect(r.movingFraction, 'most AI traffic keeps moving (LOD / sleep must not freeze cars; ~0.65 on the original build too)').toBeGreaterThan(0.5);
});
