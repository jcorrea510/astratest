import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { boot, quietStreets } from './helpers';
const OUT = '/tmp/claude-0/-home-user-astratest/d1ebd1cb-1eba-5496-ba2a-bb23f33ded71/scratchpad/shots';
const TAG = process.env.SHOT_TAG ?? 'far';
test('far car models up close', async ({ page }) => {
  test.setTimeout(900_000);
  page.on('console', m => { if (m.text().startsWith('DBG')) console.log(m.text()); });
  await boot(page);
  await quietStreets(page);
  for (const [set, L] of [[['sedan', 'suv', 'hatch', 'pickup', 'van'], 1], [['sedan', 'suv', 'hatch', 'pickup', 'van'], 2], [['bus', 'police', 'muscle', 'super', 'wagon'], 1]] as [string[], number][]) {
    await page.evaluate(({ set, L }) => {
      const g = (window as any).__game, cam = g.renderer.camera; g.stop();
      g.renderer.setQuality('high'); g.clockRunning = false; g.hour = 13;
      for (const c of [...g.traffic.cars]) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); }
      for (const v of [...g.vehicles.list]) if (v.position.distanceTo(g.player.pos) < 300) g.vehicles.remove(v);
      g.buses.spawnT = 1e9; g.crowd.clear(); g.crowd.freeze = true; g.trafficCap = 0; g.pedCap = 0;
      const ox = -45, oz = 3.2;
      g.player.place(ox - 40, 0.25, oz, Math.PI / 2); for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
      const Col = g.renderer.sun.color.constructor;
      const far = g.crowd.far; far.warm(set);
      set.forEach((k: string, i: number) => { const v = g.vehicles.spawn(k, ox + 22, oz - 10 + i * 5, Math.PI / 2 + 0.7); v.settleParked(0); v.__made = true; });
      g.frame(1 / 30, false); g.crowd.clear();
      cam.position.set(ox, 2.2, oz); cam.lookAt(ox + 14, 0.8, oz); cam.fov = 62; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      far.begin(cam);
      set.forEach((k: string, i: number) => far.add(k, ox + 13, 0, oz - 10 + i * 5, Math.PI / 2 + 0.7, new Col(0.3 - i * 0.05, 0.05 + i * 0.05, 0.08), false, false));
      far.end(0);
      for (const v of g.vehicles.list) if (v.__made) { v.lod = -1; v.setLod(L); }
      g.renderer.render();
      console.log('DBG', JSON.stringify(g.vehicles.list.filter((v: any) => v.__made).map((v: any) => { const t = v.tpl, wb = v.bones[t.wheelBones[0]]; const wp = wb.getWorldPosition(cam.position.clone()); return { k: v.kind, gy: +v.group.position.y.toFixed(3), wheelY: +wp.y.toFixed(3), R: t.shape.R, tplWheelY: t.bones[t.wheelBones[0]].pos[1], restY: +far.kinds.get(v.kind)?.restY.toFixed(3), lod: v.lod }; })));
      return (g.renderer.renderer.domElement as HTMLCanvasElement).toDataURL('image/png');
    }, { set, L }).then(u => writeFileSync(`${OUT}/${TAG}-${set[0]}-${L}.png`, Buffer.from(u.split(',')[1], 'base64')));
  }
});
