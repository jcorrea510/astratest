import { test, expect } from '@playwright/test';
import { watch, boot, step, clean, state, quietStreets } from './helpers';

/** One test per bug found in review / bug-bash, so they stay fixed. */
test.describe.configure({ mode: 'serial' });

test('bailing out of a fast car at low health shows the down screen and respawns', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-420, 0.3, -102, 0); const v = g.vehicles.spawn('sedan', -420, -98, -Math.PI / 2); v.persistent = true; g.seatPlayer(v); g.player.health = 5; });
  await step(page, 3, { hold: ['KeyW'] });
  expect(await state<number>(page, 'Math.abs(window.__game.playerVehicle.speed)')).toBeGreaterThan(9);
  await page.evaluate(() => (window as any).__game.exitVehicle());
  await step(page, 0.5);
  expect(await state<number>(page, 'window.__game.deathT')).toBeGreaterThanOrEqual(0);
  await step(page, 7);
  expect(await state<boolean>(page, 'window.__game.player.alive')).toBe(true);
  expect(await state<number>(page, 'window.__game.deathT')).toBe(-1);
  clean(p);
});

test('a repair never dents other cars of the same model; the garage hall charges only for a real repair, once per visit', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const a = (window as any).__meridian.activities;
    const sum = (geo: any) => { const arr = geo.attributes.position.array; let s = 0; for (let i = 0; i < arr.length; i += 7) s += arr[i]; return s; };
    const other = g.vehicles.spawn('sedan', -150, 60, 0); other.persistent = true;
    const tplSum = sum(other.tpl.body);
    const v = g.vehicles.spawn('sedan', -182, 100, 0); v.persistent = true; g.seatPlayer(v);
    const visit = (click: boolean) => {
      v.phys.teleport(-182, 0.6, 121, 0); for (let i = 0; i < 110; i++) g.frame(1 / 30, false); // door closes, menu opens
      const m0 = g.money, open = a.garage.state === 'menu';
      if (click) (document.querySelector('[data-act="repair"]') as HTMLElement).click();
      const spent = m0 - g.money;
      (document.querySelector('.ma-garage .ma-btn') as HTMLElement).click(); // Leave
      for (let i = 0; i < 70; i++) g.frame(1 / 30, false);
      v.phys.teleport(-182, 0.6, 100, 0); for (let i = 0; i < 10; i++) g.frame(1 / 30, false); // out of the hall again
      return { spent, open, idle: a.garage.state === 'idle' && !g.paused };
    };
    g.money = 1000;
    const clean = visit(true); // clean car: nothing to repair, nothing charged
    v.damage(400, v.position.clone(), null);
    const dirty = visit(true); // damaged car: one charge
    v.damage(400, v.position.clone(), null); // dent again after the repair
    return { clean, dirty, tplUnchanged: Math.abs(sum(other.tpl.body) - tplSum) < 1e-6, otherShared: other.tpl.lods.some((l: any) => l.body === other.bodyMesh.geometry), vOwn: v.bodyMesh.geometry !== v.tpl.body };
  });
  expect(r.clean).toEqual({ spent: 0, open: true, idle: true });
  expect(r.dirty.open).toBe(true); expect(r.dirty.idle).toBe(true);
  expect(r.dirty.spent).toBeGreaterThan(60);
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
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-50, 1.3, 1010, 0); /* the pier moved north with the map (snack stand z 965, end z 1055) */ for (let i = 0; i < 20; i++) g.frame(1 / 30, false); (window as any).__meridian.save(); });
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
  await page.evaluate(() => { const g = (window as any).__game; const k = (window as any).__meridian.activities.guns.kiosk; const c = k.frame.customer; /* the counter, wherever the store now stands (it moved in Round 9) */ g.player.place(c.x, c.y + 0.2, c.z, 0); g.input.tap('KeyE'); g.frame(1 / 30, false); });
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

test('playtest fixes: populated start, fast police response, damage cap', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  expect(await state<number>(page, 'window.__game.traffic.cars.length')).toBeGreaterThanOrEqual(5);
  expect(await state<number>(page, 'window.__game.pop.npcs.length')).toBeGreaterThanOrEqual(6);
  // police show up quickly at heat 2+
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-150, 0.3, -96, 0); g.police.report('kill', g.player.pos); g.police.state.add('kill'); });
  await step(page, 8);
  expect(await state<number>(page, 'window.__game.police.units.length + window.__game.police.foot.length')).toBeGreaterThan(0);
  // damage cap: a single burst can't take more than 45 health in one second
  const hp = await page.evaluate(() => { const g = (window as any).__game; g.player.health = 100; g.player.armor = 0; for (let i = 0; i < 20; i++) g.player.damage(20, null, g.time + 100); return g.player.health; });
  expect(hp).toBeGreaterThanOrEqual(55);
  clean(p);
});

// ---------- Bug-bash pass 1 ----------
test('the sea is water: walk in and swim, a car driven in floods, swim back out onto the beach', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const walk = await page.evaluate(() => {
    const g = (window as any).__game; g.player.place(10, 0.3, 930, 0);
    g.input.press('KeyW'); for (let i = 0; i < 25 * 30; i++) { g.cam.yaw = Math.PI; g.frame(1 / 30, false); } g.input.release('KeyW');
    return { z: g.player.pos.z, swimming: g.player.swimming };
  });
  expect(walk.z).toBeGreaterThan(985); // the beach ends at COAST_Z (962)
  expect(walk.swimming).toBe(true);
  const back = await page.evaluate(() => {
    const g = (window as any).__game; g.player.place(10, -2.4, 1020, 0);
    g.input.press('KeyW'); for (let i = 0; i < 35 * 30; i++) { g.cam.yaw = 0; g.frame(1 / 30, false); } g.input.release('KeyW');
    return { z: g.player.pos.z, swimming: g.player.swimming, grounded: g.player.grounded };
  });
  expect(back.swimming).toBe(false);
  expect(back.grounded).toBe(true);
  expect(back.z).toBeLessThan(962);
  const car = await page.evaluate(() => {
    // (x 10, on the line the swimmer walked: x 0, z 925 is the foot of the Promenade hop jump ramp, which hung the car up on
    // its edge in 2 of 3 runs once the ramp moved there - CI shard 5)
    const g = (window as any).__game; g.player.place(10, 0.3, 928, 0);
    const v = g.vehicles.spawn('sedan', 10, 928, 0); v.persistent = true; g.seatPlayer(v);
    g.input.press('KeyW'); for (let i = 0; i < 300; i++) g.frame(1 / 30, false); g.input.release('KeyW');
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    // the car floods where the beach shelves off, so the driver surfaces wading: a few strokes out and they swim
    g.input.press('KeyW'); for (let i = 0; i < 90; i++) { g.cam.yaw = Math.PI + 1.0; g.frame(1 / 30, false); } g.input.release('KeyW');
    return { flooded: v.flooded, inCar: !!g.playerVehicle, swimming: g.player.swimming, alive: g.player.alive, at: [+v.position.x.toFixed(1), +v.position.z.toFixed(1)], hits: (g.vehicles.list as any[]).filter((o) => o !== v && Math.hypot(o.position.x - v.position.x, o.position.z - v.position.z) < 8).map((o) => o.kind), peds: (g.pop.npcs as any[]).filter((n) => Math.hypot(n.pos.x - v.position.x, n.pos.z - v.position.z) < 6).length };
  });
  console.log('sea car', JSON.stringify(car));
  expect(car).toMatchObject({ flooded: true, inCar: false, swimming: true, alive: true });
  clean(p);
});

test('getting out next to the pier railing keeps you on the pier', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const spots = await page.evaluate(() => {
    const g = (window as any).__game; const out: number[][] = [];
    // the pier deck starts at z 925 (maxZ + 7; the map grew south in Round 9); the first spot is the start of the deck
    for (const [x, z] of [[-43.4, 930], [-43.4, 960], [-56.6, 980]]) {
      if (g.playerVehicle) g.exitVehicle(true);
      g.player.place(x, 1.3, z, 0); for (let i = 0; i < 6; i++) g.frame(1 / 30, false); // let the static collider stream reach the pier
      const v = g.vehicles.spawn('sedan', x, z, 0, 0, 1.6); v.persistent = true; g.seatPlayer(v);
      for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
      g.input.tap('KeyF'); for (let i = 0; i < 150; i++) g.frame(1 / 30, false);
      out.push([g.player.pos.x, g.player.pos.y, g.player.swimming ? 1 : 0]);
    }
    return out;
  });
  for (const [x, y, swim] of spots) { expect(y).toBeGreaterThan(0.8); expect(x).toBeGreaterThan(-56.6); expect(x).toBeLessThan(-43.4); expect(swim).toBe(0); }
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
    // why it waits, sampled every 5 s (a failure used to say only how far behind it stood)
    const why: any[] = [];
    for (let i = 0; i < 45 * 30; i++) {
      g.frame(1 / 30, false);
      if (i % 150 === 149) {
        const bb = car.blockedBy, pp = car.v.position;
        let np = 99; for (const n of g.pop.npcs) if (n.alive && !n.char.inVehicle) np = Math.min(np, n.char.pos.distanceTo(pp));
        why.push({ t: (i + 1) / 30, v: +car.v.speed.toFixed(1), lane: car.lane.id, avoid: car.avoid ? car.avoid.side : 0, bT: +(car.blockedT ?? 0).toFixed(1), legit: car.legitWait, by: bb ? (bb === parked ? 'parked' : bb.kind) : null, mode: car.mode, pl: +g.player.pos.distanceTo(pp).toFixed(1), np: +np.toFixed(1) });
      }
    }
    const dx = car.v.position.x - block.x, dz = car.v.position.z - block.z;
    return { past: dx * Math.sin(block.yaw) + dz * Math.cos(block.yaw), inTraffic: g.traffic.cars.includes(car), parkedHealth: parked.health / parked.spec.health, why };
  });
  expect(r.inTraffic).toBe(true);
  expect(r.past, JSON.stringify(r)).toBeGreaterThan(5);
  clean(p);
});

test('beach stunt ramps pay when hit from Coastal Drive', async ({ page }) => {
  test.setTimeout(300_000);
  const p = watch(page);
  await boot(page);
  await quietStreets(page); // a scripted drive: no traffic in the way of the run-up
  const res = await page.evaluate(() => {
    const g = (window as any).__game; const out: number[] = [];
    const ROAD_Z = 913.5, RAMP_Z = 921.5; // eastbound lane of Coastal Drive (the last street, z 910) and the promenade ramps
    for (const rx of [0, 200]) { // Promenade hop, Strand flyer
      if (g.playerVehicle) { const o = g.playerVehicle; g.exitVehicle(true); g.vehicles.remove(o); }
      const x0 = Math.max(rx - 160, -155); g.player.place(x0, 0.3, ROAD_Z, 0); // full-speed run-up; the drive starts at x -165 (river west of it)
      const v = g.vehicles.spawn('sedan', x0, ROAD_Z, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
      for (let i = 0; i < 9; i++) g.frame(1 / 30, false);
      const m0 = g.money; g.input.press('KeyW'); let flown = false, landed = false;
      for (let s = 0; s < 600; s++) {
        const q = v.position, f = v.phys.forward();
        if (!v.phys.grounded && q.x > rx - 4) flown = true;
        if (flown && v.phys.grounded) landed = true;
        g.input.release('KeyA'); g.input.release('KeyD');
        if (landed) { g.input.release('KeyW'); g.input.press('KeyS'); if (Math.abs(v.speed) < 0.5) break; } // brake on the sand, short of the sea
        else if (q.x > rx + 4) g.input.release('KeyW'); // off the lip: coast through the air
        else {
          const lead = q.x < rx - 30 ? { x: q.x + 20, z: ROAD_Z } : { x: rx + Math.sin(1.2) * 10, z: RAMP_Z + Math.cos(1.2) * 10 };
          const lx = (lead.x - q.x) * f.z - (lead.z - q.z) * f.x;
          if (lx > 0.8) g.input.press('KeyA'); else if (lx < -0.8) g.input.press('KeyD');
        }
        g.frame(1 / 30, false);
      }
      for (const k of ['KeyW', 'KeyA', 'KeyD', 'KeyS']) g.input.release(k);
      for (let s = 0; s < 60; s++) g.frame(1 / 30, false);
      out.push(g.money - m0, v.flooded || v.destroyed ? 1 : 0);
    }
    return out;
  });
  expect(res).toEqual([300, 0, 300, 0]); // paid, and the car is still dry and in one piece
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

test('sandbox: spawning from a car puts the new car ahead', async ({ page }) => {
  const p = watch(page);
  await boot(page);
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

test('sandbox tools are a pause-menu tab; sliders can be dragged; quitting a debug-URL game lands on the title', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => (window as any).__meridian.pause());
  await page.locator('.ma-ptab', { hasText: 'Tools' }).click();
  await expect(page.getByLabel('Heat level')).toBeVisible();
  // a drag is a stream of input events on the same element: the panel must not rebuild (and drop) the slider mid-drag
  const drag = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Heat level"]') as HTMLInputElement; let attached = true;
    for (const v of [1, 2, 3, 4, 5]) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); attached = attached && el.isConnected; }
    return attached;
  });
  expect(drag).toBe(true);
  expect(await state<number>(page, 'window.__game.police.heat')).toBe(5);
  await page.evaluate(() => (window as any).__meridian.quit());
  await page.waitForURL(u => !u.search.includes('autostart'), { timeout: 60_000 });
  await expect(page.getByText('Press any key')).toBeVisible({ timeout: 180_000 });
  clean(p);
});

// ---------- Bug-bash B ----------
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
  // Round 9 moved the garage into drive-in halls (src/game/bays.ts): drive into the Glow Garage, respray from the menu, leave;
  // the "Stop inside" prompt must not come back while the car is still standing in the hall.
  test.setTimeout(400_000);
  const p = watch(page);
  await boot(page); await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, A = (window as any).__meridian.activities;
    g.money = 1000; g.police.clear();
    const v = g.vehicles.spawn('sedan', -182, 100, 0, -1, 0.4); v.persistent = true; g.seatPlayer(v);
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    v.damage(300, v.position.clone(), null);
    let before: string | null = null, n = 0;
    while (A.garage.state === 'idle' && n++ < 400) {
      if (v.position.z > 115 && before === null) before = A.prompt();
      if (v.position.z < 119) g.input.press('KeyW'); else { g.input.release('KeyW'); g.input.press('KeyS'); }
      g.frame(1 / 30, false);
    }
    g.input.release('KeyW'); g.input.release('KeyS');
    n = 0; while (A.garage.state !== 'menu' && n++ < 200) g.frame(1 / 30, false);
    const menu = A.garage.state;
    (document.querySelectorAll('.ma-garage-sw')[2] as HTMLElement).focus();
    (document.querySelector('[data-act="paint"]') as HTMLElement).click();
    const leave = document.querySelector('.ma-garage .ma-garage-exit') as HTMLElement; // the leave button (reads "Exit Bay" since Round 16)
    leave.click();
    n = 0; while (A.garage.state !== 'idle' && n++ < 200) g.frame(1 / 30, false);
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    return { before, menu, paid: 1000 - g.money, inHall: A.garageAt(v.position) >= 0, after: A.prompt() };
  });
  console.log('respray', JSON.stringify(r));
  expect(r.before).toContain('Stop inside');
  expect(r.menu).toBe('menu');
  expect(r.paid).toBe(150);
  expect(r.inHall).toBe(true);
  expect(r.after).toBe(null);
  clean(p);
});

test('a car despawned mid car-entry job drops the job instead of panicking the physics world', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(-420, 0.3, -102, 0);
    const v = g.vehicles.spawn('sedan', -420, -98, -Math.PI / 2); v.persistent = true;
    g.player.place(v.doorPoint(1).x, v.position.y, v.doorPoint(1).z, 0); g.input.tap('KeyF');
    for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    const started = g.carEntry.active;
    g.vehicles.remove(v); // what traffic does when the player teleports away
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    return { started, active: g.carEntry.active };
  });
  expect(r.active).toBe(false);
  clean(p);
});

test('standing on the clerk spot behind a store counter does not pop anyone up through the ceiling', async ({ page }) => {
  test.setTimeout(240_000);
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game, R = (window as any).__meridian.activities.robberies; const out: { i: number; dy: number; clerkDy: number }[] = [];
    for (const i of [30, 33, 51]) {
      const k = R.kiosks[i]; g.police.clear();
      const c = k.frame.toWorld(-3.0, 0.05, 0.25);
      g.player.place(c.x, c.y + 0.1, c.z, 0);
      for (let f = 0; f < 30 * 6; f++) g.frame(1 / 30, false);
      const l = k.frame.toLocal(g.player.pos), cl = k.clerk ? k.frame.toLocal(k.clerk.pos) : { y: 0 };
      out.push({ i, dy: l.y, clerkDy: cl.y });
    }
    return out;
  });
  for (const o of r) { expect(o.dy, `player in store ${o.i}`).toBeLessThan(0.5); expect(o.clerkDy, `clerk in store ${o.i}`).toBeLessThan(0.5); }
  clean(p);
});
