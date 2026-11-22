import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

/** Overnight O1 (owner): AI drives on its own with no crashes; when the player rams / blocks traffic, it recovers without lasting pile-ups. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

test('3 min around a busy junction with the player ramming and blocking: few AI-only crashes, nobody stuck for long, the jam clears', async () => {
  test.setTimeout(1_200_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, T = g.traffic;
    const I = g.city.intersections.find((i: any) => i.ix === 5 && i.iz === 5 && i.signalized) ?? g.city.intersections.find((i: any) => i.ix >= 0 && i.signalized);
    const car = g.vehicles.spawn('suv', I.x + I.halfX + 30, I.z + 1.5, -Math.PI / 2, -1, 0.4); car.persistent = true; g.seatPlayer(car);
    for (let i = 0; i < 25 * 30; i++) g.frame(1 / 30, false);
    let aiCrash = 0, playerCrash = 0; const struck = new Map<any, number>(); const stuck = new Map<any, number>(); let worstStuck = 0, stuckLong = 0;
    g.vehicles.crashListeners.push((e: any) => {
      if (e.impact < 4 || e.vehicle === car || !T.carOf(e.vehicle) || e.vehicle.position.distanceTo(car.position) > 150) return;
      // the player's hit, or a knock-on from a car the player (or a knocked car) struck in the last 8 s
      const knocked = [...struck.entries()].some(([v, t]) => g.time - t < 8 && v !== e.vehicle && v.position.distanceTo(e.vehicle.position) < 7);
      if (e.vehicle.position.distanceTo(car.position) < 7 || knocked) { playerCrash++; struck.set(e.vehicle, g.time); } else aiCrash++;
    });
    const drive = (tx: number, tz: number, speed: number) => { const dx = tx - car.position.x, dz = tz - car.position.z, d = Math.hypot(dx, dz) || 1, lv = car.phys.body.linvel(); car.phys.body.setLinvel({ x: dx / d * speed, y: lv.y, z: dz / d * speed }, true); };
    const phases: string[] = []; let jamAfter = -1;
    for (let f = 0; f < 180 * 30; f++) {
      const t = f / 30;
      // 0-60 s: ram the nearest AI car every 12 s; 60-90 s: park across the junction; 90+ s: drive off and watch it clear
      if (t < 60) { if (f % 360 < 90) { const tgt = T.cars.filter((c: any) => !c.persistent).sort((a: any, b: any) => a.v.position.distanceTo(car.position) - b.v.position.distanceTo(car.position))[0]; if (tgt) drive(tgt.v.position.x, tgt.v.position.z, 14); } }
      else if (t < 90) { if (car.position.distanceTo(new car.position.constructor(I.x, car.position.y, I.z)) > 2) drive(I.x, I.z, 6); else { const lv = car.phys.body.linvel(); car.phys.body.setLinvel({ x: 0, y: lv.y, z: 0 }, true); } }
      else if (t < 95) drive(I.x + 200, I.z + 200, 18);
      g.frame(1 / 30, false);
      if (f % 15 === 0) {
        let now = 0;
        for (const c of T.cars) {
          if (c.persistent || c.mode !== 'cruise') continue;
          const s = Math.abs(c.v.speed) < 0.4 && !c.legitWait ? (stuck.get(c) ?? 0) + 0.5 : 0; stuck.set(c, s);
          if (s > 25) now++; worstStuck = Math.max(worstStuck, s);
        }
        if (t > 120) stuckLong = Math.max(stuckLong, now);
        if (t > 95 && jamAfter < 0 && now === 0) jamAfter = t - 95;
      }
      if (f % (30 * 30) === 0) phases.push(`${t}s cars ${T.cars.length}`);
    }
    return { aiCrash, playerCrash, worstStuck, stuckLong, jamAfter, jamBreaks: T.stats.jamBreaks, phases };
  });
  console.log('chaos', JSON.stringify(r));
  expect(r.aiCrash).toBeLessThanOrEqual(8);
  expect(r.stuckLong).toBe(0);
});
