import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

/** Round 7 (owner): a shot cashier still locked the till; a carted-off corpse got replaced by a fresh clerk; shoppers piled up at the door. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });
const SETUP = `(kind) => {
  const g = window.__game, R = window.__meridian.activities.robberies;
  const i = R.kiosks.findIndex(k => k.def.kind === kind), k = R.kiosks[i];
  g.police.clear(); g.money = 0; g.pcombat.give('pistol', 60); g.pcombat.inv.select('pistol');
  const out = k.frame.toWorld(3.1, 0.3, 9); g.player.place(out.x, out.y, out.z, 0);
  for (let f = 0; f < 8; f++) g.frame(1 / 30, false);
  const p = k.frame.toWorld(3.1, 0.3, 2.8); g.player.place(p.x, p.y, p.z, 0);
  for (let f = 0; f < 150; f++) g.frame(1 / 30, false);
  return i;
}`;

test('wounded (alive) cashier: the register can be emptied by hand; a removed corpse is not replaced while you are there', async () => {
  test.setTimeout(300_000);
  const r = await page.evaluate(({ SETUP }) => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
    const i = (eval(SETUP) as (k: string) => number)('convenience'), k = R.kiosks[i];
    k.brave = false;
    const c = k.clerk.char; c.damage(35, g.player, g.time); // shot, still alive
    for (let f = 0; f < 20; f++) g.frame(1 / 30, false);
    const alive = k.clerk?.alive;
    const rp = k.frame.toWorld(k.shell.register.lx, 0.3, k.frame.counterZ + 0.9); g.player.place(rp.x, rp.y, rp.z, 0);
    for (let f = 0; f < 10; f++) g.frame(1 / 30, false);
    const prompt = R.prompt();
    const m0 = g.money; g.input.press('KeyE');
    for (let f = 0; f < 30 * 5; f++) g.frame(1 / 30, false);
    g.input.release('KeyE');
    const gained = g.money - m0;
    // second store: kill the clerk and cart the body off: no fresh clerk pops up behind the counter
    const j = (eval(SETUP) as (k: string) => number)('liquor'), k2 = R.kiosks[j];
    k2.brave = false; k2.clerk.char.damage(1000, g.player, g.time);
    for (let f = 0; f < 10; f++) g.frame(1 / 30, false);
    g.pop.remove(k2.clerk);
    for (let f = 0; f < 60; f++) g.frame(1 / 30, false);
    return { alive, prompt, gained, replaced: !!k2.clerk };
  }, { SETUP });
  console.log('register', JSON.stringify(r));
  expect(r.alive).toBe(true);
  expect(r.prompt).toContain('Rob the register');
  expect(r.gained).toBeGreaterThan(0);
  expect(r.replaced).toBe(false);
});

test('shoppers who are done walk out of the door instead of standing in the doorway', async () => {
  test.setTimeout(300_000);
  const r = await page.evaluate(({ SETUP }) => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
    const i = (eval(SETUP) as (k: string) => number)('gas'), k = R.kiosks[i];
    const outside = k.frame.toWorld(3.1, 0.3, 16); g.player.place(outside.x, outside.y, outside.z, 0); // player out front, doors not held open by them
    for (const s of k.shoppers) { s.life.st = 'leave'; s.life.stuck = 0; }
    const n0 = k.shoppers.length, who = k.shoppers.map((s: any) => s.n);
    for (let f = 0; f < 30 * 25; f++) g.frame(1 / 30, false);
    const doorway = who.filter((n: any) => { const l = k.frame.toLocal(n.pos); return n.alive && l.z > 2.5 && l.z < 6 && Math.abs(l.x - 3.1) < 2; }).length;
    return { n0, left: n0 - k.shoppers.filter((s: any) => who.includes(s.n)).length, doorway };
  }, { SETUP });
  console.log('leave', JSON.stringify(r));
  expect(r.n0).toBeGreaterThan(0);
  expect(r.left).toBe(r.n0);
  expect(r.doorway).toBe(0);
});
