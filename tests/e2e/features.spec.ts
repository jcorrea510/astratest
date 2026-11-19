import { test, expect } from '@playwright/test';
import { watch, boot, step, clean, state } from './helpers';

test.describe.configure({ mode: 'serial' });

test('holding up a store: aim at the clerk, the till empties, grab the cash, the alarm brings heat, the shutters come down', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const R = (window as any).__meridian.activities.robberies;
    // a store whose clerk keeps no gun under the counter
    const k = R.kiosks[0];
    g.pcombat.give('pistol', 60); g.pcombat.inv.select('pistol'); g.money = 0;
    g.player.place(k.customer.x, k.customer.y + 0.3, k.customer.z, 0);
    for (let i = 0; i < 45; i++) g.frame(1 / 30, false);
    k.brave = false;
    const prompt = (window as any).__meridian.activities.prompt();
    const c = k.clerk;
    g.input.press('Mouse2');
    let started = false, maxProgress = 0;
    for (let i = 0; i < 30 * 9; i++) { g.cam.yaw = Math.atan2(-(c.pos.x - g.player.pos.x), -(c.pos.z - g.player.pos.z)); g.cam.pitch = -0.05; g.frame(1 / 30, false); if (R.robbing) { started = true; maxProgress = Math.max(maxProgress, k.progress); } }
    g.input.release('Mouse2');
    const bag = g.pickups.find((q: any) => q.kind === 'cash');
    if (bag) { g.player.place(bag.pos.x, bag.pos.y - 0.55, bag.pos.z, 0); for (let i = 0; i < 15; i++) g.frame(1 / 30, false); }
    return { prompt, started, maxProgress, money: g.money, heat: g.police.heat, phase: k.phase, cash: k.def.cash };
  });
  expect(r.prompt).toContain('hold up');
  expect(r.started).toBe(true);
  expect(r.maxProgress).toBeGreaterThan(0.99);
  expect(r.money).toBe(r.cash);
  expect(r.heat).toBeGreaterThanOrEqual(1); // R4: witness/911 escalation, alarm starts at 1 star
  expect(r.phase).toBe('closed');
  // looking away lets the clerk off the hook
  const r2 = await page.evaluate(() => {
    const g = (window as any).__game; const R = (window as any).__meridian.activities.robberies;
    g.police.clear();
    const k = R.kiosks[2];
    g.player.place(k.customer.x, k.customer.y + 0.3, k.customer.z, 0);
    for (let i = 0; i < 45; i++) g.frame(1 / 30, false);
    k.brave = false; const c = k.clerk;
    g.input.press('Mouse2');
    for (let i = 0; i < 30; i++) { g.cam.yaw = Math.atan2(-(c.pos.x - g.player.pos.x), -(c.pos.z - g.player.pos.z)); g.frame(1 / 30, false); }
    const during = R.robbing;
    g.cam.yaw += Math.PI; for (let i = 0; i < 30 * 4; i++) g.frame(1 / 30, false);
    g.input.release('Mouse2');
    return { during, after: R.robbing, phase: k.phase, progress: k.progress };
  });
  expect(r2.during).toBe(true);
  expect(r2.after).toBe(false);
  expect(r2.phase).toBe('closed');
  expect(r2.progress).toBeLessThan(1);
  clean(p);
});

test('sandbox tools: arsenal, cash, wanted level, frozen clock, spawn, invincible, teleport; saving works', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await step(page, 1);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, M = (window as any).__meridian, sb = M.sandbox; const out: Record<string, unknown> = {};
    out.start = g.money;
    sb.act('arsenal'); out.guns = ['pistol', 'smg', 'shotgun', 'rifle'].every(id => g.pcombat.inv.weapons[id].owned);
    sb.act('cash'); out.money = g.money;
    out.saved = M.save();
    sb.act('heat', 3); for (let i = 0; i < 15; i++) g.frame(1 / 30, false); out.heat = g.police.heat;
    sb.act('heat', 0); out.heat0 = g.police.heat;
    sb.act('hour', 2.5); sb.act('clock', false); const h = g.hour; for (let i = 0; i < 90; i++) g.frame(1 / 30, false); out.frozen = g.hour === h && h === 2.5;
    const n = g.vehicles.list.length; sb.act('kind', 'coupe'); sb.act('spawn'); out.spawned = g.vehicles.list.length === n + 1;
    sb.act('god', true); g.player.damage(80, null, g.time); for (let i = 0; i < 3; i++) g.frame(1 / 30, false); out.health = g.player.health; out.alive = g.player.alive;
    sb.act('spot', 'docks'); sb.act('go'); for (let i = 0; i < 15; i++) g.frame(1 / 30, false); out.tp = Math.hypot(g.player.pos.x - 470, g.player.pos.z - 150) < 3;
    return out;
  });
  expect(r).toEqual({ start: 2500, guns: true, money: 12500, saved: true, heat: 3, heat0: 0, frozen: true, spawned: true, health: 100, alive: true, tp: true });
  expect(await state<boolean>(page, '!!window.__meridian.read()')).toBe(true);
  expect(await state<number>(page, 'window.__meridian.read().money')).toBe(12500);
  clean(p);
});
