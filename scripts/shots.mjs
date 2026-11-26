// CI screenshot runner (no browser on the agents' machine). Reads docs/shots/request.json:
//   [{ "name": "guns-all", "lab": "mode=gun&all=1" },
//    { "name": "day-signal", "game": { "hour": 12, "player": [x, 1, z], "yaw": 0, "cam": [x,y,z], "look": [x,y,z], "frames": 30, "quality": "high" } }]
// "eval": a function body (args g = window.__game, M = window.__meridian) run first; its returned object may set player/cam/look.
// and writes docs/shots/out/<name>.jpg plus docs/shots/out/log.txt. Needs a dev server on PORT (default 5199).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const port = process.env.PORT ?? '5199';
const req = JSON.parse(readFileSync('docs/shots/request.json', 'utf8'));
mkdirSync('docs/shots/out', { recursive: true });
const log = [];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const labs = req.filter(r => r.lab), games = req.filter(r => r.game);
for (const r of labs) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => log.push(`${r.name} pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') log.push(`${r.name} console: ${m.text().slice(0, 300)}`); });
  try {
    await p.goto(`http://localhost:${port}/astratest/src/lab/index.html?${r.lab}`);
    await p.waitForFunction(() => window.__ready, null, { timeout: 240000 });
    await p.screenshot({ path: `docs/shots/out/${r.name}.jpg`, type: 'jpeg', quality: 85 });
    log.push(`${r.name} ok ${JSON.stringify(await p.evaluate(() => window.__info))}`);
  } catch (e) { log.push(`${r.name} FAILED ${e.message}`); }
  await p.close();
}
if (games.length) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => log.push(`game pageerror: ${e.message} ${(e.stack || '').slice(0, 400)}`));
  const q = games[0].game.quality ? `&quality=${games[0].game.quality}` : '';
  try {
    await p.goto(`http://localhost:${port}/astratest/?autostart=1${q}`);
    await p.waitForFunction(() => !!window.__meridian, null, { timeout: 300000 });
    await p.evaluate(() => { window.__game.stop(); });
    await p.addStyleTag({ content: '.ma-root { visibility: hidden !important; }' }).catch(() => {});
    for (const r of games) {
      const s = r.game;
      try {
        const st = await p.evaluate((s) => {
          const g = window.__game; g.hour = s.hour ?? 12; g.clockRunning = false;
          if (s.eval) Object.assign(s, (new Function('g', 'M', s.eval))(g, window.__meridian) || {}); // may set player / cam / look
          if (s.player) g.player.place(s.player[0], s.player[1] ?? 1, s.player[2], s.yaw ?? 0);
          if (s.yaw !== undefined) { g.cam.yaw = s.yaw; g.cam.pitch = s.pitch ?? -0.05; }
          for (let i = 0; i < (s.frames ?? 30); i++) g.frame(1 / 30, false);
          const c = g.renderer.camera;
          if (s.cam) { c.position.set(...s.cam); c.lookAt(...s.look); c.updateMatrixWorld(); g.renderer.updateEnvironment(g.hour, g.time, new (c.position.constructor)(...s.look)); g.cullChunks?.(); }
          g.renderer.render();
          if (s.cam) { c.position.set(...s.cam); c.lookAt(...s.look); c.updateMatrixWorld(); }
          g.renderer.render();
          return { ...g.renderer.stats };
        }, s);
        await p.screenshot({ path: `docs/shots/out/${r.name}.jpg`, type: 'jpeg', quality: 85 });
        log.push(`${r.name} ok ${JSON.stringify(st)}`);
      } catch (e) { log.push(`${r.name} FAILED ${e.message}`); }
    }
  } catch (e) { log.push(`game boot FAILED ${e.message}`); }
}
await b.close();
writeFileSync('docs/shots/out/log.txt', log.join('\n') + '\n');
console.log(log.join('\n'));
