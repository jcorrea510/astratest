import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

/** Round 8 (owner): gun-store till locked after a shootout, closed store walkable, stores stay shut after dying, $1000 smash case in the gun store. */
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

test('gun store: no smash-for-cash case; an armed clerk shot dead leaves the till robbable', async () => {
  test.setTimeout(300_000);
  const r = await page.evaluate(({ SETUP }) => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
    const i = (eval(SETUP) as (k: string) => number)('guns'), k = R.kiosks[i];
    const cases = k.shell.extras?.cases?.length ?? k.shell.cases?.length ?? 0;
    k.brave = true;
    R.begin(k); for (let f = 0; f < 30 * 3; f++) g.frame(1 / 30, false); // the clerk pulls a gun after ~1.6 s
    const pulled = k.clerk?.role === 'gang', phase = k.phase;
    k.clerk.char.damage(1000, g.player, g.time);
    for (let f = 0; f < 20; f++) g.frame(1 / 30, false);
    const rp = k.frame.toWorld(k.shell.register.lx, 0.3, k.frame.counterZ + 0.9); g.player.place(rp.x, rp.y, rp.z, 0);
    for (let f = 0; f < 10; f++) g.frame(1 / 30, false);
    return { cases, pulled, phase, prompt: R.prompt() };
  }, { SETUP });
  console.log('guns', JSON.stringify(r));
  expect(r.cases).toBe(0);
  expect(r.pulled).toBe(true);
  expect(r.phase).toBe('open');
  expect(r.prompt).toContain('Rob the register');
});

test('a closed store keeps its shutter down when you walk back up to it; dying reopens every store', async () => {
  test.setTimeout(300_000);
  const r = await page.evaluate(({ SETUP }) => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
    const i = (eval(SETUP) as (k: string) => number)('convenience'), k = R.kiosks[i];
    R.close(k);
    const outside = k.frame.toWorld(3.1, 0.3, 14); g.player.place(outside.x, outside.y, outside.z, Math.PI);
    for (let f = 0; f < 30; f++) g.frame(1 / 30, false);
    const at = k.frame.toWorld(3.1, 0.3, 6.6); g.player.place(at.x, at.y, at.z, Math.PI); // just in front of the door
    for (let f = 0; f < 45; f++) g.frame(1 / 30, false);
    const shutterNear = k.shell.shutter.visible, doorNear = k.door;
    R.reopenAll();
    return { shutterNear, doorNear, after: k.phase, shutterAfter: k.shell.shutter.visible };
  }, { SETUP });
  console.log('closed', JSON.stringify(r));
  expect(r.shutterNear).toBe(true);
  expect(r.doorNear).toBe(0);
  expect(r.after).toBe('open');
  expect(r.shutterAfter).toBe(false);
});

test('map: the bank has its own icon; three gun stores are marked as gun stores', async () => {
  const r = await page.evaluate(() => {
    const b = (window as any).__meridian.activities.blips();
    return { banks: b.filter((x: any) => x.kind === 'bank').map((x: any) => x.label), guns: b.filter((x: any) => x.kind === 'arms').map((x: any) => x.label) };
  });
  console.log('blips', JSON.stringify(r));
  expect(r.banks.length).toBeGreaterThanOrEqual(1);
  expect(r.guns.length).toBe(3);
});
