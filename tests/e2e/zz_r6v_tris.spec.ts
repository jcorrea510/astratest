import { test } from '@playwright/test';
test('tris breakdown', async ({ page }) => {
  test.setTimeout(900_000);
  await page.addInitScript(() => { let a = 12345; Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  await page.goto('./?autostart=1');
  await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 500_000 });
  await page.evaluate(() => (window as any).__game.stop());
  const r = await page.evaluate(() => {
    const g = (window as any).__game; g.renderer.setQuality('high'); g.clockRunning = false; g.hour = 12; g.trafficCap = null; g.pedCap = null;
    g.player.place(-41, 0.25, 9, 0);
    for (let i = 0; i < 240; i++) g.frame(1 / 30, false);
    const R = g.renderer.renderer, orig = R.renderBufferDirect.bind(R), acc: Record<string, [number, number]> = {};
    const keyOf = (o: any) => { let n = o.name, p = o.parent; while (!n && p) { n = p.name; p = p.parent; } return (n || o.type).split(/[:#0-9]/)[0] + (o.isSkinnedMesh ? '[skin]' : '') + (o.isInstancedMesh ? '[inst]' : ''); };
    R.renderBufferDirect = (cam: any, scene: any, geo: any, mat: any, obj: any, grp: any) => {
      const pass = cam.isOrthographicCamera ? 'shadow' : cam.isPerspectiveCamera ? 'main' : 'other';
      let tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3; if (grp) tris = grp.count / 3;
      if (obj.isInstancedMesh) tris *= obj.count; else if (geo.isInstancedBufferGeometry) tris *= geo.instanceCount;
      const k = pass + ' ' + keyOf(obj); acc[k] = acc[k] ?? [0, 0]; acc[k][0]++; acc[k][1] += tris;
      return orig(cam, scene, geo, mat, obj, grp);
    };
    g.frame(1 / 60, true);
    R.renderBufferDirect = orig;
    const rows = Object.entries(acc).sort((a, b) => b[1][1] - a[1][1]).slice(0, 30).map(([k, v]) => `${k}: ${v[0]} calls ${Math.round(v[1] / 1000)}k`);
    return { total: g.renderer.stats, rows, crowd: { peds: g.crowd.peds.length, cars: g.crowd.cars.length, drawnPeds: g.crowd.people?.drawn, drawnCars: g.crowd.far.drawn }, real: { peds: g.pop.npcs.length, veh: g.vehicles.list.length } };
  });
  console.log('TRIS', JSON.stringify(r, null, 1));
});
