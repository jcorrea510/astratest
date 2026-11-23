import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 800, height: 500 } });
await p.goto('http://localhost:5199/astratest/?autostart=1');
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 400000 });
await p.evaluate(() => {
  const g = window.__game, R = window.__meridian.activities.robberies; g.stop(); g.hour = 13; g.clockRunning = false;
  const k = R.kiosks.find(k => k.def.kind === 'bank'); window.__k = k;
  const pp = k.frame.toWorld(0, 0.3, 2.5); g.player.place(pp.x, pp.y, pp.z, 0);
  for (let f = 0; f < 60; f++) g.frame(1 / 30, false);
  k.shell.root.visible = true;
});
const views = { lobby: [[0.5, 1.7, 1.5], [2.9, 1.5, -3.5]], inside: [[2.9, 1.6, -3.0], [2.9, 1.4, -6]], side: [[-1.5, 1.6, -3.2], [3, 1.5, -3.6]], back: [[2.9, 1.6, -3.6], [2.9, 1.6, 2]] };
for (const [name, [from, to]] of Object.entries(views)) {
  await p.evaluate(({ from, to }) => { const g = window.__game, k = window.__k, c = g.renderer.camera; const a = k.frame.toWorld(...from), t = k.frame.toWorld(...to); c.position.copy(a); c.lookAt(t); c.updateMatrixWorld(true); g.renderer.render(); }, { from, to });
  await p.screenshot({ path: `/tmp/claude-0/vault-${name}.png` });
}
await b.close();
