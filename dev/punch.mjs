// Debug: frame trace of a three-punch combo on a scripted civilian. Usage: node dev/punch.mjs [port]
import { chromium } from '@playwright/test';
const port = process.argv[2] || 5299;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto(`http://127.0.0.1:${port}/astratest/?autostart=1`);
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 240000 });
console.log(await p.evaluate(() => {
  const g = window.__game; g.stop(); const c = g.player;
  c.place(-300, 0.05, -102, 0); g.cam.yaw = Math.PI; c.yaw = 0;
  const n = g.pop.spawn('civilian', c.pos.x, c.pos.z + 0.9); n.persistent = true; n.brain = 'scripted';
  const out = [];
  for (let i = 0; i < 3; i++) {
    g.input.tap('Mouse0');
    for (let k = 0; k < 14; k++) { g.frame(1 / 30, false); out.push(`${i}.${k} ${c.human.actionName} hp${n.char.health.toFixed(0)} d${Math.hypot(n.pos.x - c.pos.x, n.pos.z - c.pos.z).toFixed(2)} inv${g.pcombat.inv.current}`); }
  }
  return out.join('\n');
}));
await b.close();
