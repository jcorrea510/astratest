import { test, expect } from '@playwright/test';
import { boot, watch, clean, quietStreets, step, tap } from './helpers';

/** Side of the car a world point is on: > 0 = the car's left (driver) side. */
const LEFT_OF = `(v, p) => { const s = Math.sin(v.yaw), c = Math.cos(v.yaw); const dx = p.x - v.position.x, dz = p.z - v.position.z; return dx * c - dz * s; }`;

test('getting in walks to the driver door, opens it and takes more than a second', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-280, 0.25, -95.5, Math.PI / 2); const v = g.vehicles.spawn('sedan', -278, -97.5, Math.PI / 2); v.persistent = true; (window as any).__v = v; });
  await step(page, 0.3);
  await tap(page, 'KeyF');
  const trace = await page.evaluate(() => {
    const g = (window as any).__game, v = (window as any).__v; const phases = new Set<string>(); let maxDoor = 0, seatedAt = -1;
    for (let i = 0; i < 300 && seatedAt < 0; i++) { g.frame(1 / 30, false); maxDoor = Math.max(maxDoor, v.doors[0].amount); if (g.carEntry.phase) phases.add(g.carEntry.phase); if (g.playerVehicle === v) seatedAt = i / 30; }
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    const r = g.player.human.root, s = v.seatLocal(0);
    return { maxDoor, seatedAt, phases: [...phases], parent: r.parent === v.visual, dSeat: r.position.distanceTo(s), doorAfter: v.doors[0].open, state: g.player.human.currentState };
  });
  expect(trace.maxDoor).toBeGreaterThan(0.8);       // the driver's door swung open
  expect(trace.seatedAt).toBeGreaterThan(1);         // no teleporting in
  expect(trace.phases).toEqual(expect.arrayContaining(['approach', 'open', 'climb', 'sit', 'turn']));
  expect(trace.parent).toBe(true);
  expect(trace.dSeat).toBeLessThan(0.05);           // sitting in the seat
  expect(trace.doorAfter).toBe(0);                   // and the door shut behind
  expect(trace.state).toBe('drive');
  // throttle works afterwards
  await step(page, 2.5, { hold: ['KeyW'] });
  expect(await page.evaluate(() => (window as any).__game.playerVehicle.speed)).toBeGreaterThan(5);
  clean(p);
});

test('carjacking throws the driver out on the driver (left) side', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const res = await page.evaluate(`(() => {
    const g = window.__game, leftOf = ${LEFT_OF};
    const lane = g.city.lanes.find(l => !l.connector && l.length > 80);
    const car = g.traffic.spawnOnLane('sedan', lane, 30); car.maxSpeed = 0; car.persistent = true; car.passengers = [];
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
    const v = car.v, victim = car.driver;
    const d = v.doorWorldPos(0); g.player.place(d.x, v.position.y - 0.3, d.z, v.yaw);
    for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    g.input.tap('KeyF');
    let landed = null, phases = new Set();
    for (let i = 0; i < 300 && g.playerVehicle !== v; i++) {
      g.frame(1 / 30, false); if (g.carEntry.phase) phases.add(g.carEntry.phase);
      if (!landed && victim.char.inVehicle === null) landed = { side: leftOf(v, victim.char.pos), dist: Math.hypot(victim.char.pos.x - v.position.x, victim.char.pos.z - v.position.z) };
    }
    for (let i = 0; i < 45; i++) g.frame(1 / 30, false);
    return { landed, later: leftOf(v, victim.char.pos), seated: g.playerVehicle === v, phases: [...phases], down: victim.char.downT > 0 || victim.char.knockT > 0 || victim.char.human.actionName };
  })()`) as { landed: { side: number; dist: number } | null; later: number; seated: boolean; phases: string[] };
  expect(res.landed).not.toBeNull();
  expect(res.landed!.side).toBeGreaterThan(1.2);      // outside the driver's door, not the passenger side
  expect(res.later).toBeGreaterThan(1.2);
  expect(res.phases).toContain('jack');
  expect(res.seated).toBe(true);
  clean(p);
});

test('a locked parked car needs the window smashed and a hotwire before it drives', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-276, 0.25, -101, 0); const v = g.vehicles.spawn('coupe', -278, -97.5, 0, 1); v.persistent = true; v.parked = true; v.doorsLocked = true; v.ignition = false; (window as any).__v = v; });
  await step(page, 0.3);
  await tap(page, 'KeyF');
  const r = await page.evaluate(() => {
    const g = (window as any).__game, v = (window as any).__v; const phases: string[] = [];
    let smashedBeforeOpen = false;
    for (let i = 0; i < 300 && g.carEntry.phase !== 'hotwire'; i++) { g.frame(1 / 30, false); const ph = g.carEntry.phase; if (ph && phases[phases.length - 1] !== ph) phases.push(ph); if (ph === 'open' && v.isGlassBroken(v.paneOfDoor(0))) smashedBeforeOpen = true; }
    return { phases, smashedBeforeOpen, glass: v.isGlassBroken(v.paneOfDoor(0)), seated: g.playerVehicle === v, ign: v.ignition };
  });
  expect(r.phases.slice(0, 3)).toEqual(['approach', 'smash', 'open']);
  expect(r.smashedBeforeOpen).toBe(true);
  expect(r.seated).toBe(true);
  expect(r.ign).toBe(false);
  // flooring it while hotwiring does nothing
  await step(page, 1.2, { hold: ['KeyW'] });
  expect(Math.abs(await page.evaluate(() => (window as any).__v.speed))).toBeLessThan(0.5);
  await step(page, 2);
  expect(await page.evaluate(() => (window as any).__v.ignition)).toBe(true);
  expect(await page.evaluate(() => (window as any).__game.carEntry.active)).toBe(false);
  // a wall stands ~10 m ahead of this spot (yaw 0), so check the pull-away after one second instead of 2.5 s
  await step(page, 1, { hold: ['KeyW'] });
  expect(await page.evaluate(() => (window as any).__v.speed)).toBeGreaterThan(4);
  // once stolen it stays open and started
  expect(await page.evaluate(() => { const v = (window as any).__v; return !v.doorsLocked && v.playerUsed; })).toBe(true);
  clean(p);
});

test('getting out steps out on the driver side and the door closes; bailing at speed rolls you out', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const out = await page.evaluate(`(() => {
    const g = window.__game, leftOf = ${LEFT_OF};
    const v = g.vehicles.spawn('sedan', -262, -96, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    g.input.tap('KeyF'); let opened = 0, t = 0;
    for (let i = 0; i < 120 && (g.carEntry.active || i < 2); i++) { g.frame(1 / 30, false); opened = Math.max(opened, v.doors[0].amount); t = i / 30; }
    const side = leftOf(v, g.player.pos);
    for (let i = 0; i < 45; i++) g.frame(1 / 30, false);
    return { side, opened, t, inCar: !!g.playerVehicle, onFoot: g.player.human.root.parent !== v.visual, door: v.doors[0].amount };
  })()`) as { side: number; opened: number; t: number; inCar: boolean; onFoot: boolean; door: number };
  expect(out.inCar).toBe(false);
  expect(out.onFoot).toBe(true);
  expect(out.opened).toBeGreaterThan(0.8);
  expect(out.side).toBeGreaterThan(1.1);
  expect(out.t).toBeGreaterThan(0.8);
  expect(out.door).toBeLessThan(0.15);
  // bail out of a fast car: knocked down, out on the ground, car rolls on
  const bail = await page.evaluate(() => {
    const g = (window as any).__game; g.player.health = 100;
    const v = g.vehicles.spawn('sedan', -330, -98, Math.PI / 2); v.persistent = true; g.seatPlayer(v);
    v.phys.body.setLinvel({ x: 14, y: 0, z: 0 }, true);
    for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    g.input.tap('KeyF'); g.frame(1 / 30, false);
    const down = g.player.downT > 0;
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
    return { down, inCar: !!g.playerVehicle, alive: g.player.alive, hurt: g.player.health < 100 };
  });
  expect(bail.down).toBe(true);
  expect(bail.inCar).toBe(false);
  expect(bail.alive).toBe(true);
  expect(bail.hurt).toBe(true);
  clean(p);
});

test('helicopter: walk in through the door, spin up, take off, fly forward and land', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  await page.evaluate(() => (window as any).__meridian.sandbox.act('never', true)); // stealing a heli is a 3-star crime: keep the cops out of this flight test
  const pads = await page.evaluate(() => (window as any).__game.helis.pads.map((s: any) => ({ name: s.def.name, y: s.pos.y, heli: !!s.heli })));
  expect(pads.length).toBeGreaterThanOrEqual(2);
  expect(pads.every((s: any) => s.heli)).toBe(true);
  expect(pads.some((s: any) => s.y > 12)).toBe(true); // a rooftop pad
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-415, 0.25, -55, 0); (window as any).__h = g.spawnHelicopter('news', -410, -55, 0); });
  await step(page, 0.5);
  const g0 = await page.evaluate(() => { const h = (window as any).__h; return { y: h.position.y, grounded: h.grounded }; });
  expect(g0.grounded).toBe(true);
  await tap(page, 'KeyF');
  const entered = await page.evaluate(() => { const g = (window as any).__game, h = (window as any).__h; let door = 0; for (let i = 0; i < 300 && g.playerHeli !== h; i++) { g.frame(1 / 30, false); door = Math.max(door, h.doors[0].amount); } return { door, inside: g.playerHeli === h }; });
  expect(entered.inside).toBe(true);
  expect(entered.door).toBeGreaterThan(0.8);
  await step(page, 1); // door shuts
  // spin up and climb
  await step(page, 9, { hold: ['Space'] });
  const up = await page.evaluate(() => { const h = (window as any).__h; return { y: h.position.y, rotor: h.rotor, agl: h.agl, x: h.position.x, z: h.position.z, destroyed: h.destroyed }; });
  expect(up.rotor).toBeGreaterThan(0.95);
  expect(up.agl).toBeGreaterThan(10);
  expect(up.destroyed).toBe(false);
  await step(page, 2.2, { hold: ['KeyW'] });
  const fwd = await page.evaluate(() => { const h = (window as any).__h; return { x: h.position.x, z: h.position.z, agl: h.agl, destroyed: h.destroyed, speed: h.speed }; });
  expect(Math.hypot(fwd.x - up.x, fwd.z - up.z)).toBeGreaterThan(20);
  expect(fwd.destroyed).toBe(false);
  // let go: it levels and brakes; then descend and land
  await step(page, 4);
  // a pilot flares: sink fast while high, then feather the collective near the ground (full sink rate at touchdown is a crash)
  await page.evaluate(() => { const g = (window as any).__game, h = (window as any).__h; const dt = 1 / 30;
    for (let i = 0; i < 30 * 40 && !h.grounded; i++) { const low = h.agl < 9; const down = low ? (i % 15 < 3) : true; if (down) g.input.press('ShiftLeft'); g.frame(dt, false); g.input.release('ShiftLeft'); }
    for (let i = 0; i < 60; i++) g.frame(dt, false); });
  const land = await page.evaluate(() => { const h = (window as any).__h; return { grounded: h.grounded, destroyed: h.destroyed, health: h.health / h.maxHealth, sp: Math.hypot(h.phys.body.linvel().x, h.phys.body.linvel().z) }; });
  expect(land.grounded).toBe(true);
  expect(land.destroyed).toBe(false);
  expect(land.health).toBeGreaterThan(0.9);
  expect(land.sp).toBeLessThan(2);
  // and step out
  await tap(page, 'KeyF');
  await step(page, 3);
  expect(await page.evaluate(() => { const g = (window as any).__game; return !g.playerHeli && !g.player.inVehicle; })).toBe(true);
  clean(p);
});
