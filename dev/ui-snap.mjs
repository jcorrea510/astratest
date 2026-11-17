// Usage: node dev/ui-snap.mjs <outdir> <WxH> "name:query[|js-to-eval]" ...
// Screenshots dev/ui-harness.html for each entry (waits for document.title === 'ready'); prints console errors.
import { chromium } from '@playwright/test';
const [outdir, size, ...entries] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const base = process.env.UI_BASE ?? 'http://127.0.0.1:5301/astratest/dev/ui-harness.html';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const mobile = W < 700;
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, reducedMotion: process.env.REDUCED ? 'reduce' : 'no-preference' });
for (const e of entries) {
  const [name, rest] = e.split(/:(.*)/s);
  const [query, js] = rest.split('|');
  const p = await ctx.newPage();
  const logs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', err => logs.push('pageerror: ' + err.message));
  p.on('requestfailed', r => logs.push('requestfailed: ' + r.url()));
  await p.goto(`${base}?${query}`);
  await p.waitForFunction(() => document.title === 'ready' || document.title === 'error', null, { timeout: 60000 });
  if (js) { const r = await p.evaluate(js); if (r !== undefined) console.log(name, 'result:', JSON.stringify(r)); await p.waitForTimeout(400); }
  await p.screenshot({ path: `${outdir}/ui-${name}.png` });
  console.log(name, (await p.title()), logs.length ? '\n  ' + logs.join('\n  ') : 'ok');
  await p.close();
}
await b.close();
