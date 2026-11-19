import { test, expect, type Page } from '@playwright/test';
import { watch, clean, step, tap, quietStreets } from './helpers';

/**
 * Scripted bug-bash tour: every feature in ONE session. After every step the page must have no console errors and the
 * world must still be sane (finite positions, player on the map, no runaway entity counts).
 */
const LEFT_OF = `(v, p) => { const s = Math.sin(v.yaw), c = Math.cos(v.yaw); const dx = p.x - v.position.x, dz = p.z - v.position.z; return dx * c - dz * s; }`;

async function sane(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const g = (window as any).__game, p = g.player.pos, c = g.renderer.camera.position;
    const fin = (...n: number[]) => n.every(Number.isFinite);
    return {
      finite: fin(p.x, p.y, p.z, c.x, c.y, c.z, g.player.health, g.money, g.hour), x: p.x, y: p.y, z: p.z, hp: g.player.health,
      vehicles: g.vehicles.list.length, npcs: g.pop.npcs.length, badV: g.vehicles.list.filter((v: any) => !Number.isFinite(v.position.x + v.position.y + v.position.z) || v.position.y < -40).length,
    };
  });
  expect(r.finite, `${label}: non-finite state`).toBe(true);
  expect(Math.abs(r.x) < 1500 && Math.abs(r.z) < 1500 && r.y > -40 && r.y < 400, `${label}: player off the map ${r.x},${r.y},${r.z}`).toBe(true);
  expect(r.badV, `${label}: vehicle fell out of the world`).toBe(0);
  expect(r.vehicles, `${label}: runaway vehicle count`).toBeLessThan(150);
  expect(r.npcs, `${label}: runaway npc count`).toBeLessThan(200);
}

async function resetFoot(page: Page, x = -300, z = -102) {
  await page.evaluate(({ x, z }) => {
    const g = (window as any).__game;
    if (g.playerVehicle) g.exitVehicle?.(true);
    g.police.clear?.(); g.input.release('Mouse2'); g.input.release('Mouse0');
    for (const n of [...g.pop.npcs]) if (n.tag === 'victim') g.pop.remove(n);
    g.player.place(x, 0.05, z, 0);
    // face a direction with 30 m of clear air so shots and victims are never behind a pole or a wall
    let h = 0;
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; if ([0.4, 1.0, 1.7].every(y => !g.physics.ray(x, y, z, Math.sin(a), 0, Math.cos(a), 30, undefined, g.player.collider))) { h = a; break; } }
    g.player.place(x, 0.05, z, h); g.cam.yaw = h + Math.PI;
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
  }, { x, z });
}
async function aimAt(page: Page, target: string) {
  await page.evaluate((target) => {
    const g = (window as any).__game, T = g.renderer.camera.position.constructor, v = (window as any).__victim;
    for (let i = 0; i < 6; i++) {
      if (v) { v.brain = 'scripted'; v.char.vel.set(0, 0, 0); }
      const p = (new Function('g', `return ${target}`))(g);
      g.frame(1 / 60, false);
      const cam = g.renderer.camera.getWorldPosition(new T());
      const d = new T(p.x - cam.x, p.y - cam.y, p.z - cam.z).normalize();
      g.cam.pitch = Math.asin(d.y); g.cam.yaw = Math.atan2(-d.x, -d.z);
      g.cam.update(0, g.player.pos, 'aim'); g.frame(1 / 60, false);
    }
  }, target);
}
async function victim(page: Page, dist: number) {
  await page.evaluate((dist) => {
    const g = (window as any).__game;
    const yaw = g.player.yaw, x = g.player.pos.x + Math.sin(yaw) * dist, z = g.player.pos.z + Math.cos(yaw) * dist;
    const n = g.pop.spawn('civilian', x, z, g.player.pos.y + 0.2); n.persistent = true; n.brain = 'scripted'; n.tag = 'victim'; n.char.yaw = yaw + Math.PI; n.char.vel.set(0, 0, 0);
    (window as any).__victim = n;
  }, dist);
  await step(page, 0.3);
}

test('tour: every feature in one session, clean console and sane world after every step', async ({ page }) => {
  test.setTimeout(20 * 60_000); // ~25 steps in one session; CI runners are ~3x slower than local
  const p = watch(page);
  const S = async (name: string, fn: () => Promise<void>) => { await test.step(name, async () => { await fn(); await sane(page, name); clean(p); }); };

  await S('title -> Play', async () => {
    await page.goto('./');
    await expect(page.getByText('Press any key')).toBeVisible({ timeout: 180_000 });
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForFunction(() => !!(window as any).__meridian?.activities, null, { timeout: 180_000 });
    await page.evaluate(() => (window as any).__game.stop());
    await step(page, 1);
    await quietStreets(page);
  });

  await S('walk, sprint, jump across curbs', async () => {
    await resetFoot(page);
    const r = await page.evaluate(() => {
      const g = (window as any).__game, c = g.player; const out: any = {};
      // a clear 30 m run in some direction (from the road onto the sidewalk where there is a curb)
      let h = 0;
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; if ([0.5, 1.2].every(y => !g.physics.ray(c.pos.x, y, c.pos.z, Math.sin(a), 0, Math.cos(a), 30, undefined, c.collider))) { h = a; break; } }
      c.yaw = h; const x0 = c.pos.x, z0 = c.pos.z;
      g.input.press('KeyW'); for (let i = 0; i < 60; i++) { g.cam.yaw = h + Math.PI; g.frame(1 / 30, false); } out.walk = Math.hypot(c.pos.x - x0, c.pos.z - z0);
      g.input.press('ShiftLeft'); const x1 = c.pos.x, z1 = c.pos.z; for (let i = 0; i < 60; i++) { g.cam.yaw = h + Math.PI; g.frame(1 / 30, false); } out.sprint = Math.hypot(c.pos.x - x1, c.pos.z - z1);
      let maxY = c.pos.y; const y0 = c.pos.y; g.input.tap('Space'); for (let i = 0; i < 20; i++) { g.frame(1 / 30, false); maxY = Math.max(maxY, c.pos.y); } out.jump = maxY - y0;
      for (let i = 0; i < 45; i++) g.frame(1 / 30, false);
      out.grounded = c.grounded; out.state = c.human.currentState;
      g.input.release('KeyW'); g.input.release('ShiftLeft'); return out;
    });
    expect(r.walk).toBeGreaterThan(3); expect(r.sprint).toBeGreaterThan(r.walk * 1.3); expect(r.jump).toBeGreaterThan(0.3);
    expect(r.grounded).toBe(true); expect(r.state).not.toMatch(/jump|fall|air/);
  });

  await S('punch an NPC (wind-up, hit only in range)', async () => {
    await resetFoot(page);
    await victim(page, 0.95);
    await tap(page, 'Mouse0');
    expect(await page.evaluate(() => (window as any).__victim.char.health)).toBe(100);
    await step(page, 0.7);
    expect(await page.evaluate(() => (window as any).__victim.char.health)).toBeLessThan(100);
    await resetFoot(page); await victim(page, 2.6);
    await tap(page, 'Mouse0'); await step(page, 0.9);
    expect(await page.evaluate(() => (window as any).__victim.char.health)).toBe(100);
  });

  for (const [weapon, dist] of [['pistol', 7], ['rifle', 9], ['shotgun', 6], ['sniper', 22]] as const) {
    await S(`${weapon}: headshot kills, bullet lands at the reticle`, async () => {
      await resetFoot(page);
      await page.evaluate((weapon) => { const g = (window as any).__game; g.pcombat.give(weapon, 200); g.pcombat.inv.select(weapon); g.cam.yaw = g.player.yaw + Math.PI; g.input.press('Mouse2'); }, weapon);
      await step(page, 1.6, { dt: 1 / 60 });
      await victim(page, dist);
      await aimAt(page, 'window.__victim.char.human.head.getWorldPosition(new g.renderer.camera.position.constructor()).add({x:0,y:0.08,z:0})');
      const hit = await page.evaluate(() => {
        const g = (window as any).__game; (window as any).__victim.brain = 'scripted';
        const shots: any[] = []; const prev = g.combat.onShot; g.combat.onShot = (e: any) => { shots.push(e); prev?.(e); };
        const aim = g.pcombat.aimPoint.clone();
        g.input.tap('Mouse0'); g.frame(1 / 60, false); g.combat.onShot = prev;
        const hs = shots[0]?.hits ?? []; const h = hs.find((q: any) => q.kind === 'character') ?? hs[0];
        return { cone: g.pcombat.cone, aimTarget: !!g.pcombat.aimTarget, all: hs.map((q: any) => q.kind + ':' + (q.zone ?? '')), kind: h?.kind, zone: h?.zone, killed: h?.killed, alive: (window as any).__victim.char.alive, miss: h?.point ? h.point.distanceTo(aim) : 99, dist: g.renderer.camera.position.distanceTo(aim) };
      });
      expect(hit.kind, JSON.stringify(hit)).toBe('character');
      expect(hit.alive).toBe(false);
      if (weapon !== 'shotgun') { expect(hit.zone).toBe('head'); expect(hit.miss).toBeLessThan(0.6 + hit.dist * 0.03); }
      await step(page, 0.4, { dt: 1 / 60 });
      await page.evaluate(() => (window as any).__game.input.release('Mouse2'));
    });
  }

  await S('throw a grenade', async () => {
    await resetFoot(page);
    const r = await page.evaluate(() => {
      const g = (window as any).__game; g.pcombat.give('grenade', 3); g.pcombat.inv.select('grenade');
      for (let i = 0; i < 40; i++) g.frame(1 / 30, false);
      const hp = g.player.health; let seen = 0;
      g.input.press('Mouse0'); for (let i = 0; i < 10; i++) g.frame(1 / 30, false); g.input.release('Mouse0');
      for (let i = 0; i < 20; i++) { g.frame(1 / 30, false); seen = Math.max(seen, g.combat.activeProjectiles); }
      for (let i = 0; i < 30 * 5; i++) g.frame(1 / 30, false);
      return { seen, left: g.combat.activeProjectiles, hp, hp2: g.player.health };
    });
    expect(r.seen).toBeGreaterThan(0); expect(r.left).toBe(0);
    await page.evaluate(() => { const g = (window as any).__game; g.pcombat.inv.select('pistol'); g.player.health = 100; g.police.clear?.(); });
    await step(page, 1);
  });

  await S('enter a car via the door, drive, exit', async () => {
    await resetFoot(page, -280, -95.5);
    await page.evaluate(() => { const g = (window as any).__game; const v = g.vehicles.spawn('sedan', -278, -97.5, Math.PI / 2); v.persistent = true; (window as any).__v = v; });
    await step(page, 0.3); await tap(page, 'KeyF');
    const r = await page.evaluate(() => { const g = (window as any).__game, v = (window as any).__v; let door = 0, at = -1; for (let i = 0; i < 300 && at < 0; i++) { g.frame(1 / 30, false); door = Math.max(door, v.doors[0].amount); if (g.playerVehicle === v) at = i / 30; } return { door, at }; });
    expect(r.door).toBeGreaterThan(0.8); expect(r.at).toBeGreaterThan(1);
    await step(page, 2.5, { hold: ['KeyW'] });
    expect(await page.evaluate(() => (window as any).__game.playerVehicle.speed)).toBeGreaterThan(5);
    await step(page, 1.5, { hold: ['KeyW', 'KeyA'] });
    await step(page, 2, { hold: ['Space'] });
    await tap(page, 'KeyF'); await step(page, 3);
    expect(await page.evaluate(() => !(window as any).__game.playerVehicle)).toBe(true);
  });

  await S('carjack a traffic car (victim lands on the driver side)', async () => {
    await resetFoot(page);
    const res = await page.evaluate(`(() => {
      const g = window.__game, leftOf = ${LEFT_OF};
      g.trafficCap = 4;
      const lane = g.city.lanes.find(l => !l.connector && l.length > 80);
      const car = g.traffic.spawnOnLane('sedan', lane, 30); car.maxSpeed = 0; car.persistent = true; car.passengers = [];
      for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
      const v = car.v, victim = car.driver; const d = v.doorWorldPos(0); g.player.place(d.x, v.position.y - 0.3, d.z, v.yaw);
      for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
      g.input.tap('KeyF'); let landed = null;
      for (let i = 0; i < 300 && g.playerVehicle !== v; i++) { g.frame(1 / 30, false); if (!landed && victim.char.inVehicle === null) landed = leftOf(v, victim.char.pos); }
      for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
      g.trafficCap = 0; return { landed, seated: g.playerVehicle === v };
    })()`) as { landed: number | null; seated: boolean };
    expect(res.seated).toBe(true); expect(res.landed).toBeGreaterThan(1.2);
    await resetFoot(page);
  });

  await S('smash + hotwire a parked car', async () => {
    await resetFoot(page, -276, -101);
    await page.evaluate(() => { const g = (window as any).__game; const v = g.vehicles.spawn('coupe', -278, -97.5, Math.PI / 2, 1); v.persistent = true; v.parked = true; v.doorsLocked = true; v.ignition = false; (window as any).__v = v; const d = v.doorWorldPos(0); g.player.place(d.x, 0.1, d.z, 0); });
    await step(page, 0.3); await tap(page, 'KeyF');
    const r = await page.evaluate(() => { const g = (window as any).__game, v = (window as any).__v; const ph = new Set<string>(); for (let i = 0; i < 600 && g.playerVehicle !== v; i++) { g.frame(1 / 30, false); if (g.carEntry.phase) ph.add(g.carEntry.phase); } return { seated: g.playerVehicle === v, phases: [...ph], ign: v.ignition }; });
    expect(r.seated).toBe(true); expect(r.phases.join(',')).toMatch(/smash/); expect(r.ign).toBe(false);
    await step(page, 4);
    expect(await page.evaluate(() => (window as any).__v.ignition)).toBe(true);
    await step(page, 2.5, { hold: ['KeyW'] });
    expect(await page.evaluate(() => (window as any).__v.speed)).toBeGreaterThan(3);
    await resetFoot(page);
  });

  await S('shoot through a car window: the driver dies', async () => {
    await resetFoot(page);
    await page.evaluate(() => { const g = (window as any).__game; g.pcombat.give('rifle', 100); g.pcombat.inv.select('rifle'); g.cam.yaw = g.player.yaw + Math.PI; g.input.press('Mouse2'); });
    await step(page, 0.8, { dt: 1 / 60 });
    const r = await page.evaluate(() => {
      const g = (window as any).__game; const T = g.renderer.camera.position.constructor;
      const yaw = g.player.yaw, x = g.player.pos.x + Math.sin(yaw) * 8, z = g.player.pos.z + Math.cos(yaw) * 8;
      const v = g.vehicles.spawn('sedan', x, z, yaw + Math.PI / 2); const n = g.pop.spawn('civilian', x, z, 0.5); n.persistent = true; v.persistent = true; g.traffic.seat(n, v);
      for (let i = 0; i < 20; i++) g.frame(1 / 60, false);
      for (let k = 0; k < 6; k++) {
        const q = n.char.human.head.getWorldPosition(new T()); q.y += 0.08; g.frame(1 / 60, false);
        const cam = g.renderer.camera.getWorldPosition(new T()); const d = new T(q.x - cam.x, q.y - cam.y, q.z - cam.z).normalize();
        g.cam.pitch = Math.asin(d.y); g.cam.yaw = Math.atan2(-d.x, -d.z); g.frame(1 / 60, false);
      }
      g.input.tap('Mouse0'); g.frame(1 / 60, false);
      for (let i = 0; i < 20; i++) g.frame(1 / 60, false);
      g.input.release('Mouse2'); return { alive: n.char.alive };
    });
    expect(r.alive).toBe(false);
    await page.evaluate(() => { const g = (window as any).__game; g.pcombat.inv.select('pistol'); g.police.clear?.(); });
  });

  await S('fly a helicopter from a helipad', async () => {
    await resetFoot(page);
    const r = await page.evaluate(() => {
      const g = (window as any).__game; const pad = g.helis.pads[0]; const h = pad.heli; const d = h.doorWorldPos ? h.doorWorldPos(0) : pad.pos;
      g.player.place(d.x, d.y + 0.2, d.z, 0); for (let i = 0; i < 15; i++) g.frame(1 / 30, false);
      g.input.tap('KeyF'); let inside = false; for (let i = 0; i < 400 && !inside; i++) { g.frame(1 / 30, false); inside = g.playerHeli === h; }
      (window as any).__h = h; return { inside };
    });
    expect(r.inside).toBe(true);
    await step(page, 1); await step(page, 9, { hold: ['Space'] });
    const up = await page.evaluate(() => { const h = (window as any).__h; return { agl: h.agl, destroyed: h.destroyed }; });
    expect(up.agl).toBeGreaterThan(5); expect(up.destroyed).toBe(false);
    await step(page, 3, { hold: ['KeyW'] });
    await step(page, 4); await step(page, 25, { hold: ['ShiftLeft'] });
    await tap(page, 'KeyF'); await step(page, 3);
    expect(await page.evaluate(() => !(window as any).__game.playerHeli)).toBe(true);
  });

  await S('rob a walk-in store', async () => {
    const r = await page.evaluate(() => {
      const g = (window as any).__game; const R = (window as any).__meridian.activities.robberies; const k = R.kiosks[1];
      g.pcombat.give('pistol', 60); g.pcombat.inv.select('pistol'); g.money = 0;
      g.player.place(k.customer.x, k.customer.y + 0.3, k.customer.z, 0); for (let i = 0; i < 45; i++) g.frame(1 / 30, false);
      k.brave = false; const c = k.clerk; g.input.press('Mouse2'); let started = false;
      for (let i = 0; i < 30 * 9; i++) { g.cam.yaw = Math.atan2(-(c.pos.x - g.player.pos.x), -(c.pos.z - g.player.pos.z)); g.cam.pitch = -0.05; g.frame(1 / 30, false); if (R.robbing) started = true; }
      g.input.release('Mouse2');
      const bag = g.pickups.find((q: any) => q.kind === 'cash'); if (bag) { g.player.place(bag.pos.x, bag.pos.y - 0.55, bag.pos.z, 0); for (let i = 0; i < 15; i++) g.frame(1 / 30, false); }
      return { started, money: g.money, heat: g.police.heat };
    });
    expect(r.started).toBe(true); expect(r.money).toBeGreaterThan(0); expect(r.heat).toBeGreaterThanOrEqual(1);
  });

  await S('1 star: a cop cuffs you (ARRESTED card)', async () => {
    await resetFoot(page);
    await page.evaluate(() => {
      const g = (window as any).__game; g.police.clear?.(); g.money = 500;
      const cop = g.pop.spawn('police', g.player.pos.x + 1.5, g.player.pos.z, 0.2); cop.persistent = true;
      g.police.dispatch.beginArrest(cop, g.player);
    });
    await step(page, 1);
    expect(await page.evaluate(() => (window as any).__game.police.dispatch.arresting)).toBe(true);
    await step(page, 8, { render: true });
    await expect(page.locator('.ma-death-word')).toHaveText('Arrested');
    await step(page, 8);
    expect(await page.evaluate(() => (window as any).__game.deathT)).toBe(-1);
    expect(await page.evaluate(() => (window as any).__game.player.alive)).toBe(true);
  });

  await S('die: WASTED, respawn at the hospital', async () => {
    await page.evaluate(() => { const g = (window as any).__game; g.money = 1000; g.player.damage(500, null, g.time); g.playerDown('down'); });
    await step(page, 1.7, { render: true });
    await expect(page.locator('.ma-death-word')).toHaveText('Wasted');
    await step(page, 7);
    expect(await page.evaluate(() => { const g = (window as any).__game; return g.player.alive && g.deathT === -1 && g.player.health === 100; })).toBe(true);
  });

  await S('5 stars: tank / army / fbi / swat show up', async () => {
    await page.evaluate(() => { const g = (window as any).__game; g.trafficCap = 6; (window as any).__meridian.sandbox.act('god', true); g.police.setHeat(5, g.player.pos); });
    await step(page, 14);
    const kinds = await page.evaluate(() => { const g = (window as any).__game; return [...new Set(g.police.units.map((u: any) => g.police.dispatch.kindOf(u)))]; }) as string[];
    const dbg = await page.evaluate(() => { const g = (window as any).__game; return JSON.stringify({ heat: g.police.heat, units: g.police.units.length, foot: g.police.foot.length, traffic: g.traffic.cars.length, cap: g.trafficCap, pos: g.player.pos.toArray(), arrest: g.police.dispatch.arresting, dead: g.deathT }); });
    expect(kinds.length, dbg).toBeGreaterThan(1);
    expect(kinds.some(k => ['tank', 'army', 'fbi', 'swat'].includes(k))).toBe(true);
    await page.evaluate(() => { const g = (window as any).__game; (window as any).__meridian.sandbox.act('heat', 0); (window as any).__meridian.sandbox.act('god', false); g.police.clear(); g.trafficCap = 0; });
    await step(page, 2); await quietStreets(page);
  });

  await S('sandbox panel: every vehicle kind, every teleport spot, time of day, traffic sliders', async () => {
    const r = await page.evaluate(() => {
      const g = (window as any).__game, sb = (window as any).__meridian.sandbox;
      g.player.health = 100; sb.act('god', true);
      const acts = sb.actions(); const kinds = acts.find((a: any) => a.id === 'kind').options.map((o: any) => o.value); const spots = acts.find((a: any) => a.id === 'spot').options.map((o: any) => o.value);
      const out: any = { kinds: kinds.length, spawnedAll: true, spots: [] as string[], bad: [] as string[] };
      g.player.place(-300, 0.05, -102, 0); for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
      for (const k of kinds) { const n = g.vehicles.list.length; sb.act('kind', k); sb.act('spawn'); if (g.vehicles.list.length !== n + 1) out.spawnedAll = false; for (let i = 0; i < 5; i++) g.frame(1 / 30, false); }
      for (const s of spots) {
        sb.act('spot', s); sb.act('go'); for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
        const p = g.player.pos; if (!Number.isFinite(p.x + p.y + p.z) || p.y < -3 || !g.player.alive) out.bad.push(s); else out.spots.push(s);
      }
      for (const h of [0, 6, 12, 18, 23.5]) { sb.act('hour', h); for (let i = 0; i < 5; i++) g.frame(1 / 30, false); }
      for (const q of ['low', 'high', 'medium']) { g.renderer.setQuality(q); for (let i = 0; i < 60; i++) g.frame(1 / 30, false); } // density follows the graphics preset only
      out.hour = g.hour; return out;
    });
    expect(r.spawnedAll).toBe(true); expect(r.bad).toEqual([]); expect(r.spots.length).toBeGreaterThanOrEqual(9);
    await page.evaluate(() => { const g = (window as any).__game; for (const v of [...g.vehicles.list]) if (!v.persistent || v !== g.playerVehicle) { /* leave */ } });
    await quietStreets(page);
  });

  await S('every vehicle kind can be seated in and driven off', async () => {
    await resetFoot(page);
    const r = await page.evaluate(() => {
      const g = (window as any).__game; const bad: string[] = [];
      const kinds = ['hatch', 'sedan', 'fullsize', 'luxury', 'wagon', 'coupe', 'muscle', 'super', 'convertible', 'pickup', 'suv', 'minivan', 'van', 'race', 'taxi', 'police', 'fbi', 'swat', 'army', 'tank'];
      for (const k of kinds) {
        g.player.place(-300, 0.3, -102, 0); for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
        const v = g.vehicles.spawn(k, -300, -102, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
        const x0 = v.position.x, z0 = v.position.z;
        g.input.press('KeyW'); for (let i = 0; i < 90; i++) g.frame(1 / 30, false); g.input.release('KeyW');
        for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
        const moved = Math.hypot(v.position.x - x0, v.position.z - z0);
        if (!(moved > 3) || !Number.isFinite(v.position.y) || v.position.y < -1 || g.playerVehicle !== v) bad.push(`${k}:${moved.toFixed(1)}:${v.position.y.toFixed(1)}`);
        g.exitVehicle(true); g.vehicles.remove(v); g.police.clear?.();
      }
      return bad;
    });
    expect(r).toEqual([]);
  });

  await S('perf culling: far store interiors and people behind the camera are not drawn', async () => {
    await resetFoot(page);
    const r = await page.evaluate(() => {
      const g = (window as any).__game, R = (window as any).__meridian.activities.robberies; const cp = g.renderer.camera.position;
      g.trafficCap = 0; g.pedCap = 20;
      const wrong: string[] = [];
      for (let i = 0; i < 120; i++) g.frame(1 / 30, false);
      for (const k of R.kiosks) { const d = Math.hypot(k.def.x - cp.x, k.def.z - cp.z); const vis = k.shell ? k.shell.root.visible : false; if ((d < 105 && k.shell && !vis) || (d > 115 && vis)) wrong.push(`${k.def.name}:${d.toFixed(0)}:${vis}`); }
      const T = cp.constructor; const fwd = g.renderer.camera.getWorldDirection(new T());
      let behind = 0, behindShown = 0, front = 0, frontHidden = 0;
      for (const n of g.pop.npcs) {
        if (n.char.inVehicle || n.char.pos.distanceTo(g.player.pos) < 8) continue;
        const dot = (n.char.pos.x - cp.x) * fwd.x + (n.char.pos.z - cp.z) * fwd.z;
        if (dot < -20) { behind++; if (n.char.human.mesh.visible) behindShown++; }
        if (dot > 10 && n.char.pos.distanceTo(g.player.pos) < 25 && Math.abs((n.char.pos.x - cp.x) * fwd.z - (n.char.pos.z - cp.z) * fwd.x) < 5) { front++; if (!n.char.human.mesh.visible) frontHidden++; }
      }
      return { wrong, behind, behindShown, front, frontHidden, stores: R.kiosks.length };
    });
    expect(r.wrong).toEqual([]);
    expect(r.behindShown).toBe(0);
    expect(r.frontHidden).toBe(0);
  });

  await S('night time renders cleanly', async () => {
    await resetFoot(page);
    await page.evaluate(() => { (window as any).__meridian.sandbox.act('hour', 23.5); (window as any).__meridian.sandbox.act('clock', false); });
    await step(page, 2, { render: true });
    expect(await page.evaluate(() => (window as any).__game.renderer.stats.calls)).toBeGreaterThan(10);
  });

  await S('pier / water: swim, a car floods', async () => {
    await page.evaluate(() => { (window as any).__meridian.sandbox.act('god', false); });
    const walk = await page.evaluate(() => {
      const g = (window as any).__game; g.player.place(10, 0.3, 930, 0);
      g.input.press('KeyW'); for (let i = 0; i < 25 * 30; i++) { g.cam.yaw = Math.PI; g.frame(1 / 30, false); } g.input.release('KeyW');
      return { swimming: g.player.swimming, alive: g.player.alive };
    });
    expect(walk).toEqual({ swimming: true, alive: true });
    const car = await page.evaluate(() => {
      const g = (window as any).__game; g.player.place(0, 0.3, 925, 0);
      const v = g.vehicles.spawn('sedan', 0, 925, 0); v.persistent = true; g.seatPlayer(v);
      g.input.press('KeyW'); for (let i = 0; i < 300; i++) g.frame(1 / 30, false); g.input.release('KeyW');
      for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
      return { flooded: v.flooded, inCar: !!g.playerVehicle, alive: g.player.alive };
    });
    expect(car).toEqual({ flooded: true, inCar: false, alive: true });
    await page.evaluate(() => { const g = (window as any).__game; g.player.place(-200, 0.3, 150, 0); for (let i = 0; i < 30; i++) g.frame(1 / 30, false); });
  });

  await S('save from the pause menu, settings persist, Continue restores', async () => {
    await page.evaluate(() => { const g = (window as any).__game; g.money = 4242; g.hour = 21.5; (window as any).__meridian.sandbox.act('clock', true); g.player.place(-200, 0.3, 150, 0); });
    await step(page, 0.3);
    await page.evaluate(() => (window as any).__meridian.pause());
    await page.locator('.ma-ptab', { hasText: 'Quit' }).click();
    await page.getByRole('button', { name: 'Save game' }).click();
    await expect(page.getByText('Game saved')).toBeVisible();
    await page.evaluate(() => { const m = (window as any).__meridian; m.settings.sensitivity = 1.6; m.settings.quality = 'low'; localStorage.setItem('meridian-afterglow.settings.v1', JSON.stringify(m.settings)); });
    await page.goto('./', { waitUntil: 'commit', timeout: 180_000 }); // CI: a reload after a long session can exceed the default navigation timeout
    await expect(page.getByText('Press any key')).toBeVisible({ timeout: 180_000 });
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!(window as any).__meridian?.activities, null, { timeout: 180_000 });
    await page.evaluate(() => (window as any).__game.stop());
    expect(await page.evaluate(() => (window as any).__meridian.read().money)).toBeGreaterThanOrEqual(4242);
    expect(await page.evaluate(() => (window as any).__meridian.settings.sensitivity)).toBeCloseTo(1.6);
    expect(await page.evaluate(() => (window as any).__game.renderer.qualityName)).toBe('low');
    await step(page, 2, { render: true });
  });
  clean(p);
});
