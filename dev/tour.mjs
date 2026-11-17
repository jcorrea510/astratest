import { chromium } from '@playwright/test';
const out = process.argv[2];
const shots = [
  ['morning', 8.2, -300, -96, 1.2, -0.08],
  ['noon-heights', 12.5, 0, -100, 2.2, -0.05],
  ['sunset-beach', 18.6, -120, 412, 1.0, -0.02],
  ['dusk-pier', 19.6, -50, 420, 0.2, 0.05],
  ['night-downtown', 22.5, 50, -150, 3.6, -0.06],
  ['night-docks', 1.5, 455, 140, 3.0, -0.1],
];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); }); p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:5199/astratest/?autostart=1&quality=high');
await p.waitForFunction(() => window.__meridian, null, { timeout: 180000 });
for (const [name, hour, x, z, yaw, pitch] of shots) {
  await p.evaluate(([hour, x, z, yaw, pitch]) => { const g = window.__game; g.stop(); g.hour = hour; g.player.place(x, 0.3, z, yaw); g.cam.snapBehind(yaw + Math.PI); for (let i = 0; i < 300; i++) g.frame(1 / 30, false); g.cam.yaw = yaw + Math.PI; g.cam.pitch = pitch; g.hour = hour; for (let i = 0; i < 3; i++) g.frame(1 / 30, false); g.frame(1/30); }, [hour, x, z, yaw, pitch]);
  await p.evaluate(() => document.querySelectorAll('.ma-root').forEach(e => e.style.visibility = 'hidden'));
  await p.screenshot({ path: `${out}/tour-${name}.png`, timeout: 120000 });
  await p.evaluate(() => document.querySelectorAll('.ma-root').forEach(e => e.style.visibility = ''));
}
console.log(errs.slice(0, 10).join('\n'));
await b.close();
