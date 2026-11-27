import { test, expect } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Regression: car bodies went invisible (only lights showed). A dented car shares attributes with its template whose CPU
 *  arrays are freed after upload; disposing the dented copy dropped the shared GPU buffers and they re-uploaded empty. */
test('dented cars can be removed without emptying the shared body buffers', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page, '&quality=low'); // boots on the preset it runs on: a high-preset boot plus the test ran right at the 4 min limit on CI
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.renderer.setQuality('low'); // 11 drawn frames in software GL: on high they ran past the 4 min limit on CI (the buffer bug does not depend on the preset)
    const gl: WebGL2RenderingContext = g.renderer.renderer.getContext();
    let empty = 0, armed = false;
    const orig = gl.bufferData.bind(gl) as (...a: unknown[]) => void;
    (gl as any).bufferData = (...a: unknown[]) => { const d = a[1] as { byteLength?: number } | number; if (armed && (typeof d === 'number' ? d === 0 : d?.byteLength === 0)) empty++; return orig(...a); };
    const p = g.player.pos;
    const mk = () => g.vehicles.spawn('sedan', p.x + 8, p.z + 8, 0, -1, p.y + 0.4);
    const a = mk();
    for (let f = 0; f < 4; f++) g.frame(1 / 30, true);
    a.damage(200, a.position.clone().add({ x: 0, y: 0.5, z: 2 } as any), undefined);
    for (let f = 0; f < 3; f++) g.frame(1 / 30, true);
    const dented = a.ownGeo;
    g.vehicles.remove(a);
    const b = mk();
    armed = true;
    for (let f = 0; f < 4; f++) g.frame(1 / 30, true);
    const sphere = b.bodyMesh.boundingSphere;
    return { empty, radius: sphere.radius, dented };
  });
  expect(r.dented, 'damage must deform the body').toBe(true);
  expect(r.empty).toBe(0);
  expect(r.radius).toBeGreaterThan(1);
});
