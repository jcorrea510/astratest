import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 900, height: 600 } });
await p.goto('http://localhost:5199/astratest/?autostart=1');
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 400000 });
await p.evaluate(() => {
  const g = window.__game; g.stop(); g.hour = 13; g.clockRunning = false;
  g.player.place(-250, 0.25, -80, 0);
  const n = g.pop.spawn('civilian', -250, -76, 0.25); n.brain = 'surrender'; n.stateT = 0; n.waitT = 99; n.persistent = true;
  for (let f = 0; f < 50; f++) g.frame(1 / 30, false);
  window.__n = n;
});
for (const [i, yaw] of [[0, 0.4], [1, 2.2]]) {
  await p.evaluate((yaw) => { const g = window.__game, n = window.__n; const c = g.renderer.camera, f = n.pos.clone(); f.y += 1.1; c.position.set(f.x + Math.sin(yaw) * 3.2, f.y + 0.4, f.z + Math.cos(yaw) * 3.2); c.lookAt(f); c.updateMatrixWorld(true); n.char.human.mesh.visible = true; g.renderer.render(); }, yaw);
  await p.screenshot({ path: `/tmp/claude-0/hands${i}.png` });
}
await b.close();
