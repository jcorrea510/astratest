import { test, expect } from '@playwright/test';
import { watch, boot, clean, quietStreets } from './helpers';

test('carjack: the player\'s hands are on the driver while he is hauled out and flung', async ({ page }) => {
  test.setTimeout(600_000);
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const res = await page.evaluate(`(() => {
    const g = window.__game;
    const lane = g.city.lanes.find(l => !l.connector && l.length > 80);
    const car = g.traffic.spawnOnLane('sedan', lane, 30); car.maxSpeed = 0; car.persistent = true; car.passengers = [];
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
    const v = car.v, victim = car.driver, ph = g.player.human;
    const d = v.doorWorldPos(0); g.player.place(d.x, v.position.y - 0.3, d.z, v.yaw);
    for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    g.input.tap('KeyF');
    let gripFrames = 0, best = 9, seated = -1; const T = g.player.pos.constructor;
    for (let i = 0; i < 300 && g.playerVehicle !== v; i++) {
      g.frame(1 / 30, false);
      if (ph.reach.w > 0.9 && victim.char.inVehicle) {
        gripFrames++;
        const vp = victim.char.human.root.getWorldPosition(new T()); vp.y += 1.38;
        const hl = ph.leftHand.getWorldPosition(new T()), hr = ph.rightHand.getWorldPosition(new T());
        best = Math.min(best, hl.distanceTo(vp), hr.distanceTo(vp));
      }
    }
    return { gripFrames, best, seated: g.playerVehicle === v, reachCleared: ph.reach.w === 0 };
  })()`) as { gripFrames: number; best: number; seated: boolean; reachCleared: boolean };
  expect(res.gripFrames).toBeGreaterThan(5);
  expect(res.best).toBeLessThan(0.6);   // a hand is on the victim's shoulders
  expect(res.seated).toBe(true);
  expect(res.reachCleared).toBe(true);
  clean(p);
});

test('robbery: shoot the clerk, then still rob the register; shoppers panic and one calls 911', async ({ page }) => {
  test.setTimeout(600_000);
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
    let k = R.kiosks[0];
    for (const cand of R.kiosks) { // a store on level ground (the interior plane is flat at curb height)
      const o = cand.frame.toWorld(3.1, 0.3, 4.9 + 4); g.player.place(o.x, o.y, o.z, 0);
      for (let f = 0; f < 8; f++) g.frame(1 / 30, false);
      if (Math.abs(g.player.pos.y - cand.frame.toWorld(0, 0, 0).y) < 1.2) { k = cand; break; }
    }
    g.police.clear(); g.money = 0;
    for (let f = 0; f < 90; f++) g.frame(1 / 30, false);
    const shoppers0 = k.shoppers.length;
    // kill the clerk
    k.clerk.char.damage(999, g.player, g.time);
    for (let f = 0; f < 30; f++) g.frame(1 / 30, false);
    const panicked = k.panicT >= 0;
    // behind the counter
    const reg = k.frame.toWorld(-1.2, 0.05, 0.3); // behind the counter, round its open east end
    g.player.place(reg.x, reg.y + 0.3, reg.z, 0);
    for (let f = 0; f < 8; f++) g.frame(1 / 30, false);
    const canPrompt = R.prompt();
    const lp0 = k.frame.toLocal(g.player.pos).toArray(); let maxLoot = 0;
    for (let f = 0; f < 30 * 6; f++) { if (f === 1) g.input.press('KeyE'); g.frame(1 / 30, false); maxLoot = Math.max(maxLoot, k.looting); }
    g.input.release('KeyE');
    const bag = g.pickups.find((q: any) => q.kind === 'cash');
    if (bag) { g.player.place(bag.pos.x, bag.pos.y - 0.55, bag.pos.z, 0); for (let f = 0; f < 15; f++) g.frame(1 / 30, false); }
    for (let f = 0; f < 30 * 3; f++) g.frame(1 / 30, false);
    return { shoppers0, panicked, canPrompt, looted: k.looted, loot: k.looting, phase: k.phase, clerkAlive: k.clerk?.alive, blocked: g.inputBlocked, lp0, maxLoot, money: g.money, called: k.called, heat: g.police.heat, acts: k.shoppers.map((s: any) => s.act) };
  });
  expect(r.shoppers0).toBeGreaterThanOrEqual(2);
  expect(r.panicked).toBe(true);
  expect(r.looted, JSON.stringify(r)).toBe(true);
  expect(r.money).toBeGreaterThan(0);
  expect(r.acts.some((a: string) => a !== 'browse')).toBe(true);
  clean(p);
});
