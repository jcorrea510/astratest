import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

/** Round 7 (owner): AI cars crash at big junctions, mostly turning from the wrong lane / not yielding; pile-ups clear slowly; taxis. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

test('90 s at a busy grid junction: no wrong-lane turns, few AI crashes', async () => {
  test.setTimeout(600_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, T = g.traffic;
    const I = g.city.intersections.find((i: any) => i.ix === 4 && i.iz === 4 && i.signalized) ?? g.city.intersections.find((i: any) => i.ix >= 0 && i.signalized);
    g.player.place(I.x + I.halfX + 4, 0.3, I.z + I.halfZ + 4, 0);
    for (let i = 0; i < 20 * 30; i++) g.frame(1 / 30, false);
    let crashes = 0, wrong = 0, turns = 0, lefts = 0, rights = 0; const prev = new Map<any, any>(), wrongs: any[] = [];
    g.vehicles.crashListeners.push((e: any) => { if (T.carOf(e.vehicle) && e.impact > 4 && e.vehicle.position.distanceTo(g.player.pos) < 120) crashes++; });
    for (let i = 0; i < 90 * 30; i++) {
      g.frame(1 / 30, false);
      for (const c of T.cars) {
        const p = prev.get(c);
        if (p && p !== c.lane && c.lane.connector && !p.connector) {
          const side = T.turnOf(c.lane.id); if (side) turns++; if (side === 1) lefts++; if (side === -1) rights++;
          if (p.lanes > 1 && p.next.length > 1 && ((side === -1 && p.lane !== p.lanes - 1) || (side === 1 && p.lane !== 0))) { wrong++; wrongs.push({ side, lane: p.lane, lanes: p.lanes, inNext: p.next.includes(c.lane.id), pnext: p.next.map((n: number) => T.turnOf(n)), mode: c.mode, kind: c.v.kind, pers: c.persistent, lc: !!c.lc, pid: p.id, cid: c.lane.id, ix: g.city.intersections[p.intersection].ix, diag: !!p.diag, ys: !!p.ys }); }
        }
        prev.set(c, c.lane);
      }
    }
    return { crashes, wrong, turns, lefts, rights, wrongs: wrongs.slice(0, 5), cars: T.cars.length, jamBreaks: T.stats.jamBreaks };
  });
  console.log('junction', JSON.stringify(r));
  expect(r.turns).toBeGreaterThan(10);
  expect(r.wrong).toBe(0);
  expect(r.crashes).toBeLessThanOrEqual(6);
});

test('taxi: hail, ride to the waypoint, pay the meter, step out', async () => {
  test.setTimeout(300_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, T = g.traffic, V = g.player.pos.constructor;
    g.money = 500;
    // a cab on a long lane right next to the player
    const lane = g.city.lanes.filter((l: any) => !l.connector && !l.ys && !l.diag && l.points.length === 2 && l.lane === l.lanes - 1 && Math.abs(l.points[0].x) < 400 && Math.abs(l.points[0].z) < 400).sort((a: any, b: any) => b.length - a.length)[0];
    const p0 = lane.points[0], p1 = lane.points[lane.points.length - 1], ux = (p1.x - p0.x) / lane.length, uz = (p1.z - p0.z) / lane.length;
    const cab = T.spawnOnLane('taxi', lane, 30, 'cruise', 'civilian', undefined, 0);
    const cx = p0.x + ux * 30, cz = p0.z + uz * 30;
    g.player.place(cx - uz * 4, 0.3, cz + ux * 4, 0);
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    const hailed = g.taxi.interact();
    const riding = g.taxi.riding && g.taxi.vehicle === cab.v;
    // pin about 350 m away along the street grid
    g.waypoint = new V(cx + ux * 300 + uz * 60, 0, cz + uz * 300 - ux * 60);
    const d0 = cab.v.position.distanceTo(g.waypoint);
    let t = 0; for (; t < 150 * 30 && g.taxi.riding; t++) g.frame(1 / 30, false);
    return { hailed, riding, d0, dEnd: g.player.pos.distanceTo(g.waypoint), still: g.taxi.riding, secs: t / 30, money: g.money, out: !g.player.inVehicle };
  });
  console.log('taxi', JSON.stringify(r));
  expect(r.hailed && r.riding).toBe(true);
  expect(r.still).toBe(false);
  expect(r.out).toBe(true);
  expect(r.dEnd).toBeLessThan(60);
  expect(r.money).toBeLessThan(500);
});

test('taxi job: a hailing pedestrian gets in, is driven to the pin, and pays', async () => {
  test.setTimeout(300_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    if (g.taxi.riding) g.taxi.exit();
    const lane = g.city.lanes.filter((l: any) => !l.connector && !l.ys && !l.diag && l.points.length === 2 && l.lane === l.lanes - 1 && Math.abs(l.points[0].x) < 400 && Math.abs(l.points[0].z) < 400).sort((a: any, b: any) => b.length - a.length)[1];
    const p0 = lane.points[0], ux = (lane.points[1].x - p0.x) / lane.length, uz = (lane.points[1].z - p0.z) / lane.length;
    const cx = p0.x + ux * 40, cz = p0.z + uz * 40;
    const car = g.vehicles.spawn('taxi', cx, cz, Math.atan2(ux, uz), -1, 0); car.persistent = true;
    g.seatPlayer(car);
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    // somebody hailing on the kerb to the right, a few metres ahead
    const n = g.pop.spawn('civilian', cx - uz * 4.5 + ux * 4, cz + ux * 4.5 + uz * 4, 0.3); n.persistent = true;
    g.pop.runner.startAct(n, 'hail', 30, 0);
    let t = 0; for (; t < 30 * 20 && g.taxiJob.phase.kind !== 'ride'; t++) g.frame(1 / 30, false);
    const ph = g.taxiJob.phase; if (ph.kind !== 'ride') return { got: false, kind: ph.kind, act: n.activity, brain: n.brain };
    const inside = n.char.inVehicle === car;
    // "drive" there: put the cab next to the pin
    const m0 = g.money; car.phys.settleAt(ph.dest.x, 0, ph.dest.z, car.yaw);
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    return { got: true, inside, paid: g.money - m0, out: !n.char.inVehicle, fares: g.taxiJob.fares };
  });
  console.log('taxijob', JSON.stringify(r));
  expect(r.got).toBe(true);
  expect(r.inside).toBe(true);
  expect(r.paid).toBeGreaterThan(20);
  expect(r.out).toBe(true);
});
