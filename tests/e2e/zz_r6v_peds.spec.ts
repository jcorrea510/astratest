import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { boot, quietStreets } from './helpers';
const OUT = '/tmp/claude-0/-home-user-astratest/d1ebd1cb-1eba-5496-ba2a-bb23f33ded71/scratchpad/shots';
const TAG = process.env.SHOT_TAG ?? 'peds';
test('ped lods', async ({ page }) => {
  test.setTimeout(900_000);
  await boot(page);
  await quietStreets(page);
  for (const [dist, fov, hour] of [[9, 40, 13], [9, 40, 13.002], [40, 62, 13], [30, 62, 21]] as const) {
    await page.evaluate(({ dist, fov, hour }) => {
      const g = (window as any).__game, cam = g.renderer.camera; g.stop();
      g.renderer.setQuality('high'); g.clockRunning = false; g.hour = hour;
      for (const c of [...g.traffic.cars]) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); }
      for (const v of [...g.vehicles.list]) if (v.position.distanceTo(g.player.pos) < 300) g.vehicles.remove(v);
      for (const n of [...g.pop.npcs]) if (n.__made) g.pop.remove(n);
      g.buses.spawnT = 1e9; g.crowd.clear(); g.crowd.freeze = true; g.trafficCap = 0; g.pedCap = 0;
      const ox = -45, oz = 3.2;
      g.player.place(ox - 30, 0.25, oz, Math.PI / 2); for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
      const looks = [11, 22, 33];
      // left to right: real lod 0 / 1 / 2 of person A, then far-crowd copies of A (standing, walking), then real B / crowd B walking
      const xs = [-3.2, -1.9, -0.6, 0.7, 2.0, 3.3, 4.6];
      const nd = g.city.pedNodes[0];
      const mk = (i: number, look: any, lod: number) => { const n = g.pop.spawn('civilian', ox + dist, oz + xs[i], 0.2, look); n.__made = true; n.persistent = true; n.brain = 'scripted'; n.char.yaw = -Math.PI / 2; n.__lod = lod; return n; };
      const a0 = mk(0, undefined, 0), a1 = mk(1, a0.char.human.look, 1), a2 = mk(2, a0.char.human.look, 2), b = mk(5, undefined, 1); void looks;
      const pushP = (i: number, lk: any, speed: number) => g.crowd.peds.push({ from: nd.id, to: nd.edges[0].to, t: 0, speed, wait: speed ? 0 : 99, off: 0, look: 0, x: ox + dist, z: oz + xs[i], y: -0.18, yaw: -Math.PI / 2, tint: 0, tint2: 0, skin: 0, phase: 0.1 * i, lk, road: true });
      pushP(3, a0.char.human.look, 0); pushP(4, a0.char.human.look, 1.3); pushP(6, b.char.human.look, 1.3);
      for (let i = 0; i < 4; i++) g.frame(1 / 30, false);
      for (const n of [a0, a1, a2, b]) { n.char.human.setBodyLod?.(n.__lod); n.char.human.setDetail(true); n.char.human.mesh.visible = true; }
      cam.position.set(ox, 1.3, oz + 0.7); cam.lookAt(ox + dist, 1.0, oz + 0.7); cam.fov = fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      g.renderer.render(); g.renderer.render();
      const url = (g.renderer.renderer.domElement as HTMLCanvasElement).toDataURL('image/png');
      cam.fov = 62; cam.updateProjectionMatrix();
      return url;
    }, { dist, fov, hour }).then(u => writeFileSync(`${OUT}/${TAG}-${dist}-${hour}.png`, Buffer.from(u.split(',')[1], 'base64')));
  }
});
