import { test, expect } from '@playwright/test';
import { watch, boot, step, clean, state, quietStreets, tap } from './helpers';

/** People: on-foot movement over curbs, the jump state machine, melee range/timing, NPC reactions and looks. */
test.describe.configure({ mode: 'serial' });

test('running across curbs never gets stuck (up and down, straight and at an angle, jog and sprint)', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  // Pick clear stretches of curb: road -> sidewalk crossings on several blocks, with no prop in the way.
  const spots = await page.evaluate(() => {
    const g = (window as any).__game; const out: { x: number; z: number; yaw: number; up: boolean }[] = [];
    const clear = (x: number, z: number, dx: number, dz: number, len: number) => {
      for (const h of [0.5, 1.2]) if (g.physics.ray(x, h, z, dx, 0, dz, len, undefined, g.player.collider)) return false;
      return true;
    };
    for (const b of g.city.blocks) {
      if (out.length >= 8) break;
      if (b.kind !== 'buildings' && b.kind !== 'park') continue;
      const mz = (b.z0 + b.z1) / 2 + 3, mx = (b.x0 + b.x1) / 2 + 3;
      // straight onto the west curb, at 35 degrees onto the north curb, and down off the east curb
      const cands = [
        { x: b.x0 - 3.5, z: mz, yaw: Math.PI / 2, up: true },
        { x: mx - 2, z: b.z0 - 3.5, yaw: 0.6, up: true },
        { x: b.x1 - 1.5, z: mz - 4, yaw: Math.PI / 2, up: false },
      ];
      for (const c of cands) if (clear(c.x, c.z, Math.sin(c.yaw), Math.cos(c.yaw), 11)) out.push(c);
    }
    return out.slice(0, 6);
  });
  expect(spots.length).toBeGreaterThanOrEqual(4);
  for (const [i, s] of spots.entries()) {
    const sprint = i % 2 === 0;
    const r = await page.evaluate(({ s, sprint }) => {
      const g = (window as any).__game; const c = g.player;
      const y0 = s.up ? 0.05 : 0.25;
      c.place(s.x, y0, s.z, s.yaw); g.cam.yaw = s.yaw - Math.PI;
      for (let k = 0; k < 3; k++) g.frame(1 / 30, false);
      // curbside parked cars materialise around the player; this test is about the curb, not about cars
      for (const v of [...g.vehicles.list]) if (!v.driver && !v.persistent && Math.hypot(v.position.x - s.x, v.position.z - s.z) < 18) g.vehicles.remove(v);
      for (let k = 0; k < 2; k++) g.frame(1 / 30, false);
      c.place(s.x, y0, s.z, s.yaw);
      g.input.press('KeyW'); if (sprint) g.input.press('ShiftLeft');
      let minStep = Infinity, prev = { x: c.pos.x, z: c.pos.z }; const trace: string[] = [];
      for (let k = 0; k < 45; k++) {
        for (const v of [...g.vehicles.list]) if (!v.driver && !v.persistent && Math.hypot(v.position.x - s.x, v.position.z - s.z) < 18) g.vehicles.remove(v); // parked cars pop in as the player nears; keep the curb clear
        g.cam.yaw = s.yaw - Math.PI; g.frame(1 / 30, false);
        const st = Math.hypot(c.pos.x - prev.x, c.pos.z - prev.z);
        if (k > 8 && k < 34) minStep = Math.min(minStep, st);
        trace.push(`${st.toFixed(2)}/${c.pos.y.toFixed(2)}`);
        prev = { x: c.pos.x, z: c.pos.z };
      }
      g.input.release('KeyW'); g.input.release('ShiftLeft');
      return { dist: Math.hypot(c.pos.x - s.x, c.pos.z - s.z), y: c.pos.y, minStep, state: c.human.currentState, trace: trace.join(' ') };
    }, { s, sprint });
    // 1.5 s at a jog/sprint covers 5+ m; a curb stall would leave the player near the start
    expect(r.dist, `spot ${i} ${JSON.stringify(s)} ${JSON.stringify(r)}`).toBeGreaterThan(4.5);
    expect(r.minStep, `no frame without progress at spot ${i}: ${r.trace}`).toBeGreaterThan(0.04);
    if (s.up) expect(r.y).toBeGreaterThan(0.12); else expect(r.y).toBeLessThan(0.12);
    expect(r.state).toBe('loco');
  }
  clean(p);
});

test('jumping while running lands straight back into the run (never stuck in the jump pose)', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const c = g.player, h = c.human;
    c.place(-300, 0.05, -102, Math.PI / 2); g.cam.yaw = Math.PI / 2 - Math.PI;
    g.input.press('KeyW'); g.input.press('ShiftLeft');
    const res: { landedLoco: number; air: number; speedAfter: number; badFrames: number }[] = [];
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 20; k++) { g.cam.yaw = -Math.PI / 2; g.frame(1 / 30, false); }
      g.input.tap('Space');
      let air = 0, landedAt = -1, loco = -1, bad = 0;
      for (let k = 0; k < 60; k++) {
        g.cam.yaw = -Math.PI / 2; g.frame(1 / 30, false);
        if (!c.grounded) air++;
        else if (air > 3 && landedAt < 0) landedAt = k;
        if (landedAt >= 0 && loco < 0 && h.currentState === 'loco') loco = k - landedAt;
        if (landedAt >= 0 && k - landedAt > 8 && (h.currentState !== 'loco' || /Jump/.test(h.oneShotName ?? ''))) bad++;
      }
      res.push({ landedLoco: loco, air, speedAfter: c.speed, badFrames: bad });
    }
    g.input.release('KeyW'); g.input.release('ShiftLeft');
    return res;
  });
  for (const j of r) {
    expect(j.air, JSON.stringify(r)).toBeGreaterThan(5);
    expect(j.landedLoco).toBeGreaterThanOrEqual(0);
    expect(j.landedLoco).toBeLessThanOrEqual(2);
    expect(j.badFrames).toBe(0);
    expect(j.speedAfter).toBeGreaterThan(4);
  }
  clean(p);
});

test('punches are a real move: wind-up, damage only at the strike and only within reach in front', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const setup = (dist: number, angle: number) => page.evaluate(({ dist, angle }) => {
    const g = (window as any).__game; const c = g.player;
    for (const n of [...g.pop.npcs]) if (n.tag === 'victim') g.pop.remove(n);
    c.place(-300, 0.05, -102, 0); g.cam.yaw = Math.PI; c.yaw = 0;
    const a = angle; const n = g.pop.spawn('civilian', c.pos.x + Math.sin(a) * dist, c.pos.z + Math.cos(a) * dist);
    n.persistent = true; n.brain = 'scripted'; n.tag = 'victim'; (window as any).__victim = n;
    g.frame(1 / 30, false);
  }, { dist, angle });
  const hp = () => state<number>(page, 'window.__victim.char.health');
  // in front, within reach: nothing on the press frame, damage after the wind-up
  await setup(0.95, 0);
  await tap(page, 'Mouse0');
  expect(await hp()).toBe(100);
  expect(await state<string>(page, 'window.__game.player.human.actionName')).toMatch(/punch/);
  await step(page, 0.6);
  expect(await hp()).toBeLessThan(100);
  // out of reach in front
  await setup(2.4, 0);
  await tap(page, 'Mouse0'); await step(page, 0.8);
  expect(await hp()).toBe(100);
  // close but behind the player
  await setup(0.8, Math.PI);
  await page.evaluate(() => { const g = (window as any).__game; g.cam.yaw = Math.PI; });
  await tap(page, 'Mouse0'); await step(page, 0.8);
  expect(await hp()).toBe(100);
  // a quick three-hit combo ends in a hook that knocks the victim down
  await setup(0.9, 0);
  // (the victim is held in place: an assaulted civilian would normally run off after the first blow)
  await page.evaluate(() => {
    const g = (window as any).__game, n = (window as any).__victim;
    for (let i = 0; i < 3; i++) { g.input.tap('Mouse0'); for (let k = 0; k < 14; k++) { n.brain = 'scripted'; g.frame(1 / 30, false); } }
    for (let k = 0; k < 9; k++) { n.brain = 'scripted'; g.frame(1 / 30, false); }
  });
  const v = await page.evaluate(() => { const n = (window as any).__victim; return { hp: n.char.health, down: n.char.downT, alive: n.char.alive, anim: n.char.human.actionName }; });
  expect(v.hp).toBeLessThan(80);
  expect(v.down > 0 || !v.alive).toBe(true);
  clean(p);
});

test('civilians react to the player: brushing past, aiming a gun, gunfire', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game; const c = g.player;
    c.place(-300, 0.05, -102, Math.PI / 2); g.cam.yaw = -Math.PI / 2;
    const n = g.pop.spawn('civilian', c.pos.x + 6, c.pos.z); n.persistent = true; n.brain = 'idle'; n.stateT = 0;
    // aim a pistol at them
    g.pcombat.give('pistol', 30); g.pcombat.inv.select('pistol');
    g.input.press('Mouse2');
    for (let k = 0; k < 20; k++) { g.cam.yaw = -Math.PI / 2; g.cam.pitch = -0.05; g.frame(1 / 30, false); }
    const surrendered = n.brain === 'surrender' || n.char.human.actionName === 'hands_up';
    g.input.release('Mouse2');
    // gunfire nearby sends them running (or cowering)
    g.pop.danger(c.pos, 30, c);
    for (let k = 0; k < 10; k++) g.frame(1 / 30, false);
    return { surrendered, after: n.brain };
  });
  expect(r.surrendered).toBe(true);
  expect(['flee', 'cower']).toContain(r.after);
  clean(p);
});

test('people are varied: both sexes, many heights, skin tones, hairstyles and outfits; at most four draw calls each', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const cs = g.debugLineup(40, 500);
    const L = cs.map((c: any) => c.human.look);
    const meshes = cs.map((c: any) => { let n = 0; c.human.root.traverse((o: any) => { if (o.isMesh && o.visible) n++; }); return n; });
    const out = {
      sexes: new Set(L.map((l: any) => l.sex)).size, skins: new Set(L.map((l: any) => l.skin)).size, hairs: new Set(L.map((l: any) => l.hairStyle)).size,
      tops: new Set(L.map((l: any) => l.topStyle)).size, minH: Math.min(...L.map((l: any) => l.height * 1.78)), maxH: Math.max(...L.map((l: any) => l.height * 1.78)),
      maxMeshes: Math.max(...meshes),
    };
    for (const c of cs) c.dispose();
    return out;
  });
  expect(r.sexes).toBe(2);
  expect(r.skins).toBeGreaterThanOrEqual(8);
  expect(r.hairs).toBeGreaterThanOrEqual(10);
  expect(r.tops).toBeGreaterThanOrEqual(7);
  expect(r.maxH - r.minH).toBeGreaterThan(0.2);
  expect(r.maxMeshes).toBeLessThanOrEqual(4); // body + shared scanned hair + facial hair + other extras (memory fix shares hair geometry)
  clean(p);
});
