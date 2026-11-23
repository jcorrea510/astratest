import { chromium } from 'playwright';
const errs = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 900, height: 600 } });
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await p.goto('http://localhost:5199/astratest/?autostart=1');
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 400000 });
await p.evaluate(() => {
  const g = window.__game; g.stop(); g.hour = 13; g.clockRunning = false;
  g.player.place(-250, 0.25, -80, 0);
  const n = g.pop.spawn('civilian', -250, -76, 0.25); n.brain = 'surrender'; n.stateT = 0; n.waitT = 99; n.persistent = true; n.char.human.applyLook({ ...n.char.human.look, topStyle: 'longsleeve', pattern: 'camo', top: '#66764a', accent: '#3d3f45', bottomStyle: 'jeans' });
  for (let f = 0; f < 50; f++) g.frame(1 / 30, false);
  window.__n = n;
});
for (const [i, yaw] of [[0, 0.4], [1, 2.2]]) {
  await p.evaluate((yaw) => { const g = window.__game, n = window.__n; const c = g.renderer.camera, f = n.pos.clone(); f.y += 1.1; c.position.set(f.x + Math.sin(yaw) * 3.2, f.y + 0.4, f.z + Math.cos(yaw) * 3.2); c.lookAt(f); c.updateMatrixWorld(true); n.char.human.mesh.visible = true; g.renderer.render(); }, yaw);
  await p.screenshot({ path: `/tmp/claude-0/hands${i}.png` });
}
console.log('errors', JSON.stringify(errs.slice(0, 3))); await b.close();
