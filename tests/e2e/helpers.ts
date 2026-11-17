import { expect, type Page } from '@playwright/test';

export interface Problems { errors: string[]; failed: string[] }
/** Collects console errors/warnings, page errors and failed requests. */
export function watch(page: Page): Problems {
  const p: Problems = { errors: [], failed: [] };
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') p.errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => p.errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => p.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) p.failed.push(`${r.status()} ${r.url()}`); });
  return p;
}
/** Boots straight into a new game (skipping the title) and stops the rAF loop so tests drive time. */
export async function boot(page: Page, query = '') {
  await page.goto(`./?autostart=1${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __meridian?: unknown }).__meridian, null, { timeout: 180_000 });
  await page.evaluate(() => { const g = (window as any).__game; g.stop(); });
}
/** Advances the game by `seconds` of game time without rendering (fast), optionally holding keys. */
export async function step(page: Page, seconds: number, opts: { hold?: string[]; render?: boolean; dt?: number } = {}) {
  await page.evaluate(({ seconds, hold, render, dt }) => {
    const g = (window as any).__game;
    for (const k of hold) g.input.press(k);
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) g.frame(dt, render && i === n - 1);
    for (const k of hold) g.input.release(k);
  }, { seconds, hold: opts.hold ?? [], render: opts.render ?? false, dt: opts.dt ?? 1 / 30 });
}
/** Removes AI traffic and pedestrians and stops new ones spawning, so scripted drives can't randomly hit someone. */
export async function quietStreets(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.trafficCap = 0; g.pedCap = 0;
    for (const c of [...g.traffic.cars]) if (!c.persistent) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); }
    for (const v of [...g.vehicles.list]) if (!v.persistent && !v.driver) g.vehicles.remove(v);
    for (const n of [...g.pop.npcs]) if (!n.persistent && !n.char.inVehicle) g.pop.remove(n);
  });
}
export async function tap(page: Page, code: string) {
  await page.evaluate(code => { const g = (window as any).__game; g.input.tap(code); g.frame(1 / 30, false); }, code);
}
export async function state<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(fn) as Promise<T>;
}
export function clean(p: Problems) {
  expect(p.errors, p.errors.join('\n')).toEqual([]);
  expect(p.failed, p.failed.join('\n')).toEqual([]);
}
