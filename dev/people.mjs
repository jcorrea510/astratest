// Renders people with the standalone viewer (dev/people.html). Usage: node dev/people.mjs <out.jpg> <script.js>
// The script is evaluated in the page with `P` = window.__people (see dev/people-harness.ts).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [out, scriptFile] = process.argv.slice(2);
const port = process.env.PW_PORT || 5199;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || m.type() === 'log') logs.push(`${m.type()}: ${m.text()}`); });
p.on('pageerror', e => logs.push('pageerror: ' + e.message));
await p.goto(`http://localhost:${port}/astratest/dev/people.html`);
await p.waitForFunction(() => document.title === 'ready', null, { timeout: 240000 }).catch(() => {});
const src = fs.readFileSync(scriptFile, 'utf8');
const res = await p.evaluate(`(async () => { const P = window.__people; ${src} })()`).catch(e => 'ERR ' + e.message);
if (res !== undefined) console.log(JSON.stringify(res));
await p.screenshot({ path: out, type: out.endsWith('.png') ? 'png' : 'jpeg', quality: 85 });
console.log(logs.slice(0, 20).join('\n'));
await b.close();
