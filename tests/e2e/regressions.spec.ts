import { test, expect } from '@playwright/test';
import { watch, boot, step, clean, state, quietStreets } from './helpers';

/** One test per bug found in review / bug-bash, so they stay fixed. */
test.describe.configure({ mode: 'serial' });

test('bailing out of a fast car at low health shows the down screen and respawns', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-420, 0.3, -102, 0); const v = g.vehicles.spawn('sedan', -420, -98, -Math.PI / 2); v.persistent = true; g.seatPlayer(v); g.player.health = 5; });
  await step(page, 2, { hold: ['KeyW'] });
  expect(await state<number>(page, 'Math.abs(window.__game.playerVehicle.speed)')).toBeGreaterThan(9);
  await page.evaluate(() => (window as any).__game.exitVehicle());
  await step(page, 0.5);
  expect(await state<number>(page, 'window.__game.deathT')).toBeGreaterThanOrEqual(0);
  await step(page, 5);
  expect(await state<boolean>(page, 'window.__game.player.alive')).toBe(true);
  expect(await state<number>(page, 'window.__game.deathT')).toBe(-1);
  clean(p);
});

test('a respray never dents other cars of the same model; the garage only charges once per visit and not for clean cars', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const a = (window as any).__meridian.activities;
    const sum = (geo: any) => { const arr = geo.attributes.position.array; let s = 0; for (let i = 0; i < arr.length; i += 7) s += arr[i]; return s; };
    const other = g.vehicles.spawn('sedan', -150, 60, 0); other.persistent = true;
    const tplSum = sum(other.tpl.body);
    const v = g.vehicles.spawn('sedan', -200, 102, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
    // clean car: no charge
    const m0 = g.money; for (let i = 0; i < 120; i++) g.frame(1 / 30, false);
    const cleanCharge = m0 - g.money;
    // damaged car: one charge, then sitting there costs nothing more
    g.playerVehicle.phys.teleport(-260, 0.6, 102, Math.PI / 2); for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    v.damage(400, v.position.clone(), null);
    g.money = 1000;
    g.playerVehicle.phys.teleport(-200, 0.6, 102, Math.PI / 2);
    for (let i = 0; i < 600; i++) g.frame(1 / 30, false);
    const charged = 1000 - g.money;
    v.damage(400, v.position.clone(), null); // dent again after respray
    void a;
    return { cleanCharge, charged, tplUnchanged: Math.abs(sum(other.tpl.body) - tplSum) < 1e-6, otherShared: other.bodyMesh.geometry === other.tpl.body, vOwn: v.bodyMesh.geometry !== v.tpl.body };
  });
  expect(r.cleanCharge).toBe(0);
  expect(r.charged).toBe(150);
  expect(r.tplUnchanged).toBe(true);
  expect(r.otherShared).toBe(true);
  expect(r.vOwn).toBe(true);
  clean(p);
});

test('dead officers and wrecked cruisers are not kept forever', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.police.report('copKill', g.player.pos); });
  await step(page, 20);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    for (const n of g.police.foot) n.char.damage(1000, g.player, g.time);
    for (const u of g.police.units) u.v.damage(5000, u.v.position.clone(), null);
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    const deadPersistent = g.pop.npcs.filter((n: any) => n.role === 'police' && !n.alive && n.persistent).length;
    const wreckPersistent = g.vehicles.list.filter((v: any) => v.kind === 'police' && v.destroyed && v.persistent).length;
    return { deadPersistent, wreckPersistent };
  });
  expect(r.deadPersistent).toBe(0);
  expect(r.wreckPersistent).toBe(0);
  clean(p);
});

test('race rivals wait for the countdown', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const M = (window as any).__meridian.missions; for (const id of ['m1', 'm2', 'm3', 'm4']) M.completed.add(id); M.start(M.available()[0]); });
  await step(page, 1);
  await page.evaluate(() => { const g = (window as any).__game; const v = g.vehicles.list.filter((x: any) => x.kind === 'coupe' && x.persistent).sort((a: any, b: any) => Math.hypot(a.position.x + 443.5, a.position.z - 406.7) - Math.hypot(b.position.x + 443.5, b.position.z - 406.7))[0]; g.seatPlayer(v); v.phys.teleport(-436, 0.7, 403.5, Math.PI / 2); });
  await step(page, 2.2);
  const speeds = await state<number[]>(page, 'window.__game.traffic.cars.filter(c => c.v.kind === "coupe" && c.persistent).map(c => Math.abs(c.v.speed))');
  expect(speeds.length).toBe(3);
  for (const s of speeds) expect(s).toBeLessThan(2);
  await step(page, 4);
  const after = await state<number[]>(page, 'window.__game.traffic.cars.filter(c => c.v.kind === "coupe" && c.persistent).map(c => Math.abs(c.v.speed))');
  expect(Math.max(...after)).toBeGreaterThan(5);
  clean(p);
});

test('dying while getting into a car does not seat the body', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-280, 0.25, -95.5, Math.PI / 2); g.vehicles.spawn('sedan', -278, -97.5, Math.PI / 2).persistent = true; });
  await step(page, 0.3);
  await page.evaluate(() => { const g = (window as any).__game; g.toggleVehicle(); g.frame(1 / 30, false); g.player.damage(1000, null, g.time); g.playerDown('down'); });
  await step(page, 1.5);
  expect(await state<boolean>(page, '!!window.__game.playerVehicle')).toBe(false);
  clean(p);
});

test('saving on the pier deck loads back onto the deck', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-50, 1.3, 470, 0); for (let i = 0; i < 20; i++) g.frame(1 / 30, false); (window as any).__meridian.save(); });
  await page.goto('./?autostart=1&continue=1');
  await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__game.stop());
  await step(page, 1);
  expect(await state<number>(page, 'window.__game.player.pos.y')).toBeGreaterThan(1);
  expect(await state<boolean>(page, 'window.__game.player.swimming')).toBe(false);
  clean(p);
});

test('pausing closes the shop; the wheel never spends a medkit on a downed player', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-300, 0.25, 10.2, 0); g.input.tap('KeyE'); g.frame(1 / 30, false); });
  expect(await state<boolean>(page, 'window.__meridian.activities.shopIsOpen')).toBe(true);
  await page.evaluate(() => { (window as any).__meridian.pause(); (window as any).__meridian.resume(); });
  expect(await state<boolean>(page, 'window.__meridian.activities.shopIsOpen')).toBe(false);
  expect(await state<boolean>(page, 'window.__game.menuOpen')).toBe(false);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const M = (window as any).__meridian;
    g.pcombat.inv.medkits = 2; g.player.health = 30;
    M.openWheel();
    for (let i = 0; i < 4; i++) { g.input.mouseDX = -60; g.frame(1 / 30, false); }
    g.player.damage(1000, null, g.time); g.playerDown('down');
    for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
    return { medkits: g.pcombat.inv.medkits, wheel: g.wheelOpen };
  });
  expect(r.medkits).toBe(2);
  expect(r.wheel).toBe(false);
  clean(p);
});

test('playtest fixes: populated start, M3 enemies on the ground, fast police response, damage cap, no respray charge after a delivery', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  expect(await state<number>(page, 'window.__game.traffic.cars.length')).toBeGreaterThanOrEqual(5);
  expect(await state<number>(page, 'window.__game.pop.npcs.length')).toBeGreaterThanOrEqual(6);
  // M3 enemies must all stand on the ground (none on warehouse roofs)
  const ys = await page.evaluate(() => {
    const g = (window as any).__game; const M = (window as any).__meridian.missions;
    for (const id of ['m1', 'm2']) M.completed.add(id);
    M.start(M.available().find((d: any) => d.id === 'm3'));
    g.player.place(398, 0.3, 100, 0);
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    return g.pop.npcs.filter((n: any) => n.role === 'gang' && n.persistent).map((n: any) => n.pos.y);
  });
  expect(ys.length).toBe(8);
  for (const y of ys) expect(y).toBeLessThan(1);
  await page.evaluate(() => { (window as any).__meridian.missions.abort(); });
  // police show up quickly at heat 2+
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-150, 0.3, -96, 0); g.police.report('kill', g.player.pos); g.police.state.add('kill'); });
  await step(page, 8);
  expect(await state<number>(page, 'window.__game.police.units.length + window.__game.police.foot.length')).toBeGreaterThan(0);
  // damage cap: a single burst can't take more than 45 health in one second
  const hp = await page.evaluate(() => { const g = (window as any).__game; g.player.health = 100; g.player.armor = 0; for (let i = 0; i < 20; i++) g.player.damage(20, null, g.time + 100); return g.player.health; });
  expect(hp).toBeGreaterThanOrEqual(55);
  // M1 delivery at the garage doesn't trigger a paid respray
  await page.evaluate(() => { const g = (window as any).__game; g.police.clear(); g.player.health = 100; });
  const money = await page.evaluate(() => {
    const g = (window as any).__game; const M = (window as any).__meridian.missions;
    M.completed.clear(); M.start(M.available()[0]);
    const v = g.vehicles.spawn('sedan', -262, -96, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    v.phys.teleport(470, 0.7, 120, 0); for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    v.damage(300, v.position.clone(), null);
    const before = g.money;
    v.phys.teleport(-200, 0.7, 102, Math.PI / 2); for (let i = 0; i < 200; i++) g.frame(1 / 30, false);
    return { gained: g.money - before, done: M.completed.has('m1') };
  });
  expect(money.done).toBe(true);
  expect(money.gained).toBe(600);
  clean(p);
});

// ---------- Bug-bash pass 1 ----------
test('the sea is water: walk in and swim, a car driven in floods, swim back out onto the beach', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const walk = await page.evaluate(() => {
    const g = (window as any).__game; g.player.place(10, 0.3, 430, 0);
    g.input.press('KeyW'); for (let i = 0; i < 25 * 30; i++) { g.cam.yaw = Math.PI; g.frame(1 / 30, false); } g.input.release('KeyW');
    return { z: g.player.pos.z, swimming: g.player.swimming };
  });
  expect(walk.z).toBeGreaterThan(455);
  expect(walk.swimming).toBe(true);
  const back = await page.evaluate(() => {
    const g = (window as any).__game; g.player.place(10, -2.4, 520, 0);
    g.input.press('KeyW'); for (let i = 0; i < 35 * 30; i++) { g.cam.yaw = 0; g.frame(1 / 30, false); } g.input.release('KeyW');
    return { z: g.player.pos.z, swimming: g.player.swimming, grounded: g.player.grounded };
  });
  expect(back.swimming).toBe(false);
  expect(back.grounded).toBe(true);
  expect(back.z).toBeLessThan(455);
  const car = await page.evaluate(() => {
    const g = (window as any).__game; g.player.place(0, 0.3, 405, 0);
    const v = g.vehicles.spawn('sedan', 0, 405, 0); v.persistent = true; g.seatPlayer(v);
    g.input.press('KeyW'); for (let i = 0; i < 300; i++) g.frame(1 / 30, false); g.input.release('KeyW');
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    return { flooded: v.flooded, inCar: !!g.playerVehicle, swimming: g.player.swimming, alive: g.player.alive };
  });
  expect(car).toEqual({ flooded: true, inCar: false, swimming: true, alive: true });
  clean(p);
});

test('getting out next to the pier railing keeps you on the pier', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const spots = await page.evaluate(() => {
    const g = (window as any).__game; const out: number[][] = [];
    for (const [x, z] of [[-43.4, 470], [-43.4, 500], [-56.6, 520]]) {
      if (g.playerVehicle) g.exitVehicle(true);
      const v = g.vehicles.spawn('sedan', x, z, 0, 0, 1.6); v.persistent = true; g.seatPlayer(v);
      for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
      g.input.tap('KeyF'); for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
      out.push([g.player.pos.x, g.player.pos.y, g.player.swimming ? 1 : 0]);
    }
    return out;
  });
  for (const [x, y, swim] of spots) { expect(y).toBeGreaterThan(0.8); expect(x).toBeGreaterThan(-56.6); expect(x).toBeLessThan(-43.4); expect(swim).toBe(0); }
  clean(p);
});

test('race rivals follow the route and keep racing', async ({ page }) => {
  test.setTimeout(600_000);
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const M = (window as any).__meridian.missions; for (const id of ['m1', 'm2', 'm3', 'm4']) M.completed.add(id); M.start(M.available()[0]); });
  await step(page, 1);
  await page.evaluate(() => { const g = (window as any).__game; const v = g.vehicles.list.filter((x: any) => x.kind === 'coupe' && x.persistent).sort((a: any, b: any) => Math.hypot(a.position.x + 443.5, a.position.z - 406.7) - Math.hypot(b.position.x + 443.5, b.position.z - 406.7))[0]; g.seatPlayer(v); v.phys.teleport(-436, 0.7, 403.5, Math.PI / 2); });
  await step(page, 6);
  for (let i = 0; i < 9; i++) await step(page, 10);
  const cp = await state<number[]>(page, 'window.__meridian.missions.active.run.rivalProgress()');
  // after 90 s every rival is well into the 11-checkpoint course (they used to get lost after checkpoint 2)
  expect(Math.max(...cp), JSON.stringify(cp)).toBeGreaterThanOrEqual(6);
  expect(cp.filter(c => c >= 4).length, JSON.stringify(cp)).toBeGreaterThanOrEqual(2);
  clean(p);
});

test('traffic pulls out and passes a car abandoned in its lane', async ({ page }) => {
  test.setTimeout(300_000);
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    // a long straight lane near the start
    const lanes = g.city.lanes.filter((l: any) => !l.connector && l.length > 80);
    const at = (l: any, s: number) => { let i = 1; while (i < l.points.length - 1 && l.cum[i] < s) i++; const a = l.points[i - 1], b = l.points[i]; const t = (s - l.cum[i - 1]) / Math.max(1e-6, l.cum[i] - l.cum[i - 1]); return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(b.x - a.x, b.z - a.z) }; };
    lanes.sort((a: any, b: any) => { const pa = at(a, 40), pb = at(b, 40); return Math.hypot(pa.x - g.player.pos.x, pa.z - g.player.pos.z) - Math.hypot(pb.x - g.player.pos.x, pb.z - g.player.pos.z); });
    const lane = lanes[0];
    const block = at(lane, 45);
    const parked = g.vehicles.spawn('sedan', block.x, block.z, block.yaw); parked.persistent = true;
    for (const c of [...g.traffic.cars]) if (c.lane === lane) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); }
    const car = g.traffic.spawnOnLane('hatch', lane, 8); car.persistent = true; car.v.persistent = true; car.driver.persistent = true;
    for (let i = 0; i < 45 * 30; i++) g.frame(1 / 30, false);
    const dx = car.v.position.x - block.x, dz = car.v.position.z - block.z;
    return { past: dx * Math.sin(block.yaw) + dz * Math.cos(block.yaw), inTraffic: g.traffic.cars.includes(car), parkedHealth: parked.health / parked.spec.health };
  });
  expect(r.inTraffic).toBe(true);
  expect(r.past, JSON.stringify(r)).toBeGreaterThan(5);
  clean(p);
});

test('beach stunt ramps pay when hit from Coastal Drive', async ({ page }) => {
  test.setTimeout(300_000);
  const p = watch(page);
  await boot(page);
  const res = await page.evaluate(() => {
    const g = (window as any).__game; const out: number[] = [];
    for (const rx of [-300, 200]) {
      if (g.playerVehicle) { const o = g.playerVehicle; g.exitVehicle(true); g.vehicles.remove(o); }
      const x0 = rx - 110; g.player.place(x0, 0.3, 403.5, 0);
      const v = g.vehicles.spawn('sedan', x0, 403.5, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
      for (let i = 0; i < 9; i++) g.frame(1 / 30, false);
      const m0 = g.money; g.input.press('KeyW');
      for (let s = 0; s < 240; s++) {
        const q = v.position, f = v.phys.forward();
        const lead = q.x < rx - 30 ? { x: q.x + 20, z: 403.5 } : { x: rx + Math.sin(1.2) * 10, z: 411.5 + Math.cos(1.2) * 10 };
        const lx = (lead.x - q.x) * f.z - (lead.z - q.z) * f.x;
        g.input.release('KeyA'); g.input.release('KeyD');
        if (q.x > rx + 4) { g.input.release('KeyW'); if (q.x > rx + 15 && v.phys.grounded) g.input.press('KeyS'); } // jump, land, brake on the sand
        else if (lx > 0.8) g.input.press('KeyA'); else if (lx < -0.8) g.input.press('KeyD');
        g.frame(1 / 30, false);
      }
      for (const k of ['KeyW', 'KeyA', 'KeyD', 'KeyS']) g.input.release(k);
      for (let s = 0; s < 120; s++) g.frame(1 / 30, false);
      out.push(g.money - m0, v.flooded || v.destroyed ? 1 : 0);
    }
    return out;
  });
  expect(res).toEqual([300, 0, 300, 0]); // paid, and the car is still dry and in one piece
  clean(p);
});

test('starting the courier mission leaves your parked car alone', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const kept = await page.evaluate(() => {
    const g = (window as any).__game; const M = (window as any).__meridian.missions;
    M.completed.add('m1');
    g.player.place(-229, 0.3, -101, 0);
    const mine = g.vehicles.spawn('sedan', -229, -98, Math.PI / 2); g.seatPlayer(mine);
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    g.exitVehicle(); for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    g.player.place(-262, 0.25, -106.6, 0);
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
    const van = g.traffic.cars.find((c: any) => c.v.locked);
    return { active: M.active?.def.id, kept: g.vehicles.list.includes(mine), van: !!van, gap: van ? Math.hypot(van.v.position.x - mine.position.x, van.v.position.z - mine.position.z) : 0 };
  });
  expect(kept.active).toBe('m2');
  expect(kept.kept).toBe(true);
  expect(kept.van).toBe(true);
  expect(kept.gap).toBeGreaterThan(5);
  clean(p);
});

test('a mission contact who is hurt does not pop back in beside the body', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const M = (window as any).__meridian.missions;
    g.player.place(-280, 0.3, -106.6, 0);
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    const juno = M.contacts.get('Juno'); juno.char.damage(500, g.player, g.time);
    for (let i = 0; i < 30 * 30; i++) g.frame(1 / 30, false);
    return { hadContact: !!juno, back: M.contacts.has('Juno') };
  });
  expect(r.hadContact).toBe(true);
  expect(r.back).toBe(false);
  clean(p);
});

// ---------- Bug-bash A ----------
test('police in cars find an on-foot player off the road (plaza) and get out', async ({ page }) => {
  test.setTimeout(300_000);
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-200, 0.3, 150, 0);
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    g.police.setHeat(4, g.player.pos);
    let seen = false, nearFoot = 0;
    for (let i = 0; i < 45 * 30; i++) {
      g.player.health = 100; g.frame(1 / 30, false);
      if (g.police.state.seen) seen = true;
      nearFoot = Math.max(nearFoot, g.police.foot.filter((n: any) => n.alive && n.pos.distanceTo(g.player.pos) < 45).length);
      if (g.deathT >= 0) break;
    }
    return { seen, nearFoot };
  });
  expect(r.seen).toBe(true);
  expect(r.nearFoot).toBeGreaterThan(0);
  clean(p);
});

test('a quick tap fires automatic weapons once', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const shots = await page.evaluate(() => {
    const g = (window as any).__game; const out: number[] = [];
    for (const id of ['smg', 'rifle']) {
      g.pcombat.give(id, 60); g.pcombat.inv.select(id);
      for (let i = 0; i < 40; i++) g.frame(1 / 30, false);
      g.input.press('Mouse2'); for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
      const c0 = g.pcombat.inv.state.clip;
      for (let k = 0; k < 3; k++) { g.input.tap('Mouse0'); for (let i = 0; i < 8; i++) g.frame(1 / 30, false); }
      g.input.release('Mouse2');
      out.push(c0 - g.pcombat.inv.state.clip);
    }
    return out;
  });
  expect(shots).toEqual([3, 3]);
  clean(p);
});

test('sandbox: spawning from a car puts the new car ahead; hold-ups stop when a mission starts', async ({ page }) => {
  const p = watch(page);
  await boot(page, '&sandbox=1');
  const ahead = await page.evaluate(() => {
    const g = (window as any).__game, sb = (window as any).__meridian.sandbox; const out: number[] = [];
    for (const yaw of [1.0, -2.0]) {
      if (g.playerVehicle) { const o = g.playerVehicle; g.exitVehicle(true); g.vehicles.remove(o); }
      g.player.place(-200, 0.3, 140, 0);
      const v = g.vehicles.spawn('coupe', -200, 140, yaw); v.persistent = true; g.seatPlayer(v);
      for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
      const n = g.vehicles.list.length; sb.act('kind', 'sedan'); sb.act('spawn');
      const nv = g.vehicles.list[n]; const dx = nv.position.x - v.position.x, dz = nv.position.z - v.position.z;
      out.push(Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - v.yaw), Math.cos(Math.atan2(dx, dz) - v.yaw))));
      g.vehicles.remove(nv);
    }
    return out;
  });
  for (const a of ahead) expect(a).toBeLessThan(0.3);
  clean(p);
});

test('a hold-up is called off when a story mission starts', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, M = (window as any).__meridian; const R = M.activities.robberies; const k = R.kiosks[0];
    g.pcombat.give('pistol', 60); g.pcombat.inv.select('pistol');
    g.player.place(k.def.x + k.front.x * 5, 0.4, k.def.z + k.front.z * 5, 0);
    for (let i = 0; i < 45; i++) g.frame(1 / 30, false);
    k.brave = false; const c = k.clerk; g.input.press('Mouse2');
    for (let i = 0; i < 30; i++) { g.cam.yaw = Math.atan2(-(c.pos.x - g.player.pos.x), -(c.pos.z - g.player.pos.z)); g.frame(1 / 30, false); }
    const during = R.robbing;
    M.missions.start(M.missions.available()[0]);
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    g.input.release('Mouse2');
    return { during, after: R.robbing };
  });
  expect(r).toEqual({ during: true, after: false });
  clean(p);
});

test('sandbox sliders can be dragged; quitting a debug-URL game lands on the title', async ({ page }) => {
  const p = watch(page);
  await boot(page, '&sandbox=1');
  await page.evaluate(() => { const g = (window as any).__game; g.paused = true; g.menuOpen = true; (window as any).__meridian.sandbox.openPanel(() => {}); });
  await expect(page.getByLabel('Wanted level')).toBeVisible();
  // a drag is a stream of input events on the same element: the panel must not rebuild (and drop) the slider mid-drag
  const drag = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Wanted level"]') as HTMLInputElement; let attached = true;
    for (const v of [1, 2, 3, 4, 5]) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); attached = attached && el.isConnected; }
    return attached;
  });
  expect(drag).toBe(true);
  expect(await state<number>(page, 'window.__game.police.heat')).toBe(5);
  await page.evaluate(() => (window as any).__meridian.quit());
  await page.waitForURL(u => !u.search.includes('autostart'), { timeout: 60_000 });
  await expect(page.getByText('New game')).toBeVisible({ timeout: 120_000 });
  clean(p);
});

// ---------- Bug-bash B ----------
test('the race ends (failed) once every rival has crossed the line', async ({ page }) => {
  test.setTimeout(600_000);
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const M = (window as any).__meridian.missions; for (const id of ['m1', 'm2', 'm3', 'm4']) M.completed.add(id); M.start(M.available()[0]); });
  await step(page, 1);
  await page.evaluate(() => { const g = (window as any).__game; const v = g.vehicles.list.filter((x: any) => x.kind === 'coupe' && x.persistent).sort((a: any, b: any) => Math.hypot(a.position.x + 443.5, a.position.z - 406.7) - Math.hypot(b.position.x + 443.5, b.position.z - 406.7))[0]; g.seatPlayer(v); v.phys.teleport(-436, 0.7, 403.5, Math.PI / 2); });
  let st = { active: 'm5' as string | null, last: '' };
  for (let i = 0; i < 30 && st.active; i++) {
    await step(page, 10);
    st = await state<{ active: string | null; last: string }>(page, '({active: window.__meridian.missions.active?.def.id ?? null, last: String(window.__meridian.missions.lastResult)})');
  }
  expect(st.active).toBe(null);
  expect(st.last).toContain('m5:failed:The Coastline crew');
  clean(p);
});

// ---------- Bug-bash C ----------
test('saving while swimming at sea loads you at the safehouse, not in the water', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, M = (window as any).__meridian;
    g.player.place(-200, -2.4, 600, 0);
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    const swimming = g.player.swimming;
    M.save(); const s = M.read();
    return { swimming, x: s.pos.x, z: s.pos.z };
  });
  expect(r.swimming).toBe(true);
  expect(r.z).toBeLessThan(0);
  clean(p);
});

// ---------- Bug-bash D ----------
test('the respray prompt goes away once the car has been resprayed', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, a = (window as any).__meridian.activities;
    g.money = 1000;
    const v = g.vehicles.spawn('sedan', -260, 102, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    v.damage(300, v.position.clone(), null);
    g.playerVehicle.phys.teleport(-200, 0.6, 102, Math.PI / 2);
    for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    const before = a.prompt();
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
    return { before, paid: 1000 - g.money, after: a.prompt() };
  });
  expect(r.paid).toBe(150);
  expect(r.after).toBe(null);
  clean(p);
});
