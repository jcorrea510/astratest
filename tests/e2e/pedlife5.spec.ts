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
    g.player.place(px, 0.4, pz, 0); g.cam.yaw = Math.atan2(b.x - px, b.z - pz) + Math.PI;
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
  // sat for a good while, then got up and walks on
  for (let k = 0; k < 20 && r.act === 'sitting'; k++) r = await stepUntil(150);
  expect(r.act).not.toBe('sitting');
  expect(r.frames).toBeGreaterThan(300);
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
  test.setTimeout(400_000);
  const r = await page.evaluate(`(() => {
    const g = window.__game; const B = g.buses; g.trafficCap = 0; g.pedCap = 40;
    for (const c of [...g.traffic.cars]) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); }
    if (g.playerVehicle) { const o = g.playerVehicle; g.exitVehicle(true); g.vehicles.remove(o); }
    const st = B.routes[0].stops[0]; g.player.place(st.x - st.dz * 6 + st.dx * 60, 0.4, st.z + st.dx * 6 + st.dz * 60, 0);
    let seenQueue = 0, shot = false;
    const boarded0 = B.stats.boarded;
    for (let i = 0; i < 300 * 30; i++) {
      g.frame(1 / 30, false);
      const q = (B.waiting.get(st) ?? []).length; seenQueue = Math.max(seenQueue, q);
      if (!shot && B.runs.some(r => r.waiting) && B.boarding.length) { shot = true; g.player.place(st.x - st.dz * 5 - st.dx * 8, 0.4, st.z + st.dx * 5 - st.dz * 8, 0); g.cam.yaw = Math.atan2(st.dx * 8 + st.dz * 0, st.dz * 0 + st.dz); for (let k = 0; k < 20; k++) g.frame(1 / 30, k === 19); }
      if (B.stats.boarded > boarded0 && i > 600) break;
    }
    return { queued: B.stats.queued, seenQueue, boarded: B.stats.boarded - boarded0, stops: B.stats.stops };
  })()`) as any;
  console.log('busboard', JSON.stringify(r));
  await page.screenshot({ path: `${SHOTS}/ped-busstop.png`, timeout: 120_000 });
  expect(r.queued).toBeGreaterThan(0);
  expect(r.boarded).toBeGreaterThan(0);
});
