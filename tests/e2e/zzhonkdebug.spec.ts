import { test, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

// Temporary CI probe (removed before merge): what the AI car does in traffic5's honk scenario.
let page: Page;
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

test('probe honk scenario', async () => {
  await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game; const T = g.traffic; const out = { log: [] };
    const L = g.city.lanes.filter(l => !l.connector && l.points.length === 2).sort((a, b) => b.length - a.length);
    const l = L[3]; const a = l.points[0], b = l.points[1]; const len = Math.hypot(b.x - a.x, b.z - a.z);
    const info = { lane: l, ax: a.x, az: a.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, len, k: (len - 30) / 130 };
    out.laneSpeed = l.speed; out.len = len;
    const at = (s) => { s = 10 + s * info.k; return { x: info.ax + info.dx * s, z: info.az + info.dz * s }; };
    for (const c of [...T.cars]) { T.cars.splice(T.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); }
    for (const v of [...g.vehicles.list]) if (!v.persistent && v !== g.playerVehicle) g.vehicles.remove(v);
    g.trafficCap = 0;
    const crashes = []; g.vehicles.crashListeners.push(e => crashes.push({ id: e.vehicle.id, imp: +e.impact.toFixed(2), t: +g.time.toFixed(2) }));
    const p0 = at(60); g.player.place(p0.x, 0.4, p0.z, 0);
    const pv = g.vehicles.spawn('sedan', p0.x + info.dx * 20, p0.z + info.dz * 20, Math.atan2(info.dx, info.dz)); g.seatPlayer(pv);
    pv.phys.teleport(p0.x + info.dx * 20, 0.8, p0.z + info.dz * 20, Math.atan2(info.dx, info.dz));
    const c = T.spawnOnLane('sedan', info.lane, 10 + (60 - 0.001) * info.k);
    out.v0 = +Math.hypot(c.v.phys.lastVel.x, c.v.phys.lastVel.z).toFixed(2);
    c.v.phys.body.setLinvel({ x: info.dx * 11, y: 0, z: info.dz * 11 }, true);
    out.aiId = c.v.id; out.pvId = pv.id;
    const h0 = T.stats.honks;
    for (let i = 0; i < 120; i++) {
      g.frame(1 / 30, false);
      if (i < 4 || i % 8 === 0) out.log.push([i, +c.v.speed.toFixed(2), +c.v.position.distanceTo(pv.position).toFixed(2), c.mode, !!c.v.hazard, +(c.v.phys.impact || 0).toFixed(2), +(c.v.phys.impactNormal || 0).toFixed(2), c.v.phys.wallContact, c.blockedBy === pv, T.stats.honks - h0].join(' '));
    }
    out.crashes = crashes; out.honked = T.stats.honks - h0;
    return out;
  })()`);
  console.log('HONKPROBE', JSON.stringify(r));
});
