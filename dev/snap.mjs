// Usage: node dev/snap.mjs <url> <out.png> [script-js-evaluated-in-page]
import { chromium } from '@playwright/test';
const [url, out, script] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
p.on('console', m => { if (m.type() !== 'debug') logs.push(`${m.type()}: ${m.text()}`); });
p.on('pageerror', e => logs.push('pageerror: ' + e.message));
p.on('requestfailed', r => logs.push('requestfailed: ' + r.url()));
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => document.title === 'ready' || document.title === 'error' || (window.__meridian && window.__game && window.__game.time > 0), null, { timeout: 180000 });
console.log('loaded in', Date.now() - t0, 'ms', await p.title()); if ((await p.title()) === 'error') { console.log(await p.evaluate(() => document.querySelector('pre')?.textContent)); console.log(logs.join('\n')); }
if (script) { const r = await p.evaluate(script); if (r !== undefined) console.log('result:', JSON.stringify(r)); }
await p.screenshot({ path: out, timeout: 120000 });
console.log(logs.slice(0, 30).map(l => l.slice(0, 3000)).join('\n'));
await b.close();
