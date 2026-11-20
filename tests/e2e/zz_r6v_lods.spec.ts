import { test } from '@playwright/test';
import { boot, quietStreets } from './helpers';
const OUT = '/tmp/claude-0/-home-user-astratest/d1ebd1cb-1eba-5496-ba2a-bb23f33ded71/scratchpad/shots';
const TAG = process.env.SHOT_TAG ?? 'old';
test('lod compare', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page);
  await quietStreets(page);
  for (const dist of [18, 45]) {
    await page.evaluate((dist) => {
      const g = (window as any).__game, cam = g.renderer.camera;
      g.renderer.setQuality('high'); g.clockRunning = false; g.hour = 13;
      for (const c of [...g.traffic.cars]) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); }
      for (const v of [...g.vehicles.list]) if (v.position.distanceTo(g.player.pos) < 300) g.vehicles.remove(v);
      g.buses.spawnT = 1e9; g.crowd.clear(); g.trafficCap = 0; g.pedCap = 0;
      const ox = -45, oz = 3.2; // Meridian Blvd, looking +x
      const vs = ['sedan', 'suv', 'hatch'].flatMap(k => [0, 1, 2].map(l => ({ k, l })));
      g.player.place(ox - 20, 0.25, oz, Math.PI / 2); for (let i = 0; i < 4; i++) g.frame(1 / 30, false);
      vs.forEach((e, i) => { const v = g.vehicles.spawn(e.k, ox + dist + Math.floor(i / 3) * 0.01, oz - 8 + (i % 3) * 3.0 + Math.floor(i / 3) * 0, 0); });
      // three rows: sedan, suv, hatch at the same distance, LOD 0/1/2 side by side (re-placed in a fan)
      const list = g.vehicles.list.slice(-9);
      list.forEach((v: any, i: number) => { const row = Math.floor(i / 3), col = i % 3; v.phys.teleport(ox + dist + row * 7, 0.6, oz - 6 + col * 6, Math.PI / 2 + 0.6); v.settleParked(0); });
      g.frame(1 / 30, false);
      cam.position.set(ox, 1.6, oz); cam.lookAt(ox + dist + 7, 0.8, oz); cam.updateMatrixWorld(true);
      cam.fov = 62 * 18 / dist; cam.updateProjectionMatrix(); // same screen size at each distance
      list.forEach((v: any, i: number) => { v.lod = -1; v.setLod(i % 3); });
      g.renderer.render(); g.renderer.render();
      cam.fov = 62; cam.updateProjectionMatrix();
      return { cam: cam.position.toArray(), vs: list.map((v: any) => [v.kind, v.lod, v.position.x.toFixed(1), v.position.z.toFixed(1), v.group.visible]) };
    }, dist).then(r => console.log('DBG', JSON.stringify(r)));
    await page.screenshot({ path: `${OUT}/${TAG}-lods-${dist}.png` });
  }
});
