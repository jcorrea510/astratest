import { chromium } from '@playwright/test';
const [url, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.on('console', m => console.log('console', m.type(), m.text()));
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(url); await p.waitForFunction(() => document.title === 'ready', null, { timeout: 60000 });
console.log(JSON.stringify(await p.evaluate(() => window.info)));
await p.screenshot({ path: out }); await b.close();
