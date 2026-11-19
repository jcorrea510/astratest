import { test, expect, type Page } from '@playwright/test';
import { boot, step, quietStreets } from './helpers';

/** Round 5 traffic: parked cars persist and face traffic, no gridlock, driver reactions, violation events. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

/** Finds a long straight road lane away from the origin and returns its start point / direction in the page. */
const LANE = `(() => {
  const g = window.__game; const L = g.city.lanes.filter(l => !l.connector && l.points.length === 2).sort((a, b) => b.length - a.length);
  const l = L[3]; const a = l.points[0], b = l.points[1]; const len = Math.hypot(b.x - a.x, b.z - a.z);
  return { lane: l, ax: a.x, az: a.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, len, k: (len - 30) / 130 };
})()`;

test('parked cars face the traffic on their side of the street', async () => {
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const slots = (g.crowd as any).slots as any[];
    let bad = 0, n = 0;
    for (const s of slots.filter((_, i) => i % 7 === 0)) {
      let best = 1e9, dx = 0, dz = 0;
      for (const l of g.city.lanes) { if (l.connector) continue; for (let i = 1; i < l.points.length; i++) { const a = l.points[i - 1], b = l.points[i]; const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1; const u = Math.max(0, Math.min(1, ((s.x - a.x) * vx + (s.z - a.z) * vz) / l2)); const d = Math.hypot(s.x - a.x - vx * u, s.z - a.z - vz * u); if (d < best) { best = d; dx = vx / Math.sqrt(l2); dz = vz / Math.sqrt(l2); } } }
      n++; if (Math.sin(s.yaw) * dx + Math.cos(s.yaw) * dz < 0.9) bad++;
    }
    return { bad, n };
  });
  expect(r.n).toBeGreaterThan(50);
  expect(r.bad).toBe(0);
});

test('the same parked cars come back (kind, colour), trucks stand upright asleep and nothing drops', async () => {
  await quietStreets(page);
  const first = await page.evaluate(() => {
    const g = (window as any).__game; const slots = (g.crowd as any).slots as any[];
    const picks = [7, 13, 5].map(k => slots.find(s => s.kind === k && Math.hypot(s.x, s.z) < 500 && !s.taken)).filter(Boolean); // pickup, van, suv
    (window as any).__picks = picks.map(s => slots.indexOf(s));
    return picks.length;
  });
  expect(first).toBe(3);
  const look = async () => page.evaluate(() => {
    const g = (window as any).__game; const slots = (g.crowd as any).slots as any[]; const out: any[] = [];
    for (const i of (window as any).__picks as number[]) {
      const s = slots[i]; g.player.place(s.x + 6, 0.4, s.z, 0);
      for (let k = 0; k < 90; k++) g.frame(1 / 30, false);
      const v = s.real; out.push(v ? { kind: v.kind, paint: v.paint.getHex(), up: v.phys.upVec().y, y: v.position.y, dy: 0, asleep: v.phys.body.isSleeping(), yaw: v.yaw, slotYaw: s.yaw } : null);
    }
    return out;
  });
  const a = await look();
  await page.evaluate(() => { (window as any).__game.player.place(900, 0.4, 900, 0); });
  await step(page, 6);
  const b = await look();
  for (let i = 0; i < 3; i++) {
    expect(a[i], `slot ${i} real car`).not.toBeNull();
    expect(b[i]).toEqual(a[i]);
    expect(a[i].up).toBeGreaterThan(0.99);
    expect(a[i].y).toBeLessThan(1.2);
    expect(a[i].asleep).toBe(true);
  }
});

test('traffic soak: 3 minutes, healthy average speed, nobody stuck more than 30 s', async () => {
  test.setTimeout(600_000);
  await page.evaluate(() => { const g = (window as any).__game; g.trafficCap = undefined; g.pedCap = 0; g.player.place(0, 0.4, -100, 0); });
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const stuck = new Map<any, number>(); let worst = 0, speedSum = 0, samples = 0, moving = 0;
    for (let sec = 0; sec < 190; sec++) {
      for (let k = 0; k < 30; k++) g.frame(1 / 30, false);
      if (sec < 10) continue;
      for (const c of g.traffic.cars) {
        if (c.persistent || c.mode !== 'cruise') continue;
        const sp = Math.abs(c.v.speed); speedSum += sp; samples++; if (sp > 1) moving++;
        const key = c; const near = c.v.position.distanceTo(g.player.pos) < 20;
        if (sp < 0.5 && !near && !c.legitWait && !(c.stopT > 0)) { const t = (stuck.get(key) ?? 0) + 1; stuck.set(key, t); worst = Math.max(worst, t); } else stuck.set(key, 0);
      }
    }
    return { avg: speedSum / Math.max(1, samples), moving: moving / Math.max(1, samples), worst, cars: g.traffic.cars.length, stats: g.traffic.stats };
  });
  console.log('soak', JSON.stringify(r));
  expect(r.cars).toBeGreaterThan(3);
  expect(r.avg).toBeGreaterThan(3.5);
  expect(r.worst).toBeLessThan(30);
});

test('drivers honk when cut off, tuck over for a siren, floor it when shot at, stop for a crash', async () => {
  await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game; const T = g.traffic; const out = {};
    const info = ${LANE};
    const at = (s, side = 0) => { s = 10 + s * info.k; return { x: info.ax + info.dx * s - info.dz * side, z: info.az + info.dz * s + info.dx * side }; };
    const run = (sec) => { for (let i = 0; i < sec * 30; i++) g.frame(1 / 30, false); };
    const mkAi = (s) => { const c = T.spawnOnLane('sedan', info.lane, 10 + s * info.k); c.v.phys.body.setLinvel({ x: info.dx * 11, y: 0, z: info.dz * 11 }, true); return c; };
    const clear = () => { quietStreets_(); };
    const quietStreets_ = () => { for (const c of [...T.cars]) { T.cars.splice(T.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); } for (const v of [...g.vehicles.list]) if (!v.persistent && v !== g.playerVehicle) g.vehicles.remove(v); };
    g.trafficCap = 0;
    // 1. honk: the player's car sits just ahead in the lane of an oncoming AI car
    clear();
    const p0 = at(60); g.player.place(p0.x, 0.4, p0.z, 0);
    const pv = g.vehicles.spawn('sedan', p0.x + info.dx * 20, p0.z + info.dz * 20, Math.atan2(info.dx, info.dz)); g.seatPlayer(pv);
    pv.phys.teleport(p0.x + info.dx * 20, 0.8, p0.z + info.dz * 20, Math.atan2(info.dx, info.dz));
    const ai = mkAi(60 - 0.001); out.len = info.len;
    const h0 = T.stats.honks; run(4); out.honked = T.stats.honks - h0;
    // 2. siren: player in a stolen cop car comes up behind a cruising civilian
    clear(); g.exitVehicle(true); g.vehicles.remove(pv);
    const civ = mkAi(80); const cp = at(40);
    const cop = g.vehicles.spawn('police', cp.x, cp.z, Math.atan2(info.dx, info.dz)); cop.phys.teleport(cp.x, 0.8, cp.z, Math.atan2(info.dx, info.dz)); g.seatPlayer(cop); cop.sirenTone = 1;
    run(0.5); cop.phys.body.setLinvel({ x: info.dx * 9, y: 0, z: info.dz * 9 }, true);
    let minShift = 0, minSpeed = 99; for (let i = 0; i < 90; i++) { g.frame(1 / 30, false); minShift = Math.min(minShift, civ.shift ?? 0); minSpeed = Math.min(minSpeed, Math.abs(civ.v.speed)); }
    out.sirenShift = minShift; out.sirenSpeed = minSpeed; out.yields = T.stats.yields;
    // 3. gunfire: a civilian nearby panics and drives away
    clear(); g.exitVehicle(true); g.vehicles.remove(cop);
    const v3 = mkAi(80); const o3 = g.player.pos.clone(); o3.set(v3.v.position.x - 10, 1, v3.v.position.z - 10); T.gunfire(o3, g.player.pos);
    out.fleeMode = v3.mode;
    // 4. boxed in while panicking: the driver bails out on foot
    clear();
    const v4 = mkAi(70); v4.v.phys.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const f = at(70 + 4.6); const wall = g.vehicles.spawn('sedan', f.x, f.z, Math.atan2(info.dx, info.dz)); wall.phys.teleport(f.x, 0.8, f.z, Math.atan2(info.dx, info.dz)); wall.ignition = false; wall.parked = false;
    const driver = v4.driver; T.panic(v4.v); run(6);
    out.bailed = !T.cars.includes(v4) && driver.alive && driver.char.inVehicle === null;
    // 5. crash ahead: cruising car slows to a halt and tucks over
    clear();
    const v5 = mkAi(30); const cs = at(95); const wreck = g.vehicles.spawn('sedan', cs.x, cs.z, 0); wreck.phys.teleport(cs.x, 0.8, cs.z, 1.0);
    for (const l of g.vehicles.crashListeners) l({ vehicle: wreck, impact: 9, point: { x: cs.x, y: 0.5, z: cs.z, clone() { return { x: cs.x, y: 0.5, z: cs.z }; } } });
    run(6); out.crashSpeed = Math.abs(v5.v.speed); out.crashShift = v5.shift ?? 0;
    return out;
  })()`) as any;
  console.log('behaviours', JSON.stringify(r));
  expect(r.honked).toBeGreaterThan(0);
  expect(r.sirenShift).toBeLessThan(-0.5);
  expect(r.sirenSpeed).toBeLessThan(6);
  expect(r.fleeMode).toBe('flee');
  expect(r.bailed).toBe(true);
  expect(r.crashSpeed).toBeLessThan(5); // slowed from 11 m/s (crawls to a stop short of the wreck)
  expect(r.crashShift).toBeLessThan(-0.3);
});

test('player traffic violations are reported (speeding, wrong way, collision)', async () => {
  await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game; const T = g.traffic; g.trafficCap = 0;
    const info = ${LANE};
    const seen = []; T.onPlayerTrafficViolation(v => seen.push(v.kind));
    const at = (s) => { s = 10 + s * info.k; return { x: info.ax + info.dx * s, z: info.az + info.dz * s }; };
    const clear = () => { for (const c of [...T.cars]) { T.cars.splice(T.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); } };
    const go = (yawDelta, speed, s0, sec) => {
      if (g.playerVehicle) { const o = g.playerVehicle; g.exitVehicle(true); g.vehicles.remove(o); }
      const p = at(s0); const yaw = Math.atan2(info.dx, info.dz) + yawDelta;
      const v = g.vehicles.spawn('sedan', p.x, p.z, yaw); v.phys.teleport(p.x, 0.8, p.z, yaw); g.seatPlayer(v);
      g.player.place(p.x, 0.4, p.z, 0); g.input.press('KeyW');
      for (let i = 0; i < sec * 30; i++) { v.phys.body.setLinvel({ x: Math.sin(yaw) * speed, y: v.phys.body.linvel().y, z: Math.cos(yaw) * speed }, true); g.frame(1 / 30, false); }
      g.input.release('KeyW');
      return v;
    };
    clear(); T.update(0.6, g.renderer.camera, g.player.pos, 0);
    go(0, 32, 30, 3); const speeding = seen.includes('speeding');
    go(Math.PI, 9, 120, 3); const wrongWay = seen.includes('wrong_way');
    const target = at(150); const ai = g.vehicles.spawn('sedan', target.x + info.dx * 14, target.z + info.dz * 14, Math.atan2(info.dx, info.dz)); ai.phys.teleport(target.x + info.dx * 14, 0.8, target.z + info.dz * 14, Math.atan2(info.dx, info.dz));
    go(0, 20, 120, 2.5); const collision = seen.includes('collision');
    return { speeding, wrongWay, collision, seen };
  })()`) as any;
  console.log('violations', JSON.stringify(r));
  expect(r.speeding).toBe(true);
  expect(r.wrongWay).toBe(true);
  expect(r.collision).toBe(true);
});
