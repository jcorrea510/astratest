// Debug: per-frame trace of the player crossing curbs. Usage: node dev/curb.mjs [port]
import { chromium } from '@playwright/test';
const port = process.argv[2] || 5299;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto(`http://127.0.0.1:${port}/astratest/?autostart=1`);
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 240000 });
const r = await p.evaluate(() => {
  const g = window.__game; g.stop(); g.trafficCap = 0; g.pedCap = 0;
  for (const n of [...g.pop.npcs]) if (!n.persistent && !n.char.inVehicle) g.pop.remove(n);
  const out = []; const c = g.player;
  const clear = (x, z, dx, dz, len) => { for (const h of [0.5, 1.2]) if (g.physics.ray(x, h, z, dx, 0, dz, len, undefined, c.collider)) return false; return true; };
  const spots = [];
  for (const b of g.city.blocks) { if (spots.length >= 8) break; if (b.kind !== 'buildings' && b.kind !== 'park') continue;
    const mz = (b.z0 + b.z1) / 2 + 3, mx = (b.x0 + b.x1) / 2 + 3;
    for (const s of [{ x: b.x0 - 3.5, z: mz, yaw: Math.PI / 2, up: true }, { x: mx - 2, z: b.z0 - 3.5, yaw: 0.6, up: true }, { x: b.x1 - 1.5, z: mz - 4, yaw: Math.PI / 2, up: false }]) if (clear(s.x, s.z, Math.sin(s.yaw), Math.cos(s.yaw), 7)) spots.push(s); }
  for (const [i, s] of spots.slice(0, 6).entries()) {
    c.place(s.x, s.up ? 0.05 : 0.25, s.z, s.yaw); g.cam.yaw = s.yaw - Math.PI; for (let k = 0; k < 3; k++) g.frame(1 / 30, false);
    g.input.press('KeyW'); if (i % 2 === 0) g.input.press('ShiftLeft');
    let prev = { x: c.pos.x, z: c.pos.z }; const tr = [];
    for (let k = 0; k < 45; k++) { g.cam.yaw = s.yaw - Math.PI; g.frame(1 / 30, false); const st = Math.hypot(c.pos.x - prev.x, c.pos.z - prev.z); prev = { x: c.pos.x, z: c.pos.z }; tr.push(`${k}:${st.toFixed(3)}/${c.pos.y.toFixed(2)}${c.grounded ? 'g' : 'a'}`); }
    g.input.release('KeyW'); g.input.release('ShiftLeft');
    out.push(i + ' ' + JSON.stringify(s) + '\n' + tr.join(' '));
  }
  return out.join('\n');
});
console.log(r);
await b.close();
