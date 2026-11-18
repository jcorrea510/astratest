// usage: node shots.mjs <port> <outdir> <prefix> <shotsJSON>
import { chromium } from '@playwright/test';
const [,, port, outdir, prefix, shotsJson] = process.argv;
const shots = JSON.parse(shotsJson);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
p.on('pageerror', e => errs.push('PAGEERR ' + e.message + ' ' + (e.stack || '').slice(0, 600)));
const t0 = Date.now();
await p.goto(`http://127.0.0.1:${port}/astratest/?autostart=1`);
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 240000 });
console.log('boot ms', Date.now() - t0);
await p.evaluate(() => { window.__game.stop(); });
await p.addStyleTag({ content: '.ma-root { visibility: hidden !important; }' }).catch(() => {});
for (const s of shots) {
  const r = await p.evaluate((s) => {
    const g = window.__game; g.hour = s.hour; g.clockRunning = false;
    g.trafficCap = s.traffic ?? g.trafficCap;
    if (s.player) { g.player.place(s.player[0], s.player[1] ?? 1, s.player[2], s.yaw ?? 0); }
    if (s.yaw !== undefined) { g.cam.yaw = s.yaw; g.cam.pitch = s.pitch ?? -0.05; }
    for (let i = 0; i < (s.frames ?? 30); i++) g.frame(1 / 30, false);
    if (s.cam) {
      const c = g.renderer.camera; c.position.set(...s.cam); c.lookAt(...s.look); c.updateMatrixWorld();
      g.renderer.updateEnvironment(g.hour, g.time, new (c.position.constructor)(...s.look));
      g.cullChunks?.();
    }
    g.renderer.render();
    if (s.cam) { const c = g.renderer.camera; c.position.set(...s.cam); c.lookAt(...s.look); c.updateMatrixWorld(); }
    g.renderer.render();
    return { ...g.renderer.stats };
  }, s);
  await p.screenshot({ path: `${outdir}/${prefix}-${s.name}.jpg`, type: 'jpeg', quality: 82 });
  console.log(s.name, JSON.stringify(r));
}
console.log(errs.slice(0, 12).join('\n'));
await b.close();
