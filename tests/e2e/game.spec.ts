import { test, expect } from '@playwright/test';
import { watch, boot, step, tap, state, clean } from './helpers';

test.describe.configure({ mode: 'serial' });

test('title screen, new game through the menu, loading and HUD', async ({ page }) => {
  const p = watch(page);
  await page.goto('./');
  await expect(page.getByText('New game')).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/title.png' });
  await page.getByText('New game').click();
  await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__game.stop());
  await step(page, 1, { render: true });
  expect(await state<boolean>(page, '!window.__meridian.ui.isMenuOpen()')).toBe(true);
  expect(await state<number>(page, 'window.__game.money')).toBe(250);
  await page.screenshot({ path: 'test-results/shots/hud.png' });
  clean(p);
});

test('walk, sprint, jump, roll; take a car, drive, handbrake, crash and get out', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  const start = await state<{ x: number; z: number }>(page, '({x: window.__game.player.pos.x, z: window.__game.player.pos.z})');
  await step(page, 2, { hold: ['KeyW'] });
  await step(page, 1.5, { hold: ['KeyW', 'ShiftLeft'] });
  const moved = await state<{ x: number; z: number }>(page, '({x: window.__game.player.pos.x, z: window.__game.player.pos.z})');
  expect(Math.hypot(moved.x - start.x, moved.z - start.z)).toBeGreaterThan(8);
  await tap(page, 'Space'); await step(page, 1);
  await tap(page, 'KeyC'); await step(page, 1);
  expect(await state<boolean>(page, 'window.__game.player.alive')).toBe(true);
  // Spawn a car beside the player and get in with F
  await page.evaluate(() => { const g = (window as any).__game; const p = g.player.pos; g.player.place(-280, 0.25, -95.5, Math.PI / 2); g.vehicles.spawn('sedan', -278, -97.5, Math.PI / 2); void p; });
  await step(page, 0.5);
  await tap(page, 'KeyF'); await step(page, 1);
  expect(await state<boolean>(page, '!!window.__game.playerVehicle')).toBe(true);
  await step(page, 3, { hold: ['KeyW'] });
  const v = await state<number>(page, 'window.__game.playerVehicle.speed');
  expect(v).toBeGreaterThan(10);
  await step(page, 1, { hold: ['KeyW', 'KeyA', 'Space'] });
  // Crash: aim at a building and accelerate
  await page.evaluate(() => { const g = (window as any).__game; g.playerVehicle.phys.teleport(-420, 0.6, -102, -Math.PI / 2); });
  const hp0 = await state<number>(page, 'window.__game.playerVehicle.health');
  await step(page, 5, { hold: ['KeyW'] });
  const hp1 = await state<number>(page, 'window.__game.playerVehicle.health');
  expect(hp1).toBeLessThan(hp0);
  await step(page, 1, { render: true });
  await page.screenshot({ path: 'test-results/shots/crash.png' });
  await tap(page, 'KeyF'); await step(page, 1);
  expect(await state<boolean>(page, '!window.__game.playerVehicle')).toBe(true);
  clean(p);
});

test('shoot, punch, inventory wheel, heat gain and loss', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  // regression: game time never runs backwards (a negative first frame delta once froze weapon cooldowns)
  expect(await state<number>(page, 'window.__game.time')).toBeGreaterThanOrEqual(0);
  // punch a civilian standing in front
  await page.evaluate(() => { const g = (window as any).__game; const n = g.pop.spawn('civilian', g.player.pos.x + Math.sin(g.player.yaw) * 1.2, g.player.pos.z + Math.cos(g.player.yaw) * 1.2); n.persistent = true; n.brain = 'idle'; (window as any).__victim = n; g.cam.yaw = g.player.yaw + Math.PI; });
  await tap(page, 'Mouse0'); await step(page, 0.6);
  expect(await state<number>(page, 'window.__victim.char.health')).toBeLessThan(100);
  expect(await state<number>(page, 'window.__game.police.heat')).toBeGreaterThanOrEqual(1);
  // weapons via the wheel (hold Tab, flick the mouse, release)
  await page.evaluate(() => { const g = (window as any).__game; g.pcombat.give('pistol', 48); g.pcombat.give('shotgun', 12); });
  await page.evaluate(() => { (window as any).__game.input.press('Tab'); });
  await step(page, 0.2);
  expect(await state<boolean>(page, 'window.__game.wheelOpen')).toBe(true);
  expect(await state<number>(page, 'window.__game.timeScale')).toBeLessThan(0.6);
  for (let i = 0; i < 6; i++) await page.evaluate(() => { const g = (window as any).__game; g.input.mouseDX = 40; g.input.mouseDY = -5; g.frame(1 / 30, false); });
  await page.evaluate(() => { (window as any).__game.input.release('Tab'); });
  await step(page, 0.3);
  expect(await state<boolean>(page, 'window.__game.wheelOpen')).toBe(false);
  await page.evaluate(() => (window as any).__game.pcombat.inv.select('pistol'));
  await step(page, 0.4);
  const clip = await state<number>(page, 'window.__game.pcombat.inv.state.clip');
  await page.evaluate(() => { (window as any).__game.input.press('Mouse2'); });
  await step(page, 0.3);
  await tap(page, 'Mouse0'); await step(page, 0.3); await tap(page, 'Mouse0'); await step(page, 0.3);
  await page.evaluate(() => { (window as any).__game.input.release('Mouse2'); });
  expect(await state<number>(page, 'window.__game.pcombat.inv.state.clip')).toBe(clip - 2);
  await tap(page, 'KeyR'); await step(page, 1.6);
  expect(await state<number>(page, 'window.__game.pcombat.inv.state.clip')).toBe(12);
  // escalate and then lose the heat by getting far away and out of sight
  await page.evaluate(() => { const g = (window as any).__game; g.police.report('kill', g.player.pos); });
  expect(await state<number>(page, 'window.__game.police.heat')).toBeGreaterThanOrEqual(2);
  await step(page, 12);
  await step(page, 0.1, { render: true });
  await page.screenshot({ path: 'test-results/shots/heat.png' });
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-430, 0.3, -380, 0); });
  let heat = 5;
  for (let i = 0; i < 20 && heat > 0; i++) { await step(page, 4); heat = await state<number>(page, 'window.__game.police.heat'); if (heat > 0) await page.evaluate(() => { const g = (window as any).__game; const far = [[-430, -380], [440, -380], [-430, 380]][Math.floor(Math.random() * 3)]; if (g.player.alive && g.deathT < 0) g.player.place(far[0], 0.3, far[1], 0); }); }
  expect(heat).toBe(0);
  clean(p);
});

test('down and respawn, then arrest', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.player.damage(500, null, g.time); g.playerDown('down'); });
  await step(page, 1, { render: true });
  await page.screenshot({ path: 'test-results/shots/down.png' });
  await step(page, 4.5);
  expect(await state<boolean>(page, 'window.__game.player.alive')).toBe(true);
  expect(await state<number>(page, 'window.__game.deathT')).toBe(-1);
  expect(await state<number>(page, 'window.__game.player.health')).toBe(100);
  await page.evaluate(() => { const g = (window as any).__game; g.playerDown('busted'); });
  await step(page, 5);
  expect(await state<number>(page, 'window.__game.deathT')).toBe(-1);
  expect(await state<number>(page, 'Math.round(window.__game.player.pos.x)')).toBe(40);
  clean(p);
});

/** Helper: puts the player in a fresh car at (x,z) facing yaw. */
const PUT_IN_CAR = (x: number, z: number, yaw: number) => `(() => { const g = window.__game; if (g.playerVehicle) g.exitVehicle(true); for (const o of [...g.vehicles.list]) if (Math.hypot(o.position.x - ${x}, o.position.z - ${z}) < 7 && !o.persistent) { const c = g.traffic.carOf(o); if (c) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); } g.vehicles.remove(o); } const v = g.vehicles.spawn('coupe', ${x}, ${z}, ${yaw}); v.persistent = true; g.seatPlayer(v); return true; })()`;
const TELEPORT_CAR = (x: number, z: number, yaw: number) => `(() => { const g = window.__game; if (!g.playerVehicle) throw new Error('not in a vehicle (player at ' + g.player.pos.x.toFixed(1) + ',' + g.player.pos.z.toFixed(1) + ' dead=' + g.deathT + ')'); g.playerVehicle.phys.teleport(${x}, 0.7, ${z}, ${yaw}); g.player.pos.set(${x}, 0.5, ${z}); return true; })()`;

test('every mission can be completed', async ({ page }) => {
  test.setTimeout(900_000);
  const p = watch(page);
  await boot(page);
  const status = () => state<{ active: string | null; done: string[]; last: string; obj: string | null }>(page, '({active: window.__meridian.missions.active?.def.id ?? null, done: [...window.__meridian.missions.completed], last: window.__meridian.missions.lastResult, obj: window.__meridian.missions.objective})');

  // M1: walk into Juno's marker to start, take a car, reach the package and deliver it
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-262, 0.25, -106.6, 0); });
  await step(page, 1);
  expect((await status()).active).toBe('m1');
  await page.evaluate(PUT_IN_CAR(-262, -96, Math.PI / 2)); await step(page, 1);
  await page.evaluate(TELEPORT_CAR(470, 120, 0)); await step(page, 1);
  await page.evaluate(TELEPORT_CAR(-200, 102, Math.PI / 2)); await step(page, 2);
  expect((await status()).done).toContain('m1');

  // M2: follow the courier van to its destination, keeping a sensible distance
  await page.evaluate(() => { const g = (window as any).__game; if (g.playerVehicle) g.exitVehicle(true); g.player.place(-262, 0.25, -106.6, 0); });
  await step(page, 5);
  expect((await status()).active).toBe('m2');
  await page.evaluate(PUT_IN_CAR(-282, -98, Math.PI / 2));
  for (let i = 0; i < 240; i++) {
    const st = await status(); if (st.done.includes('m2') || !st.active) break;
    // tail the courier along the exact road it drove, about 3 seconds behind
    await page.evaluate(() => {
      const g = (window as any).__game; const w = window as any; w.__trail = w.__trail ?? [];
      const car = g.traffic.cars.find((c: any) => c.v.locked); if (!car || !g.playerVehicle) return;
      const v = car.v; w.__trail.push({ x: v.position.x, y: v.position.y, z: v.position.z, yaw: v.yaw });
      const back = w.__trail[Math.max(0, w.__trail.length - 6)];
      if (Math.hypot(back.x - v.position.x, back.z - v.position.z) < 22) return; // waiting at a light: hold position
      g.playerVehicle.phys.teleport(back.x, back.y + 0.3, back.z, back.yaw); g.player.pos.set(back.x, back.y, back.z);
    });
    await step(page, 1);
  }
  expect((await status()).done, JSON.stringify(await status())).toContain('m2');

  // M3: shootout at the docks, grab the case, lose the heat
  await page.evaluate(() => { const g = (window as any).__game; if (g.playerVehicle) g.exitVehicle(true); g.player.place(-200, 0.25, 306.6, 0); });
  await step(page, 5);
  expect((await status()).active).toBe('m3');
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(398, 0.3, 100, 0); });
  await step(page, 1);
  // fight: aim at each enemy and fire with the pistol (real hitscan), topping up health so the test exercises the mission flow
  for (let i = 0; i < 600; i++) {
    const left = await page.evaluate(() => {
      const g = (window as any).__game; g.player.health = 100;
      const foes = g.pop.npcs.filter((n: any) => n.role === 'gang' && n.alive && n.persistent);
      if (!foes.length) return 0;
      const t = foes[0];
      // stand somewhere with a clear line of fire to the target
      const V = t.pos.constructor;
      let best = null;
      for (let k = 0; k < 16 && !best; k++) {
        const a = k * Math.PI / 8, r = 3 + (k % 3);
        const p = new V(t.pos.x + Math.cos(a) * r, t.pos.y, t.pos.z + Math.sin(a) * r);
        if (g.pop.runner.hasLOS(new V(p.x, p.y + 1.4, p.z), new V(t.pos.x, t.pos.y + 1.2, t.pos.z)) && g.pop.runner.hasLOS(new V(p.x, p.y + 1.4, p.z), new V(p.x - Math.cos(a) * 2.5, p.y + 1.8, p.z - Math.sin(a) * 2.5))) best = p;
      }
      if (!best) { t.char.damage(30, g.player, g.time); g.frame(1 / 30, false); return foes.length; } // fully enclosed: fall back to a direct hit
      g.player.place(best.x, best.y + 0.05, best.z, 0);
      const dx = t.pos.x - best.x, dz = t.pos.z - best.z;
      g.cam.yaw = Math.atan2(dx, dz) + Math.PI; g.cam.pitch = -0.1;
      g.pcombat.inv.select('pistol'); g.input.press('Mouse2'); g.input.tap('Mouse0');
      for (let k = 0; k < 8; k++) g.frame(1 / 30, false);
      if (g.pcombat.inv.state.clip === 0 && g.pcombat.inv.state.reserve === 0) g.pcombat.give('pistol', 48);
      return foes.length;
    });
    if (!left) break;
  }
  await page.evaluate(() => (window as any).__game.input.release('Mouse2'));
  await step(page, 1);
  expect((await status()).obj, JSON.stringify(await status())).toBe('Grab the case');
  await page.evaluate(() => { const g = (window as any).__game; const b = (window as any).__meridian.missions.blips()[0]; g.player.place(b.x, 0.3, b.z, 0); });
  await step(page, 1);
  expect(await state<number>(page, 'window.__game.police.heat'), JSON.stringify(await status())).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < 40; i++) {
    if ((await status()).done.includes('m3')) break;
    await page.evaluate(() => { const g = (window as any).__game; g.player.health = 100; if (g.deathT < 0) g.player.place(-430 + Math.random() * 20, 0.3, -380, 0); });
    await step(page, 3);
  }
  expect((await status()).done, JSON.stringify(await status())).toContain('m3');

  // M4: steal the guarded car, lose 3+ heat, deliver it intact
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(-200, 0.25, 306.6, 0); });
  await step(page, 5);
  expect((await status()).active).toBe('m4');
  await page.evaluate(() => { const g = (window as any).__game; g.player.place(100, 0.3, -146, 0); });
  await step(page, 2);
  await page.evaluate(() => { const g = (window as any).__game; const v = g.vehicles.list.filter((x: any) => x.kind === 'coupe' && x.persistent).sort((a: any, b: any) => Math.hypot(a.position.x - 100, a.position.z + 150) - Math.hypot(b.position.x - 100, b.position.z + 150))[0]; g.player.health = 100; g.seatPlayer(v); });
  await step(page, 1);
  expect(await state<number>(page, 'window.__game.police.heat')).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < 40 && (await state<number>(page, 'window.__game.police.heat')) > 0; i++) {
    await page.evaluate(TELEPORT_CAR(-440, -300 - Math.random() * 60, 0));
    await page.evaluate(() => { const g = (window as any).__game; g.player.health = 100; g.playerVehicle.health = g.playerVehicle.spec.health; });
    await step(page, 3);
  }
  await page.evaluate(TELEPORT_CAR(-200, 102, Math.PI / 2));
  await step(page, 2);
  expect((await status()).done, JSON.stringify(await status())).toContain('m4');

  // M5: the race. Drive through each checkpoint ahead of the rivals.
  await page.evaluate(() => { const g = (window as any).__game; if (g.playerVehicle) g.exitVehicle(true); g.player.place(-44, 0.3, 412, 0); });
  await step(page, 5);
  expect((await status()).active).toBe('m5');
  await page.evaluate(() => { const g = (window as any).__game; const v = g.vehicles.list.filter((x: any) => x.kind === 'coupe' && x.persistent).sort((a: any, b: any) => Math.hypot(a.position.x + 448, a.position.z - 398) - Math.hypot(b.position.x + 448, b.position.z - 398))[0]; g.seatPlayer(v); });
  await page.evaluate(TELEPORT_CAR(-440, 396, Math.PI / 2)); await step(page, 1);
  await step(page, 4); // countdown
  for (let i = 0; i < 30; i++) {
    const st = await status(); if (!st.active) break;
    await page.evaluate(() => {
      const g = (window as any).__game; const m = (window as any).__meridian.missions;
      const b = m.blips().find((x: any) => x.kind === 'checkpoint'); if (!b) return;
      g.playerVehicle.phys.teleport(b.x, 0.8, b.z, 0); g.player.pos.set(b.x, 0.5, b.z);
    });
    await step(page, 0.5);
  }
  expect((await status()).done, JSON.stringify(await status())).toContain('m5');
  await step(page, 1, { render: true });
  await page.screenshot({ path: 'test-results/shots/missions-done.png' });
  expect(await state<number>(page, 'window.__game.money')).toBeGreaterThan(8000);
  clean(p);
});

test('save, reload and continue; settings persist', async ({ page }) => {
  const p = watch(page);
  await boot(page);
  await page.evaluate(() => { const g = (window as any).__game; g.money = 4321; g.pcombat.give('smg', 60); (window as any).__meridian.missions.completed.add('m1'); (window as any).__meridian.save(); });
  // change a setting through the pause menu
  await page.evaluate(() => (window as any).__meridian.pause());
  await expect(page.getByText('Settings').first()).toBeVisible();
  await page.evaluate(() => { const m = (window as any).__meridian; m.settings.sensitivity = 1.7; m.settings.quality = 'low'; localStorage.setItem('meridian-afterglow.settings.v1', JSON.stringify(m.settings)); });
  await page.goto('./');
  await expect(page.getByText('Continue')).toBeVisible();
  await page.getByText('Continue').click();
  await page.waitForFunction(() => !!(window as any).__meridian, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).__game.stop());
  expect(await state<number>(page, 'window.__game.money')).toBe(4321);
  expect(await state<boolean>(page, 'window.__game.pcombat.inv.weapons.smg.owned')).toBe(true);
  expect(await state<boolean>(page, 'window.__meridian.missions.completed.has("m1")')).toBe(true);
  expect(await state<number>(page, 'window.__meridian.settings.sensitivity')).toBeCloseTo(1.7);
  expect(await state<string>(page, 'window.__game.renderer.qualityName')).toBe('low');
  clean(p);
});

test('phones get a clean desktop-only screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const p = watch(page);
  await page.goto('./');
  await expect(page.getByText(/computer/i).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/shots/mobile.png' });
  clean(p);
  await ctx.close();
});
