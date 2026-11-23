// counts shader programs compiled mid-game while touring the city (Low). node .sprobe.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 480, height: 270 } });
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto('http://localhost:5199/astratest/?autostart=1');
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 400000 });
const r = await p.evaluate(() => {
  const g = window.__game; g.stop(); g.renderer.setQuality('low'); g.hour = 21; g.clockRunning = false;
  const R = g.renderer.renderer; const progs = () => R.info.programs.length;
  for (let i = 0; i < 60; i++) g.frame(1 / 60, i % 10 === 9);
  const base = progs(), events = [];
  const pts = g.city.intersections.filter(i => i.signalized).filter((_, k) => k % 3 === 0).slice(0, 26);
  const T = {}; const wrap = (o, n) => { const f = o[n].bind(o); o[n] = (...a) => { const t0 = performance.now(); const r = f(...a); (T[n] ??= []).push(+(performance.now() - t0).toFixed(1)); return r; }; };
  const R2 = window.__meridian.activities?.robberies; if (R2) { const orig = R2.cull.bind(R2); }
  for (const I of pts) {
    g.player.place(I.x + I.halfX + 3, 0.25, I.z + I.halfZ + 3, Math.random() * 6);
    for (let i = 0; i < 40; i++) { const before = progs(); g.frame(1 / 60, i % 8 === 7); const after = progs(); if (after > before) { const np = new Set(R.info.programs.slice(before)); const who = []; g.renderer.scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) { const pr = R.properties.get(m)?.currentProgram; if (pr && np.has(pr)) { let q = o, path = []; while (q && path.length < 4) { path.push(q.name || q.type); q = q.parent; } who.push(m.type + ':' + (m.name || '') + '@' + path.join('<')); } } }); const list = [...new Set(who)]; events.push({ at: `${I.ix},${I.iz}`, n: after - before, names: list.join(' | ').slice(0, 400) }); } }
  }
  return { base, end: progs(), events: events.slice(0, 30) };
});
console.log(JSON.stringify(r, null, 1)); await b.close();
