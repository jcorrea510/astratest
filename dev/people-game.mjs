// In-game people shots: node dev/people-game.mjs <out.jpg> <mode: lineup|run|jump|crowd> [port]
import { chromium } from '@playwright/test';
const [out, mode = 'lineup', port = 5299] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = []; p.on('pageerror', e => logs.push('pageerror: ' + e.message));
await p.goto(`http://127.0.0.1:${port}/astratest/?autostart=1`);
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 240000 });
const info = await p.evaluate((mode) => {
  const g = window.__game; g.stop(); g.hour = 10.2; g.clockRunning = false; g.trafficCap = 0; g.pedCap = 0;
  for (const n of [...g.pop.npcs]) if (!n.persistent && !n.char.inVehicle) g.pop.remove(n);
  for (const c of [...g.traffic.cars]) if (!c.persistent) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); }
  for (const v of [...g.vehicles.list]) if (!v.persistent && !v.driver) g.vehicles.remove(v);
  for (const el of document.querySelectorAll('body *')) if (el !== g.canvas && !el.contains(g.canvas)) el.style.visibility = 'hidden';
  const P = g.player, cam = g.renderer.camera;
  const blk = g.city.blocks.filter(b => b.kind === 'buildings')[3];
  const x0 = (blk.x0 + blk.x1) / 2, z0 = blk.z1 - 2.2, y0 = 0.2;
  let res = {};
  if (mode === 'lineup') {
    const cs = g.debugLineup(12, 7);
    cs.forEach((c, i) => { c.place(x0 - 7.2 + i * 1.2 + (i >= 6 ? 1.3 : 0), y0, z0, 0); });
    P.place(x0 + 0.05, y0, z0 + 0.6, 0);
    for (let k = 0; k < 24; k++) { for (const c of cs) { c.human.setSpeed(0); c.updateVisual(1 / 30); } P.updateVisual(1 / 30); }
    g.frame(0.0001, false);
    cam.position.set(x0, y0 + 1.3, z0 + 6.4); cam.lookAt(x0, y0 + 0.95, z0);
    res = cs.map(c => `${c.human.look.sex} ${c.human.look.hairStyle} ${c.human.look.topStyle}`);
  } else {
    P.place(x0, y0, z0, Math.PI / 2); g.cam.yaw = -Math.PI / 2;
    g.input.press('KeyW'); g.input.press('ShiftLeft');
    for (let k = 0; k < 40; k++) { g.cam.yaw = -Math.PI / 2; g.frame(1 / 30, false); }
    if (mode === 'jump') { g.input.tap('Space'); for (let k = 0; k < 9; k++) { g.cam.yaw = -Math.PI / 2; g.frame(1 / 30, false); } }
    else for (let k = 0; k < 4; k++) { g.cam.yaw = -Math.PI / 2; g.frame(1 / 30, false); }
    g.input.release('KeyW'); g.input.release('ShiftLeft');
    const q = P.pos; cam.position.set(q.x + 0.5, q.y + 1.1, q.z + 3.6); cam.lookAt(q.x, q.y + 0.95, q.z);
    res = { state: P.human.currentState, speed: P.speed.toFixed(1), grounded: P.grounded };
  }
  g.renderer.render();
  return res;
}, mode);
console.log(JSON.stringify(info), logs.join('\n'));
await p.screenshot({ path: out, type: 'jpeg', quality: 85 });
await b.close();
