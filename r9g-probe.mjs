import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://127.0.0.1:5211/astratest/?autostart=1');
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 280000 });
await p.evaluate(() => window.__game.stop());
const run = (blood, weapon) => p.evaluate(({ blood, weapon }) => {
  const g = window.__game, V = g.player.pos.constructor; g.settings.blood = blood; g.frame(1/30, false); g.blood.clear();
  g.player.place(-250, 0.25, -80, 0);
  const ns = [-1, 0, 1].map(i => { const n = g.pop.spawn('civilian', -250 + i * 1.5, -74, 0.25); n.brain = 'scripted'; n.persistent = true; n.char.yaw = Math.PI; return n; });
  for (let i = 0; i < 10; i++) g.frame(1/30, false);
  g.pcombat.give(weapon, 90); g.pcombat.inv.select(weapon);
  const info = g.renderer.renderer.info;
  let frames = 0, maxC = 0, maxT = 0;
  const tick = () => { g.frame(1/30, false); g.renderer.render(); frames++; maxC = Math.max(maxC, info.render.calls); maxT = Math.max(maxT, info.render.triangles); };
  for (let i = 0; i < 6; i++) tick();
  const base = performance.now(); const n0 = frames;
  for (let k = 0; k < 20; k++) { const n = ns[k % 3]; n.char.human.model.updateMatrixWorld(true); const t = n.pos.clone().setY(n.pos.y + 1.1); const from = new V(-250, t.y, -78.5), d = t.clone().sub(from).normalize(); g.combat.shoot(g.player, g.pcombat.inv.def, from, d, 0); tick(); tick(); }
  for (let i = 0; i < 30; i++) tick();
  return { blood, weapon, frameMs: +((performance.now() - base) / (frames - n0)).toFixed(1), maxCalls: maxC, maxTris: maxT, programs: info.programs?.length, splats: g.blood.splatCount, pieces: g.blood.pieceCount, bleeders: g.blood.bleeders.length };
}, { blood, weapon });
for (const [bl, w] of (process.argv[2] ?? 'false:pistol,true:pistol').split(',').map(x => x.split(':'))) { const t = Date.now(); console.log(JSON.stringify(await run(bl === 'true', w)), Date.now() - t, 'ms'); }
await b.close();
