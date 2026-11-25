import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets, watch, clean } from './helpers';

/** R6-C: police / army behaviour reported by the owner. Each test runs headless on the shared helpers. */
const setup = (page: Page) => page.evaluate(() => {
  const g = (window as any).__game; g.hour = 14; g.player.health = g.player.maxHealth;
  const w = (window as any); w.__shots = { cop: 0, heli: 0, army: 0, total: 0 };
  const orig = g.combat.shoot.bind(g.combat);
  g.combat.shoot = (shooter: any, ...rest: any[]) => { w.__shots.total++; if (shooter?.team === 'police') w.__shots.cop++; if (shooter?.inVehicle?.variant === 'police') w.__shots.heli++; if (shooter?.inVehicle?.variant === 'army') w.__shots.army++; return orig(shooter, ...rest); };
  const ol = g.combat.launch.bind(g.combat);
  g.combat.launch = (shooter: any, ...rest: any[]) => { if (shooter?.inVehicle?.variant === 'police') w.__shots.heli++; return ol(shooter, ...rest); };
});
const godStep = (page: Page, seconds: number) => page.evaluate((s) => { const g = (window as any).__game; for (let i = 0; i < s * 30; i++) { g.player.health = g.player.maxHealth; g.frame(1 / 30, false); } }, seconds);

test.describe('police R6-C', () => {
  test.beforeEach(async ({ page }) => { await boot(page); await quietStreets(page); await setup(page); });

  test('drawing a gun on a cop makes him fire within 1.5 s (no shot from the player needed)', async ({ page }) => {
    const p = watch(page);
    await page.evaluate(() => {
      const g = (window as any).__game, pl = g.player;
      g.pcombat.give('pistol', 60); g.pcombat.inv.current = 'pistol';
      Object.defineProperty(g.pcombat, 'aiming', { get: () => true });
      const cop = g.pop.spawn('police', pl.pos.x, pl.pos.z + 12, pl.pos.y); cop.persistent = true; cop.brain = 'idle';
      (window as any).__cop = cop;
    });
    expect(await page.evaluate(() => (window as any).__game.police.heat)).toBe(0);
    await godStep(page, 1.5);
    const r = await page.evaluate(() => ({ shots: (window as any).__shots.cop, heat: (window as any).__game.police.heat }));
    expect(r.heat).toBeGreaterThanOrEqual(2);
    expect(r.shots).toBeGreaterThan(0);
    clean(p);
  });

  test('3 stars with an officer in line of sight: he pursues within 2 s (all idle states)', async ({ page }) => {
    for (const brain of ['idle', 'wander']) {
      await page.evaluate((brain) => {
        const g = (window as any).__game, pl = g.player;
        for (const n of [...g.pop.npcs]) if (n.role === 'police') g.pop.remove(n);
        const cop = g.pop.spawn('police', pl.pos.x, pl.pos.z + 9, pl.pos.y); cop.persistent = true; cop.brain = brain;
        g.pcombat.give('pistol', 30); g.pcombat.inv.select('pistol'); g.police.setHeat(3, pl.pos); (window as any).__cop = cop; // armed: an unarmed suspect is tased and cuffed instead (Round 9 arrest scene), which is a different test
      }, brain);
      await godStep(page, 2);
      const b = await page.evaluate(() => (window as any).__cop.brain);
      expect(['chase', 'combat'], `from ${brain}`).toContain(b);
    }
  });

  test('reinforcements spawn far away and out of view', async ({ page }) => {
    test.setTimeout(300_000);
    const rec = await page.evaluate(() => {
      const g = (window as any).__game, D = g.police.dispatch, out: any[] = [];
      // stand next to the precinct so a naive origin spawn would pop in on screen
      g.player.place(30, 0.3, 125, 0);
      const orig = D.spawnUnit.bind(D);
      D.spawnUnit = (kind: any, target: any, camera: any, heat: any, origin: any) => {
        const car = orig(kind, target, camera, heat, origin);
        if (car) {
          const p = car.v.position, c = camera.position;
          out.push({ kind, d: Math.hypot(p.x - target.x, p.z - target.z), dc: Math.hypot(p.x - c.x, p.z - c.z), origin: origin ?? 'base' });
        }
        return car;
      };
      g.police.setHeat(4, g.player.pos);
      for (let i = 0; i < 30 * 60; i++) { g.player.health = g.player.maxHealth; g.frame(1 / 30, false); }
      return out;
    });
    expect(rec.length).toBeGreaterThan(2);
    for (const r of rec) { expect(r.d, JSON.stringify(r)).toBeGreaterThan(120); expect(r.dc, JSON.stringify(r)).toBeGreaterThan(120); }
  });

  test('police helicopter comes from far away and never fires a round', async ({ page }) => {
    test.setTimeout(300_000);
    const r = await page.evaluate(() => {
      const g = (window as any).__game, D = g.police.dispatch;
      g.pcombat.give('pistol', 30); g.pcombat.inv.select('pistol'); // armed: an unarmed suspect is arrested (tased, cuffed) and the air unit is called off
      g.police.setHeat(4, g.player.pos);
      let first = -1;
      for (let i = 0; i < 30 * 40; i++) { g.player.health = g.player.maxHealth; g.frame(1 / 30, false);  if (D.heli && first < 0) { first = Math.hypot(D.heli.position.x - g.player.pos.x, D.heli.position.z - g.player.pos.z); } }
      return { first, heli: !!D.heli, shots: (window as any).__shots.heli };
    });
    expect(r.heli).toBe(true);
    expect(r.first).toBeGreaterThan(300);
    expect(r.shots).toBe(0);
  });

  test('police helicopter does not shoot a player flying a stolen helicopter either', async ({ page }) => {
    test.setTimeout(300_000);
    const r = await page.evaluate(() => {
      const g = (window as any).__game;
      const h = g.spawnHelicopter('civilian'); g.boardFinished(h); h.rotor = 1; h.parked = false; h.teleport(h.position.x, h.position.y + 40, h.position.z, h.yaw);
      for (let i = 0; i < 30 * 30; i++) { g.frame(1 / 30, false); }
      return { heli: !!g.police.dispatch.heli, shots: (window as any).__shots.heli };
    });
    expect(r.heli).toBe(true);
    expect(r.shots).toBe(0);
  });

  test('low heat: the officer tases, then cuffs, then ARRESTED; nobody else shoots', async ({ page }) => {
    test.setTimeout(300_000);
    await page.evaluate(() => {
      const g = (window as any).__game, pl = g.player;
      g.police.setHeat(1, pl.pos);
      const cop = g.pop.spawn('police', pl.pos.x + 6, pl.pos.z, pl.pos.y); cop.persistent = true;
      g.police.dispatch.arm(cop, 'police', 1, false); g.police.foot.push(cop); cop.target = pl; cop.lastSeen.copy(pl.pos);
      const cop2 = g.pop.spawn('police', pl.pos.x - 5, pl.pos.z + 4, pl.pos.y); cop2.persistent = true;
      g.police.dispatch.arm(cop2, 'police', 3, true); g.police.foot.push(cop2); cop2.target = pl; cop2.lastSeen.copy(pl.pos);
      (window as any).__stages = new Set<string>(); (window as any).__cop = cop; (window as any).__cop2 = cop2;
      const sfx: string[] = []; (window as any).__sfx = sfx; const op = g.audio.play.bind(g.audio); g.audio.play = (n: string, ...a: any[]) => { sfx.push(n); return op(n, ...a); };
    });
    let sawTase = false, sawApproach = false, sawCuff = false, jailedBeforeCuff = false;
    for (let i = 0; i < 30 * 14; i++) {
      const s = await page.evaluate(() => { const g = (window as any).__game, D = g.police.dispatch; g.frame(1 / 30, false); return { st: D.arrestStage, tased: g.player.human.actionName, dt: g.deathT, shots: (window as any).__shots.cop }; });
      if (s.st === 'tase') sawTase = true; if (s.st === 'approach') sawApproach = true; if (s.st === 'cuff') sawCuff = true;
      if (s.st === 'none' && s.dt > 3 && !sawCuff) jailedBeforeCuff = true;
    }
    expect(sawTase && sawApproach && sawCuff).toBe(true);
    expect(jailedBeforeCuff).toBe(false);
    const r = await page.evaluate(() => ({ sfx: (window as any).__sfx.includes('taser'), cop: (window as any).__cop.alive, shotsDuring: (window as any).__shots.cop }));
    expect(r.sfx).toBe(true); expect(r.cop).toBe(true);
  });

  test('sandbox Police-ignore-you: army base guards, gunships and units leave the player alone', async ({ page }) => {
    test.setTimeout(300_000);
    const r = await page.evaluate(() => {
      const g = (window as any).__game, m = (window as any).__meridian;
      m.sandbox.act('never', true);
      g.pcombat.give('rifle', 60);
      const B = { x: 0, z: 0 };
      const guards = g.armyGuards.guards; const gp = guards[0].npc.pos; B.x = gp.x - 6; B.z = gp.z;
      g.player.place(B.x, 0.3, B.z, 0);
      const shots = { n: 0 }; const orig = g.combat.shoot.bind(g.combat);
      g.combat.shoot = (s: any, ...rest: any[]) => { if (s !== g.player) shots.n++; return orig(s, ...rest); };
      const ol = g.combat.launch.bind(g.combat); g.combat.launch = (s: any, ...rest: any[]) => { if (s !== g.player) shots.n++; return ol(s, ...rest); };
      for (let i = 0; i < 30 * 25; i++) { g.player.health = g.player.maxHealth; g.frame(1 / 30, false); }
      return { shots: shots.n, heat: g.police.heat, air: g.armyAir.units.length, trespass: g.armyAir.trespassT, alerted: g.armyGuards.alerted };
    });
    expect(r.shots).toBe(0); expect(r.heat).toBe(0); expect(r.air).toBe(0); expect(r.alerted).toBe(false);
  });
});
