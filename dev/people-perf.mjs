// Draw calls / triangles with and without a crowd of 30 people in view. Usage: node dev/people-perf.mjs [port]
import { chromium } from '@playwright/test';
const port = process.argv[2] || 5299;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://127.0.0.1:${port}/astratest/?autostart=1`);
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 240000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const g = window.__game; g.stop(); g.pedCap = 0; g.trafficCap = 0;
  for (const n of [...g.pop.npcs]) if (!n.persistent) g.pop.remove(n);
  const R = g.renderer.renderer; R.info.autoReset = false;
  const meas = () => { g.frame(1 / 30, false); R.info.reset(); g.renderer.render(); return { calls: R.info.render.calls, tris: R.info.render.triangles }; };
  const before = meas();
  const P = g.player.pos, f = { x: Math.sin(g.player.yaw), z: Math.cos(g.player.yaw) };
  for (let i = 0; i < 30; i++) { const d = 4 + (i % 10) * 3, s = (Math.floor(i / 10) - 1) * 2.5; g.pop.spawn('civilian', P.x + f.x * d + f.z * s, P.z + f.z * d - f.x * s).brain = 'idle'; }
  g.cam.yaw = g.player.yaw + Math.PI; for (let k = 0; k < 10; k++) g.frame(1 / 30, false);
  const t0 = performance.now(); for (let k = 0; k < 30; k++) g.frame(1 / 30, false); const ms = (performance.now() - t0) / 30;
  return { before, after: meas(), npcs: g.pop.npcs.length, updateMsPerFrame: ms.toFixed(2) };
})));
await b.close();
