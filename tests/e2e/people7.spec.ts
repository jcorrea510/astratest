import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 7 (owner): side-swiped peds sank through the street and jittered; aimed-at civilians bolted before an order; come-here was a slow amble with the arms down. */
test.describe.configure({ mode: 'serial' });
let page: Page;
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await browser.newPage(); await boot(page); await quietStreets(page); });
test.afterAll(async () => { await page.close(); });

test('a pedestrian clipped by the side of a car is thrown clear and never ends up inside the street', async () => {
  test.setTimeout(300_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-250, 0.25, -80, 0);
    const out: any[] = [];
    for (const [off, drift] of [[0.75, 0], [0.95, 0], [0, 1]]) {
      for (const v of g.vehicles.list) v.phys.body.setEnabled(false);
      // drift: the car slides sideways (+z) into the person standing beside its door
      const car = drift ? g.vehicles.spawn('sedan', -300, -106, Math.PI / 2, -1, 0.6) : g.vehicles.spawn('sedan', -345, -96.5, Math.PI / 2, -1, 0.6); car.persistent = true;
      const half = car.tpl.layout.half[0];
      const ped = g.pop.spawn('civilian', -300, drift ? -96.5 : -96.5 + half * off + 0.2, 0.25); ped.brain = 'scripted'; ped.persistent = true;
      for (let f = 0; f < 30; f++) g.frame(1 / 60, false);
      let hit = -1, below = 0, worst = 9, sunk = 0;
      for (let f = 0; f < 360; f++) {
        const lv = car.phys.body.linvel(); if (f < 190 && !drift) car.phys.body.setLinvel({ x: 13.4, y: lv.y, z: 0 }, true);
        if (drift && f < 70) car.phys.body.setLinvel({ x: 3, y: lv.y, z: 11 }, true);
        g.frame(1 / 60, false);
        const rd = ped.char.ragdoll; if (!rd) continue;
        if (hit < 0) hit = f;
        for (const b of [rd.legs, rd.torso]) { const p = b.translation(); const clear = p.y - 0.12; worst = Math.min(worst, clear); if (clear < -0.05) below += 1 / 60 / 2; }
        sunk = rd.unsunk;
      }
      out.push({ off, drift, hit, below: +below.toFixed(2), worst: +worst.toFixed(2), sunk, rest: +ped.char.pos.y.toFixed(2) });
      g.pop.remove(ped); g.vehicles.remove(car);
    }
    return out;
  });
  console.log('sidehit', JSON.stringify(r));
  for (const x of r) { expect(x.hit).toBeGreaterThan(0); expect(x.below).toBeLessThan(0.15); expect(x.rest).toBeGreaterThan(-0.2); }
});

test('a civilian held at gunpoint stays frozen; "come here" is a brisk walk with the hands up', async () => {
  test.setTimeout(300_000);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, V = g.player.pos.constructor;
    g.player.place(-250, 0.25, -80, 0); g.pcombat.give('pistol', 30); g.pcombat.inv.select('pistol');
    const n = g.pop.spawn('civilian', -250, -66, 0.25); n.persistent = true; n.nerve = 0.5;
    const from = new V(-250, 1.5, -80), dir = new V(0, -0.02, 1).normalize();
    const orig = g.pop.aimProvider; g.pop.aimProvider = () => ({ from, dir });
    for (let f = 0; f < 30 * 8; f++) g.frame(1 / 30, false);
    const held = n.brain;
    g.pop.aimProvider = orig;
    const R = Math.random; Math.random = () => 0.01; const ok = g.orders.give('come', n); Math.random = R;
    if (!ok) return { held, ok };
    const p0 = n.pos.clone(); let up = 0, f = 0;
    for (; f < 30 * 4; f++) { g.frame(1 / 30, false); if (n.char.human.actionName === 'hands_up') up++; }
    return { held, ok, speed: +(p0.distanceTo(n.pos) / 4).toFixed(2), upFrac: +(up / f).toFixed(2) };
  });
  console.log('come', JSON.stringify(r));
  expect(r.held).toBe('surrender');
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.speed).toBeGreaterThan(2); expect(r.upFrac).toBeGreaterThan(0.8); }
});
