import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 5 pedestrian life: bench sitting, bus boarding, bridge walkways. Screenshots go to PED_SHOTS (default test-results). */
test.describe.configure({ mode: 'serial' });
let page: Page;
const SHOTS = process.env.PED_SHOTS ?? 'test-results';
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

test('pedestrians walk across the bridge walkway at deck height', async () => {
  test.setTimeout(300_000);
  await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game; const N = g.city.pedNodes; g.pedCap = 20;
    const start = N.filter(n => n.y !== undefined && n.x > 560 && n.x < 580 && n.z < 200)[0];
    const peds = [];
    for (let k = 0; k < 3; k++) { const n = g.pop.spawn('civilian', start.x + k, start.z, start.y + 0.3); n.node = start.id; n.nextNode = start.id; peds.push(n); }
    g.player.place(start.x + 8, start.y + 0.3, start.z, 0);
    let minY = 99, maxY = -99, maxX = 0, alive = 0;
    for (let i = 0; i < 90 * 30; i++) { g.frame(1 / 30, i === 90 * 30 - 1); for (const n of peds) { if (!n.alive || n.disposed) continue; if (n.pos.x > 560 && n.pos.x < 710) minY = Math.min(minY, n.pos.y); maxY = Math.max(maxY, n.pos.y); maxX = Math.max(maxX, n.pos.x); } }
    for (const n of peds) if (n.alive && !n.disposed) alive++;
    return { minY, maxY, maxX, alive, startY: start.y };
  })()`) as any;
  console.log('bridge', JSON.stringify(r));
  await page.screenshot({ path: `${SHOTS}/ped-bridge.png`, timeout: 120_000 });
  expect(r.alive).toBeGreaterThan(0);
  expect(r.minY).toBeGreaterThan(2.5); // over the river span nobody is below the deck
  expect(r.maxX).toBeGreaterThan(600);
});

test('a pedestrian walks to a bench, sits for a while, then gets up and walks on', async () => {
  test.setTimeout(300_000);
  await page.evaluate(`(() => {
    const g = window.__game; g.pedCap = 20; const B = g.benches.filter(b => b.y < 1 && !b.occupied);
    const b = B[Math.floor(B.length / 2)];
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    const px = b.x + fx * 3.2 - fz * 1.6, pz = b.z + fz * 3.2 + fx * 1.6;
    g.player.place(px, 0.4, pz, 0); g.player.human.root.visible = false; g.cam.yaw = Math.atan2(b.x - px, b.z - pz) + Math.PI;
    const n = g.pop.spawn('civilian', b.x + fx * 6, b.z + fz * 6, 0.2);
    b.occupied = true; n.bench = b; n.activity = 'sit'; n.destPt = new g.player.pos.constructor(b.x + fx * 0.9, 0.2, b.z + fz * 0.9); n.brain = 'wander'; n.stateT = 0;
    window.__bench = { n, b, satFrames: 0, sat: false, seatY: 0, dist: 99 };
  })()`);
  const stepUntil = (frames: number) => page.evaluate(`(() => {
    const g = window.__game; const S = window.__bench; const n = S.n, b = S.b;
    for (let i = 0; i < ${frames}; i++) { g.frame(1 / 30, false); if (n.activity === 'sitting') { S.sat = true; S.satFrames++; S.seatY = n.pos.y; S.dist = Math.hypot(n.pos.x - b.x, n.pos.z - b.z); } }
    g.frame(1 / 30, true); return { sat: S.sat, frames: S.satFrames, seatY: S.seatY, dist: S.dist, benchY: b.y, act: n.activity };
  })()`) as Promise<any>;
  let r = await stepUntil(30);
  for (let k = 0; k < 40 && r.frames < 60; k++) r = await stepUntil(30);
  await page.screenshot({ path: `${SHOTS}/ped-bench.png`, timeout: 120_000 });
  console.log('bench', JSON.stringify(r));
  expect(r.sat).toBe(true);
  expect(r.dist).toBeLessThan(0.6);
  expect(Math.abs(r.seatY - r.benchY)).toBeLessThan(0.3);
  // after its time it gets up and walks on (the sit time is 25-95 s in the game; shortened here)
  await page.evaluate(`(() => { const n = window.__bench.n; n.actDur = 4; n.stateT = 0; })()`);
  for (let k = 0; k < 12 && r.act === 'sitting'; k++) r = await stepUntil(30);
  expect(r.act).not.toBe('sitting');
  const stood = await page.evaluate(`(() => { const { n } = window.__bench; return { coll: n.char.physicsEnabled, brain: n.brain, free: !window.__bench.b.occupied }; })()`) as any;
  expect(stood.coll).toBe(true); expect(stood.free).toBe(true);
  // a scare gets a sitter up straight away and frees the bench
  const up = await page.evaluate(`(() => {
    const g = window.__game; const { b } = window.__bench; b.occupied = true;
    const m = g.pop.spawn('civilian', b.x, 0.2, b.z); m.bench = b; m.activity = 'sit'; m.destPt = m.pos.clone(); m.brain = 'wander';
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    const sitting = m.activity === 'sitting';
    g.pop.danger(g.player.pos, 40, g.player);
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    return { sitting, brain: m.brain, collider: m.char.physicsEnabled, free: !b.occupied };
  })()`) as any;
  console.log('scare', JSON.stringify(up));
  expect(up.sitting).toBe(true);
  expect(up.collider).toBe(true);
  expect(up.free).toBe(true);
});

test('people wait at a bus stop, board when the bus kneels, and riders step off', async () => {
  test.setTimeout(500_000);
  await page.evaluate(`(() => {
    const g = window.__game; g.trafficCap = 0; g.pedCap = 40;
    for (const c of [...g.traffic.cars]) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); }
    if (g.playerVehicle) { const o = g.playerVehicle; g.exitVehicle(true); g.vehicles.remove(o); }
    const st = g.buses.routes[0].stops[0]; g.player.place(st.x - st.dz * 6 + st.dx * 60, 0.4, st.z + st.dx * 6 + st.dz * 60, 0);
    window.__bus0 = { boarded0: g.buses.stats.boarded, st, shot: false };
  })()`);
  const poll = () => page.evaluate(`(() => {
    const g = window.__game, B = g.buses, S = window.__bus0, st = S.st;
    for (let i = 0; i < 30; i++) {
      g.frame(1 / 30, false);
      const run = B.runs.find(r => r.waiting && r.car);
      if (run && !S.shot) {
        const v = run.car.v, dp = v.doorPoint(-1);
        const close = B.boarding.filter(n => Math.hypot(n.pos.x - dp.x, n.pos.z - dp.z) < 2.2);
        if (close.length) {
          S.shot = true; const rx = -st.dz, rz = st.dx;
          // camera on the pavement a few metres back from the door, looking at it
          const px = dp.x + rx * 3.2 - st.dx * 4.5, pz = dp.z + rz * 3.2 - st.dz * 4.5;
          g.player.place(px, 0.4, pz, 0); g.player.human.root.visible = false; g.cam.yaw = Math.atan2(dp.x - px, dp.z - pz) + Math.PI;
          for (let k = 0; k < 3; k++) g.frame(1 / 30, k === 2);
          return { shot: true, near: close.length, y: close.map(n => +(n.pos.y).toFixed(2)) };
        }
      }
    }
    return { shot: S.shot, queued: B.stats.queued, boarded: B.stats.boarded - S.boarded0 };
  })()`) as Promise<any>;
  let r: any = {}; let framed: any = null;
  for (let k = 0; k < 400 && !framed; k++) { r = await poll(); if (r.near) framed = r; }
  expect(framed).not.toBeNull();
  await page.screenshot({ path: `${SHOTS}/ped-busstop.png`, timeout: 120_000 });
  let done: any = {};
  for (let k = 0; k < 60; k++) { done = await page.evaluate(`({ boarded: window.__game.buses.stats.boarded - window.__bus0.boarded0, queued: window.__game.buses.stats.queued })`); if (done.boarded > 0) break; await page.evaluate(`(() => { for (let i = 0; i < 30; i++) window.__game.frame(1 / 30, false); })()`); }
  console.log('busboard', JSON.stringify({ framed, done }));
  expect(done.queued).toBeGreaterThan(0);
  expect(done.boarded).toBeGreaterThan(0);
});

test('a pedestrian routed from the west sidewalk crosses Harbor Way and reaches the bridge deck', async () => {
  test.setTimeout(400_000);
  const r = await page.evaluate(`(() => {
    const g = window.__game; const N = g.city.pedNodes; g.pedCap = 20; g.trafficCap = 6;
    const start = N.filter(n => n.y === undefined && n.x > 430 && n.x < 445 && Math.abs(n.z - 89) < 3)[0];
    const goal = N.filter(n => n.y !== undefined && n.y > 4 && n.x > 560)[0];
    // shortest path by BFS
    const prev = new Map([[start.id, -1]]); const q = [start.id];
    while (q.length) { const c = q.shift(); if (c === goal.id) break; for (const e of N[c].edges) if (!prev.has(e.to)) { prev.set(e.to, c); q.push(e.to); } }
    const path = []; for (let c = goal.id; c !== -1; c = prev.get(c)) path.unshift(c);
    const cross = path.some((id, i) => i && N[id].edges.some(e => e.to === path[i - 1] && e.crossing));
    g.player.place(start.x + 6, 0.4, start.z + 8, 0);
    const n = g.pop.spawn('civilian', start.x, start.z, 0.2); n.node = start.id; n.nextNode = start.id; n.speedMul = 1.6; n.persistent = true; // the far-crowd hand-over (crowd.demotePed) would otherwise swap a walker out beyond ~110 m
    let reached = false, frames = 0; const trace = [];
    for (let i = 0; i < 300 * 30 && !reached; i++) {
      g.frame(1 / 30, false); frames++;
      if (!n.alive || n.disposed) break;
      const k = path.indexOf(n.node); if (k >= 0 && k < path.length - 1) n.nextNode = path[k + 1];
      if (frames % 45 === 0) trace.push([Math.round(n.pos.x), +n.pos.y.toFixed(1), Math.round(n.pos.z), n.node]);
      if (n.node === goal.id) reached = true;
    }
    return { reached, hops: path.length, cross, y: n.pos.y, alive: n.alive, sec: frames / 30, x: n.pos.x, trace: trace.join(' '), path: path.map(id => (N[id].x | 0) + ',' + (N[id].z | 0) + ',' + (N[id].y ?? 0).toFixed(1)).join(' > ') };
  })()`) as any;
  console.log('approach', JSON.stringify(r));
  expect(r.cross).toBe(true);
  expect(r.reached).toBe(true);
  expect(r.alive).toBe(true);
  expect(r.y).toBeGreaterThan(3.5);
});
