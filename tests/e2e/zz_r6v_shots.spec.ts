import { test } from '@playwright/test';
import { boot, quietStreets } from './helpers';
const OUT = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-astratest/d1ebd1cb-1eba-5496-ba2a-bb23f33ded71/scratchpad/shots';
const TAG = process.env.SHOT_TAG ?? 'old';
test('lod shots', async ({ page }) => {
  test.setTimeout(900_000);
  page.on('console', m => { if (m.text().startsWith('DBG')) console.log(m.text()); });
  await boot(page);
  await quietStreets(page);
  // a straight street: cars parked along the line of sight at 10 / 30 / 60 / 100 m, crowd impostors around
  await page.evaluate(() => {
    const g = (window as any).__game; g.renderer.setQuality('high'); g.clockRunning = false; g.hour = 13; g.crowd.clear();
    g.player.place(-41, 0.25, 9, Math.PI); for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
  });
  for (const view of ['real', 'crowd']) {
    await page.evaluate((view) => {
      const g = (window as any).__game, cam = g.renderer.camera;
      for (const c of [...g.traffic.cars]) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); }
      for (const v of [...g.vehicles.list]) if (!v.persistent || v.__made) g.vehicles.remove(v);
      for (const n of [...g.pop.npcs]) if (n.__made) g.pop.remove(n);
      g.buses.spawnT = 1e9;
      for (const n of [...g.pop.npcs]) if (!n.persistent) g.pop.remove(n);
      g.crowd.clear(); g.crowd.freeze = false; g.trafficCap = 0; g.pedCap = 0;
      // a long straight lane (no slope): camera on it at s=0 looking along it; things placed along the lane
      const lane = g.city.lanes.filter((l: any) => { if (l.connector || l.ys || l.length < 50 || l.lane !== 0) return false; const a = l.points[0], b = l.points[l.points.length - 1], L = Math.hypot(b.x - a.x, b.z - a.z); return l.points.every((p: any) => Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / L < 0.3); }).sort((a: any, b: any) => Math.hypot(a.points[0].x + 41, a.points[0].z - 9) - Math.hypot(b.points[0].x + 41, b.points[0].z - 9))[0];
      const P0 = lane.points[0], P1 = lane.points[lane.points.length - 1], L = Math.hypot(P1.x - P0.x, P1.z - P0.z), fx = (P1.x - P0.x) / L, fz = (P1.z - P0.z) / L, rx = -fz, rz = fx;
      const ox = P0.x, oz = P0.z, yaw = Math.atan2(fx, fz);
      const pt = (d: number, side: number) => ({ x: ox + fx * d + rx * side, z: oz + fz * d + rz * side });
      const kinds = ['sedan', 'suv', 'hatch', 'pickup'];
      const dists = [10, 30, 60, 120];
      if (view === 'real') {
        dists.forEach((d, i) => { const p = pt(d, i % 2 ? 3 : -0.5); const v = g.vehicles.spawn(kinds[i], p.x, p.z, yaw + 0.5); v.persistent = true; v.__made = true; v.settleParked?.(0); });
        dists.forEach((d, i) => { const p = pt(d + 2, i % 2 ? -4 : 6.5); const n = g.pop.spawn('civilian', p.x, p.z, 0.2); n.persistent = true; n.__made = true; n.brain = 'scripted'; n.char.yaw = yaw + 2.2; });
      } else {
        const Col = g.renderer.sun.color.constructor;
        dists.forEach((d, i) => { const p = pt(d, i % 2 ? 3 : -0.5); g.crowd.cars.push({ lane, s: 1, v: 0, paint: 0, len: 4.5, x: p.x, z: p.z, yaw: yaw + 0.5, id: 9000 + i, ox: 0, oz: 0, lcCool: 99, bus: false, dwell: 99, stopS: -1, planLane: lane.id, kind: kinds[i], pc: new Col(0.05 + i * 0.1, 0.06, 0.07 + i * 0.05) }); });
        g.crowd.freeze = true;
        const nd = g.city.pedNodes[0];
        dists.forEach((d, i) => { const p = pt(d + 2, i % 2 ? -4 : 6.5); g.crowd.peds.push({ from: nd.id, to: nd.edges[0].to, t: 0, speed: 0, wait: 999, off: 0, look: 0, x: p.x, z: p.z, yaw: yaw + 2.2, tint: 0x2b4a7a, tint2: 0x23262f, skin: 0xd9a577, phase: 0, seed: 5000 + i }); });
      }
      const cp = pt(-3, 1.2), la = pt(40, 1.2);
      (window as any).__shotCam = () => { cam.position.set(cp.x, 1.7, cp.z); cam.lookAt(la.x, 1.0, la.z); cam.updateMatrixWorld(true); };
      g.player.place(cp.x - fx * 8, 0.25, cp.z - fz * 8, yaw);
      for (let i = 0; i < 6; i++) g.frame(1 / 30, false);
    }, view);
    await page.evaluate(() => { const g = (window as any).__game; g.frame(1 / 30, false); (window as any).__shotCam(); g.vehicles.update(0, 0, 0, g.renderer.camera.position, null);
      for (const v of g.vehicles.list) { v.bodyMesh.userData.drawn = false; v.bodyMesh.onBeforeRender = () => { v.bodyMesh.userData.drawn = true; }; }
      g.renderer.render(); g.renderer.render();
      const cam = g.renderer.camera;
      console.log('DBG cam', cam.position.toArray().map((x: number) => x.toFixed(1)).join(','), JSON.stringify(g.vehicles.list.map((v: any) => ({ k: v.kind, p: v.position.toArray().map((x: number) => +x.toFixed(1)), d: +v.position.distanceTo(cam.position).toFixed(1), gv: v.group.visible, bv: v.bodyMesh.visible, drawn: v.bodyMesh.userData.drawn, lod: v.lod }))));
    });
    await page.screenshot({ path: `${OUT}/${TAG}-${view}.png` });
  }
});
