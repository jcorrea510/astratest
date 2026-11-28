import { test, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

// Temporary CI probe (removed before merge): traffic5's "boxed in while panicking" scenario.
let page: Page;
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

test('probe bail scenario', async () => {
  await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game; const T = g.traffic; const out = { log: [] };
    const L = g.city.lanes.filter(l => !l.connector && l.points.length === 2).sort((a, b) => b.length - a.length);
    const l = L[3]; const a = l.points[0], b = l.points[1]; const len = Math.hypot(b.x - a.x, b.z - a.z);
    const info = { lane: l, ax: a.x, az: a.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, len, k: (len - 30) / 130 };
    const at = (s) => { s = 10 + s * info.k; return { x: info.ax + info.dx * s, z: info.az + info.dz * s }; };
    for (const c of [...T.cars]) { T.cars.splice(T.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); }
    for (const v of [...g.vehicles.list]) if (!v.persistent && v !== g.playerVehicle) g.vehicles.remove(v);
    g.trafficCap = 0;
    const crashes = []; g.vehicles.crashListeners.push(e => crashes.push({ id: e.vehicle.id, imp: +e.impact.toFixed(2), pre: +(e.preSpeed ?? 0).toFixed(2), fd: +(e.frontDot ?? 0).toFixed(2), t: +g.time.toFixed(2) }));
    const v4 = T.spawnOnLane('sedan', info.lane, 10 + 70 * info.k); v4.v.phys.body.setLinvel({ x: info.dx * 11, y: 0, z: info.dz * 11 }, true);
    v4.v.phys.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const f = at(70 + 4.6); const wall = g.vehicles.spawn('sedan', f.x, f.z, Math.atan2(info.dx, info.dz)); wall.phys.teleport(f.x, 0.8, f.z, Math.atan2(info.dx, info.dz)); wall.ignition = false; wall.parked = false;
    const driver = v4.driver; T.panic(v4.v);
    out.ids = [v4.v.id, wall.id]; out.gap0 = +v4.v.position.distanceTo(wall.position).toFixed(2);
    for (let i = 0; i < 180; i++) {
      g.frame(1 / 30, false);
      if (i < 6 || i % 10 === 0) out.log.push([i, +v4.v.speed.toFixed(2), +v4.v.position.distanceTo(wall.position).toFixed(2), v4.mode, +(v4.boxedT ?? 0).toFixed(2), +(v4.reverseT ?? 0).toFixed(2), +(v4.stuckT ?? 0).toFixed(2), +v4.v.input.throttle.toFixed(2), +v4.v.input.steer.toFixed(2), driver.alive, !!driver.char.inVehicle, T.cars.includes(v4), +v4.v.health.toFixed(0), !!v4.avoid, +(v4.shift ?? 0).toFixed(2), v4.v.phys.wallContact].join(' '));
    }
    out.crashes = crashes.slice(0, 12);
    out.bailed = !T.cars.includes(v4) && driver.alive && driver.char.inVehicle === null;
    return out;
  })()`);
  console.log('BAILPROBE', JSON.stringify(r));
});
