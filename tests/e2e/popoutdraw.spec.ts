import { test, expect } from '@playwright/test';
import { watch, boot, quietStreets, clean } from './helpers';
import config from '../../playwright.config';

/** Regression: people and cars used to vanish as the camera got close (culling + far-crowd despawn). */
// Its own browser: after this test's many software-GL renders, the next test's browser.newContext timed out at 240 s
// (popout far-crowd test, main run 27 Nov, twice). A distinct launch option gives this file its own worker and browser.
const base = config.use?.launchOptions ?? {};
test.use({ launchOptions: { ...base, args: [...(base.args ?? []), '--popoutdraw-own-browser'] } });

test('a pedestrian and a car 3-6 m from the camera are actually drawn at several camera angles', async ({ page }) => {
  test.setTimeout(400_000);
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, cam = g.renderer.camera;
    g.clockRunning = false; g.hour = 12;
    const out: any[] = [];
    g.player.place(-41, 0.25, 9, 0);
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    // flag set only when three actually submits the object to the GPU (i.e. survived frustum culling)
    const watchMesh = (m: any) => { m.userData.drawn = false; m.onBeforeRender = () => { m.userData.drawn = true; }; };
    const ped = g.pop.spawn('civilian', 0, 0, 0.2); ped.persistent = true; ped.brain = 'scripted'; watchMesh(ped.char.human.mesh);
    const car = g.vehicles.spawn('sedan', 0, 0, 0); car.persistent = true; watchMesh(car.bodyMesh);
    for (const yawOff of [0, 0.5, -0.5, 1.0, -1.0]) for (const dist of [3, 4.5, 6]) {
      g.player.place(-41, 0.25, 9, yawOff);
      for (let i = 0; i < 6; i++) g.frame(1 / 30, false);
      g.frame(1 / 30, true); // settle the camera + matrices
      const f = cam.getWorldDirection(cam.position.clone()); f.y = 0; f.normalize();
      const at = (k: number, side: number) => ({ x: cam.position.x + f.x * k - f.z * side, z: cam.position.z + f.z * k + f.x * side });
      const a = at(dist, 0.6), b = at(dist + 2.5, -1.6);
      ped.char.phys?.teleport?.(a.x, 0.9, a.z); ped.char.pos.set(a.x, 0.2, a.z); ped.char.human.root.position.copy(ped.char.pos);
      car.phys.teleport(b.x, 0.6, b.z, Math.atan2(f.x, f.z) + Math.PI / 2);
      ped.char.human.mesh.userData.drawn = false; car.bodyMesh.userData.drawn = false;
      g.pop.update(1 / 60, cam, g.player.pos, 40);
      g.renderer.render();
      out.push({ yawOff, dist, ped: ped.char.human.mesh.userData.drawn, pedVisible: ped.char.human.mesh.visible, car: car.bodyMesh.userData.drawn });
    }
    return out;
  });
  const bad = r.filter((x: any) => !x.ped || !x.car);
  expect(bad, JSON.stringify(bad)).toEqual([]);
  clean(p);
});
