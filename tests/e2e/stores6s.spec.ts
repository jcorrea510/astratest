import { test, expect } from '@playwright/test';
import { watch, boot, clean } from './helpers';

test.describe.configure({ mode: 'serial' });

const KINDS = ['convenience', 'liquor', 'gas', 'pawn', 'jewelry', 'bank'];

/** Index of the first store of a kind; places the player inside at the customer side and lets the interior + shoppers appear. */
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

test('every store type reacts within a second when a gun is aimed inside', async ({ page }) => {
  test.setTimeout(480_000);
  const p = watch(page);
  await boot(page);
  for (const kind of KINDS) {
    const r = await page.evaluate(({ kind, SETUP }) => {
      const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
      const i = (eval(SETUP) as (k: string) => number)(kind), k = R.kiosks[i];
      g.cam.pitch = 1.3; // gun up at the ceiling: aimed inside the store, but not at the clerk
      g.input.press('Mouse2');
      for (let f = 0; f < 30; f++) g.frame(1 / 30, false); // 1.0 s
      const sh = k.shoppers.filter((s: any) => s.n.alive && k.frame.toLocal(s.n.char.pos).z < 4.6);
      const up = sh.filter((s: any) => s.act === 'handsUp' && s.n.char.human.actionName === 'hands_up').length;
      const clerkUp = k.clerk?.char.human.actionName === 'hands_up';
      const tellerUp = k.ex.tellers.every((t: any) => t.char.human.actionName === 'hands_up');
      g.input.release('Mouse2');
      return { kind, shoppers: sh.length, up, clerkUp, tellerUp, robbing: R.robbing };
    }, { kind, SETUP });
    expect(r.shoppers, `${kind} has shoppers`).toBeGreaterThan(0);
    expect(r.up, `${kind}: every shopper has hands up`).toBe(r.shoppers);
    expect(r.clerkUp, `${kind}: clerk hands up`).toBe(true);
    expect(r.tellerUp, `${kind}: tellers hands up`).toBe(true);
    // lowering the gun calms the store down again
    const calm = await page.evaluate(() => {
      const g = (window as any).__game, R = (window as any).__meridian.activities.robberies, k = R.inside();
      for (let f = 0; f < 30 * 6; f++) g.frame(1 / 30, false);
      return { panic: k.panicT, clerk: k.clerk?.char.human.actionName };
    });
    expect(calm.panic, `${kind} calms down`).toBe(-1);
    expect(calm.clerk).not.toBe('hands_up');
  }
  clean(p);
});

test('knocked-out and dead clerks: the register is robbed physically (hold E), cash goes up', async ({ page }) => {
  test.setTimeout(480_000);
  const p = watch(page);
  await boot(page);
  for (const [kind, how] of [['convenience', 'punch'], ['liquor', 'dead'], ['gas', 'punch']] as const) {
    const r = await page.evaluate(({ kind, how, SETUP }) => {
      const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
      const i = (eval(SETUP) as (k: string) => number)(kind), k = R.kiosks[i];
      g.pcombat.inv.select('fists'); k.brave = false;
      const c = k.clerk.char;
      if (how === 'punch') { // three real-ish blows: fist damage through the normal path, then the knock-out kicks in
        for (let b = 0; b < 3; b++) { c.damage(18, g.player, g.time); g.frame(1 / 30, false); }
      } else c.damage(1000, g.player, g.time);
      for (let f = 0; f < 20; f++) g.frame(1 / 30, false);
      const state = { ko: k.ex.koT > 0, clerkDown: c.downT > 0 || !k.clerk.alive };
      // walk to the register (customer side) and hold E
      const rp = k.frame.toWorld(k.shell.register.lx, 0.3, k.frame.counterZ + 0.8); g.player.place(rp.x, rp.y, rp.z, 0);
      for (let f = 0; f < 10; f++) g.frame(1 / 30, false);
      const prompt = R.prompt();
      const m0 = g.money; g.input.press('KeyE');
      let drawer = 0;
      for (let f = 0; f < 30 * 5; f++) { g.frame(1 / 30, false); if (f === 60) drawer = k.shell.root.getObjectByProperty('type', 'Group') ? 1 : 0; }
      g.input.release('KeyE');
      return { ...state, prompt, gained: g.money - m0, cash: k.def.cash, looted: k.looted, drawer };
    }, { kind, how, SETUP });
    expect(r.ko || r.clerkDown, `${kind} clerk out`).toBe(true);
    expect(r.prompt, `${kind} prompt`).toContain('Rob the register');
    expect(r.gained, `${kind} payout`).toBeGreaterThanOrEqual(Math.round(r.cash * 0.8) - 1);
    expect(r.looted).toBe(true);
  }
  clean(p);
});

test('jewelry cases smash for loot; a shot-out pane loses its bullet holes', async ({ page }) => {
  test.setTimeout(480_000);
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(({ SETUP }) => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
    const i = (eval(SETUP) as (k: string) => number)('jewelry'), k = R.kiosks[i], sh = k.shell;
    const c = sh.cases[0], pt = k.frame.toWorld(c.lx, 0.3, c.lz + c.d / 2 + 0.8); g.player.place(pt.x, pt.y, pt.z, 0);
    for (let f = 0; f < 10; f++) g.frame(1 / 30, false);
    const prompt = R.prompt(); const m0 = g.money;
    g.input.tap('KeyE'); for (let f = 0; f < 30; f++) g.frame(1 / 30, false);
    const out = { cases: sh.cases.length, prompt, broken: c.broken, gained: g.money - m0, value: c.value, glassGone: !c.glass.parent, lootHidden: !c.loot.visible };
    return out;
  }, { SETUP });
  expect(r.cases).toBeGreaterThanOrEqual(3);
  expect(r.prompt).toContain('Smash');
  expect(r.broken && r.glassGone && r.lootHidden).toBe(true);
  expect(r.gained).toBeGreaterThanOrEqual(r.value);
  // bullet holes on a street shopfront pane vanish when it shatters
  const d = await page.evaluate(() => {
    const g = (window as any).__game, W = (window as any).__meridian.glass ?? null; void W;
    const dec = g.particles.decals;
    const pane = { x: 5, y: 2, z: 5, yaw: 0, w: 2, h: 2 };
    const before = dec.mesh.count;
    dec.add(pane.x + 0.3, pane.y, pane.z + 0.001, 0, 0, 1, 'concrete'); dec.add(pane.x - 0.4, pane.y + 0.3, pane.z - 0.5, 0, 0, 1, 'concrete'); dec.add(pane.x + 6, pane.y, pane.z, 0, 0, 1, 'concrete');
    const removed = dec.clearIn(pane.x, pane.y, pane.z, pane.yaw, pane.w, pane.h, 1.7);
    return { added: dec.mesh.count - before, removed };
  });
  expect(d.added).toBe(3);
  expect(d.removed).toBe(2);
  clean(p);
});

test('bank heist: hold up the tellers, drill the vault, open the door, grab the cash', async ({ page }) => {
  test.setTimeout(600_000);
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(({ SETUP }) => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies;
    const i = (eval(SETUP) as (k: string) => number)('bank'), k = R.kiosks[i], sh = k.shell, v = sh.vault;
    const log: string[] = []; const m0 = g.money; let maxHeat = 0;
    const keepCalm = () => { maxHeat = Math.max(maxHeat, g.police.heat); g.police.clear(); g.player.health = g.player.maxHealth; };
    // step 1: tellers. Cover the clerk from the customer spot until the hold-up completes
    const cp = k.customer; g.player.place(cp.x, cp.y + 0.3, cp.z, 0);
    for (let f = 0; f < 45; f++) g.frame(1 / 30, false);
    k.brave = false; const clerk = k.clerk; g.input.press('Mouse2');
    for (let f = 0; f < 30 * 9; f++) { g.cam.yaw = Math.atan2(-(clerk.pos.x - g.player.pos.x), -(clerk.pos.z - g.player.pos.z)); g.cam.pitch = -0.05; g.frame(1 / 30, false); maxHeat = Math.max(maxHeat, g.police.heat); if (f % 20 === 0 && k.ex.stage < 1) keepCalm(); }
    g.input.release('Mouse2');
    log.push('stage after holdup ' + k.ex.stage);
    const afterTellers = k.ex.stage; const heat = Math.max(maxHeat, g.police.heat);
    const bag = g.pickups.find((q: any) => q.kind === 'cash'); if (bag) { g.player.place(bag.pos.x, bag.pos.y - 0.55, bag.pos.z, 0); for (let f = 0; f < 15; f++) g.frame(1 / 30, false); }
    const m1 = g.money;
    // step 2: drill the vault (hold E at the door)
    const vp = k.frame.toWorld(v.lx, 0.3, v.lz); g.player.place(vp.x, vp.y, vp.z, 0);
    for (let f = 0; f < 5; f++) g.frame(1 / 30, false);
    const prompt = R.prompt(); g.input.press('KeyE');
    for (let f = 0; f < 30 * 30; f++) { g.frame(1 / 30, false); if (f % 15 === 0) { keepCalm(); g.player.place(vp.x, vp.y, vp.z, 0); } if (k.ex.stage >= 3 && k.ex.vaultOpen >= 1) break; }
    g.input.release('KeyE');
    const stageDrilled = k.ex.stage, doorOpen = v.door.rotation.y;
    // step 3: the vault cash
    const cpos = k.frame.toWorld(v.cashLx, 0.3, v.cashLz); g.player.place(cpos.x, cpos.y, cpos.z, 0);
    for (let f = 0; f < 5; f++) g.frame(1 / 30, false);
    const prompt2 = R.prompt(); g.input.press('KeyE');
    for (let f = 0; f < 30 * 7; f++) { g.frame(1 / 30, false); if (f % 15 === 0) { keepCalm(); g.player.place(cpos.x, cpos.y, cpos.z, 0); } }
    g.input.release('KeyE');
    return { afterTellers, heat, m1: m1 - m0, prompt, prompt2, stageDrilled, doorOpen, stageEnd: k.ex.stage, total: g.money - m0, cash: k.def.cash, log };
  }, { SETUP });
  expect(r.afterTellers, 'tellers done').toBeGreaterThanOrEqual(1);
  expect(r.heat, 'bank hold-up brings a heavy response').toBeGreaterThanOrEqual(3);
  expect(r.prompt).toContain('Drill');
  expect(r.stageDrilled, 'vault opened by the drill').toBeGreaterThanOrEqual(3);
  expect(r.doorOpen).toBeGreaterThan(1.5);
  expect(r.prompt2).toContain('vault cash');
  expect(r.stageEnd).toBe(4);
  expect(r.total - r.m1, 'vault payout is big').toBeGreaterThanOrEqual(r.cash * 2);
  clean(p);
});
