import { test, expect } from '@playwright/test';
import { watch, boot, step, clean, quietStreets } from './helpers';

/** Owner playtest #3 regressions: tracers fade, every death ends on the ground (varied falls), rockets bring helis down. */

test('bullet tracers fade out within ~0.2 s and none linger', async ({ page }) => {
  const p = watch(page);
  await boot(page); await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.pcombat.give('rifle', 200); g.pcombat.inv.select('rifle'); g.input.press('Mouse2'); });
  await step(page, 0.6, { dt: 1 / 60 });
  await page.evaluate(() => { const g = (window as any).__game; g.cam.pitch = 0.6; g.cam.update(0, g.player.pos, 'aim'); });
  const live0 = await page.evaluate(() => {
    const g = (window as any).__game; g.input.tap('Mouse0'); g.frame(1 / 60, false); return g.combat.tracers.live;
  });
  expect(live0).toBeGreaterThan(0);
  await step(page, 0.25, { dt: 1 / 60 });
  expect(await page.evaluate(() => (window as any).__game.combat.tracers.live)).toBe(0);
  clean(p);
});

type Case = { zone: string; kind: 'front' | 'back' | 'blast' | 'melee'; role: string };
const CASES: Case[] = [
  { zone: 'head', kind: 'front', role: 'police' }, { zone: 'torso', kind: 'front', role: 'police' }, { zone: 'torso', kind: 'back', role: 'police' },
  { zone: 'leg', kind: 'front', role: 'police' }, { zone: 'arm', kind: 'front', role: 'civilian' }, { zone: 'torso', kind: 'blast', role: 'gang' },
  { zone: 'head', kind: 'back', role: 'civilian' }, { zone: 'torso', kind: 'melee', role: 'police' },
];

test('every kind of death ends flat on the ground and stays down (varied falls)', async ({ page }) => {
  test.setTimeout(120_000);
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const res = await page.evaluate((cases) => {
    const g = (window as any).__game, out: any[] = [];
    const T = g.player.pos.constructor;
    const styles = new Set<string>();
    const run = (c: any, i: number) => {
      const x = g.player.pos.x + 6 + (i % 4) * 2.5, z = g.player.pos.z + 6 + Math.floor(i / 4) * 2.5;
      const n = g.pop.spawn(c.role, x, z, g.player.pos.y + 0.2); n.persistent = true; n.brain = 'scripted'; n.char.vel.set(0, 0, 0);
      return n;
    };
    const npcs = cases.map(run);
    for (let k = 0; k < 20; k++) g.frame(1 / 60, false);
    const w = (window as any).__game.pcombat.inv.def;
    cases.forEach((c: any, i: number) => {
      const n = npcs[i], ch = n.char;
      const fwd = { x: Math.sin(ch.yaw), z: Math.cos(ch.yaw) };
      const dir = c.kind === 'front' ? { x: -fwd.x, z: -fwd.z } : c.kind === 'back' ? { x: fwd.x, z: fwd.z } : { x: 0.6, z: 0.8 };
      if (c.kind === 'melee') { ch.lastDamageFrom = g.player; ch.damage(1000, g.player, g.time); return; }
      const dv = new T(dir.x, 0, dir.z);
      if (c.kind === 'blast') { ch.lastHit = { zone: 'torso', dx: dir.x, dz: dir.z, power: 6, blast: true }; ch.damage(1000, g.player, g.time); }
      else { ch.lastDamageFrom = g.player; g.combat.hitPerson(ch, g.player, { ...w, damage: 1000, knockback: 1 }, c.zone, 8, dv, ch.pos); }
    });
    // stray actions after death must not stand them up
    for (const n of npcs) { try { n.char.human.playAction('punch_jab'); n.char.human.playAction('stagger'); } catch { /* */ } }
    for (let k = 0; k < 180; k++) g.frame(1 / 30, false); // 6 s: past the end of the fall clip (used to snap upright)
    npcs.forEach((n: any, i: number) => {
      const ch = n.char, h = ch.human; ch.updateVisual(0.016); h.root.updateMatrixWorld(true);
      const head = h.head.getWorldPosition(new T()), hip = h.spine.getWorldPosition(new T());
      styles.add(ch.deathStyle);
      out.push({ i, alive: ch.alive, style: ch.deathStyle, headY: head.y - ch.pos.y, hipY: hip.y - ch.pos.y, state: h.currentState });
    });
    return { out, styles: [...styles] };
  }, CASES);
  const bad = res.out.filter((r: any) => r.alive || r.state !== 'dead' || r.headY >= 0.75);
  expect(bad, JSON.stringify(res.out)).toEqual([]);
  expect(res.styles.length, res.styles.join()).toBeGreaterThanOrEqual(4);
  clean(p);
});

test('a rocket brings down a helicopter; the launchers are for sale', async ({ page }) => {
  test.setTimeout(120_000);
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, M = (window as any).__meridian, T = g.player.pos.constructor;
    const items = M.activities.armsItems().map((i: any) => i.id.split(':')[1]);
    g.pcombat.give('rpg', 4); g.pcombat.inv.select('rpg');
    const def = g.pcombat.inv.def;
    const hx = g.player.pos.x + 25, hy = g.player.pos.y + 3, hz = g.player.pos.z;
    const h = g.helis.spawn('civilian', hx, hy, hz, 0);
    h.phys.body.setBodyType(2, true); // park it in the air for the test
    for (let i = 0; i < 3; i++) g.frame(1 / 60, false); const hp = h.phys.body.translation();
    const o = new T(g.player.pos.x, g.player.pos.y + 1.5, g.player.pos.z), d = new T(hp.x - o.x, hp.y - o.y, hp.z - o.z).normalize();
    g.combat.launch(g.player, def, o, d, 0);
    for (let i = 0; i < 120 && !h.destroyed; i++) g.frame(1 / 60, false);
    return { items, destroyed: h.destroyed, health: h.health };
  });
  expect(r.items).toContain('rpg'); expect(r.items).toContain('grenadeLauncher');
  expect(r.destroyed, JSON.stringify(r)).toBe(true);
  clean(p);
});
