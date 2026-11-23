import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://127.0.0.1:5211/astratest/?autostart=1');
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 280000 });
await p.evaluate(() => window.__game.stop());
for (let k = 0; k < 24; k++) console.log(k, await Promise.race([p.evaluate((k) => {
  const g = window.__game, V = g.player.pos.constructor; g.settings.blood = true; g.frame(1/30, false);
  if (k === 0) { g.player.place(-250, 0.25, -80, 0); window.__ns = [-1, 0, 1].map(i => { const n = g.pop.spawn('civilian', -250 + i * 1.5, -74, 0.25); n.brain = 'scripted'; n.persistent = true; n.char.yaw = Math.PI; return n; }); for (let i = 0; i < 10; i++) g.frame(1/30, false); g.pcombat.give('pistol', 90); g.pcombat.inv.select('pistol'); }
  const t0 = performance.now(); const n = window.__ns[k % 3]; const t = n.pos.clone().setY(n.pos.y + (n.alive ? 1.1 : 0.15)); const from = new V(-250, t.y, -78.5), d = t.clone().sub(from).normalize();
  g.combat.shoot(g.player, g.pcombat.inv.def, from, d, 0); const t1 = performance.now(); g.frame(1/30, false); const t2 = performance.now(); g.renderer.render(); const t3 = performance.now();
  return [t1 - t0, t2 - t1, t3 - t2].map(x => Math.round(x));
}, k), new Promise(r => setTimeout(() => r('TIMEOUT'), 40000))]));
await b.close(); process.exit(0);
