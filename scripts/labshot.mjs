// Screenshot the dev lab page: node scripts/labshot.mjs "<query>" out.jpg [port]
// Serialised with a lock file so only one or two headless browsers run at a time on this small machine.
import { chromium } from '@playwright/test';
import { openSync, closeSync, unlinkSync, existsSync, statSync } from 'node:fs';
const [query = 'mode=gun&id=rifle', out = 'lab.jpg', port = process.env.PW_PORT ?? '5199'] = process.argv.slice(2);
const slots = ['/tmp/labshot.0.lock', '/tmp/labshot.1.lock'];
let lock = null;
for (let t = 0; !lock && t < 1800; t++) {
  for (const s of slots) {
    try { if (existsSync(s) && Date.now() - statSync(s).mtimeMs > 240000) unlinkSync(s); closeSync(openSync(s, 'wx')); lock = s; break; } catch { /* busy */ }
  }
  if (!lock) await new Promise(r => setTimeout(r, 500));
}
try {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.error('pageerror:', e.message));
  await p.goto(`http://localhost:${port}/astratest/src/lab/index.html?${query}`);
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  await p.screenshot({ path: out, type: out.endsWith('.png') ? 'png' : 'jpeg', quality: out.endsWith('.png') ? undefined : 85 });
  console.log(JSON.stringify(await p.evaluate(() => window.__info)));
  await b.close();
} finally { if (lock) unlinkSync(lock); }
