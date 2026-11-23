import { test, expect } from '@playwright/test';
import { boot } from './helpers';

/** Round 9 (owner): "make the bank robberies more than just the register"; "I can see right through the bank vault". */
test('bank job: guard draws, drill set once runs (and jams), deposit boxes, vault cash rides in a bag paid out on escape', async ({ page }) => {
  test.setTimeout(400_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies, X = R.extras;
    const k = R.kiosks.find((q: any) => q.def.kind === 'bank');
    g.police.clear(); g.pcombat.give('pistol', 60); g.pcombat.inv.select('pistol'); g.ghost = true;
    const step = (s: number) => { for (let i = 0; i < s * 30; i++) g.frame(1 / 30, false); };
    const at = (x: number, z: number) => { const p = k.frame.toWorld(x, 0.3, z); g.player.place(p.x, p.y, p.z, 0); };
    at(3.1, 2.8); step(5);
    const guard = !!k.ex.guard;
    R.begin(k); step(0.5);
    const guardArmed = k.ex.guard?.role === 'gang' && k.ex.guard?.weapon === 'pistol';
    if (k.ex.guard) k.ex.guard.char.damage(1000, g.player, g.time);
    X.holdupDone(k); R.active = null; k.phase = 'open';
    const v = k.shell.vault; at(v.lx, v.lz); step(0.2);
    const tap = () => { g.input.press('KeyE'); g.frame(1 / 30, false); g.input.release('KeyE'); g.frame(1 / 30, false); };
    tap(); const set = k.ex.drillOn && k.ex.stage === 2;
    let jams = 0;
    for (let t = 0; t < 60 && k.ex.stage === 2; t += 0.5) { step(0.5); if (k.ex.jamIn < 0) { jams++; tap(); } }
    const opened = k.ex.stage === 3;
    at(-3.0, -0.3); step(0.2);
    for (let b = 0; b < 3; b++) { g.input.press('KeyE'); step(3); g.input.release('KeyE'); step(0.1); }
    const boxes = k.ex.boxes;
    step(3); at(v.cashLx, v.cashLz + 0.6); step(0.2);
    const m0 = g.money; g.input.press('KeyE'); step(6); g.input.release('KeyE');
    const bag = X.bag, paidEarly = g.money - m0;
    g.police.clear(); step(0.5);
    return { guard, guardArmed, set, jams, opened, boxes, bag, paidEarly, paid: g.money - m0, stage: k.ex.stage };
  });
  console.log('bank9', JSON.stringify(r));
  expect(r.guard).toBe(true); expect(r.guardArmed).toBe(true);
  expect(r.set).toBe(true); expect(r.jams).toBeGreaterThanOrEqual(1); expect(r.opened).toBe(true);
  expect(r.boxes).toBe(3); expect(r.stage).toBe(4);
  expect(r.bag).toBeGreaterThan(1000); expect(r.paidEarly).toBe(0); expect(r.paid).toBe(r.bag);
});
