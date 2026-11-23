// CPU profile per subsystem while driving on Low (sim + optional render). node .fprobe.mjs [quality] [frames]
import { chromium } from 'playwright';
const q = process.argv[2] || 'low', N = +(process.argv[3] || 600);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] }); const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto('http://localhost:5199/astratest/?autostart=1');
await p.waitForFunction(() => !!window.__meridian, null, { timeout: 400000 });
const r = await p.evaluate(({ q, N }) => {
  const g = window.__game; g.stop(); g.renderer.setQuality(q); g.hour = 12; g.clockRunning = false;
  const T = {};
  const wrap = (obj, name, label) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t0 = performance.now(); const r = f(...a); const d = performance.now() - t0; (T[label] ??= []).push(d); return r; }; };
  const W = [[g.traffic, 'fixedUpdate', 'traffic.fixed'], [g.traffic, 'update', 'traffic.update'], [g.pop, 'update', 'pop.update'], [g.pop, 'fixedUpdate', 'pop.fixed'], [g.crowd, 'update', 'crowd.update'], [g.vehicles, 'update', 'vehicles.update'], [g.vehicles, 'postStep', 'vehicles.post'], [g.physics, 'step', 'physics.step'], [g.police, 'update', 'police.update'], [g, 'fixedUpdate', 'FIXED total'], [g, 'update', 'UPDATE total'], [g.renderer, 'render', 'render'], [g.combat, 'update', 'combat'], [g.particles, 'update', 'particles'], [g.ragdolls, 'update', 'ragdolls'], [g.helis, 'update', 'helis'], [g.buses, 'update', 'buses'], [g.cam, 'update', 'cam'], [g.pcombat, 'update', 'pcombat'], [g.pop, 'warmStep', 'pop.warm'], [g.renderer, 'updateEnvironment', 'env']];
  for (const [o, n, l] of W) if (o && typeof o[n] === 'function') wrap(o, n, l);
  // drive a car down an avenue
  const car = g.vehicles.spawn('sedan', -41, 40, Math.PI, -1, 0.6); car.persistent = true;
  g.enterVehicle ? g.enterVehicle(car) : null;
  g.player.place(-41, 0.25, 40, Math.PI);
  for (let i = 0; i < 300; i++) g.frame(1 / 60, false);
  for (const k in T) T[k] = [];
  const frames = [];
  for (let i = 0; i < N; i++) {
    g.player.place(-41, 0.25, 40 - i * 0.25, Math.PI);
    const draw = i % 20 === 19;
    const t0 = performance.now(); g.frame(1 / 60, draw); if (!draw) frames.push(performance.now() - t0);
  }
  const out = {}; for (const k in T) { const a = T[k]; if (!a.length) continue; const s = [...a].sort((x, y) => x - y); out[k] = { avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(1), n: a.length }; }
  frames.sort((a, b) => a - b);
  out.FRAME = { avg: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2), p95: +frames[Math.floor(frames.length * 0.95)].toFixed(2), max: +frames[frames.length - 1].toFixed(1) };
  out.counts = { cars: g.vehicles.list.length, ai: g.traffic.cars.length, npcs: g.pop.npcs.length };
  return out;
}, { q, N });
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(18), JSON.stringify(v)); await b.close();
