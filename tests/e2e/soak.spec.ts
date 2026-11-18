import { test, expect } from '@playwright/test';
import { watch, boot, clean } from './helpers';

/**
 * Soak: 20 minutes of game time of scripted chaos (driving, crashing, gunfights, heat, deaths, wheel, sandbox spawns,
 * pause/resume, saving, district hopping) with invariant checks every second and heap sampling every minute.
 */
test('soak: 20 minutes of chaos stays healthy @soak', async ({ page }) => {
  test.setTimeout(3_600_000);
  const p = watch(page);
  await boot(page);
  const minutes = Number(process.env.SOAK_MINUTES ?? 20);
  const samples: { min: number; heap: number; npcs: number; vehicles: number; particles: number; sceneChildren: number; pickups: number }[] = [];
  const issues: string[] = [];
  for (let minute = 0; minute < minutes; minute++) {
    const r = await page.evaluate(async (minute) => {
      const w = window as any; const g = w.__game; const M = w.__meridian;
      const issues: string[] = [];
      const rnd = (a: number, b: number) => a + Math.random() * (b - a);
      const spots = [[-300, -96], [0, -100], [-200, 300], [400, 150], [100, -350], [-50, 412], [250, 2], [-440, 0]];
      const frame = (n: number, render = false) => { for (let i = 0; i < n; i++) g.frame(1 / 30, render && i === n - 1); };
      for (let sec = 0; sec < 60; sec++) {
        const act = Math.floor(Math.random() * 12);
        try {
          if (act === 0) { const s = spots[Math.floor(Math.random() * spots.length)]; if (g.playerVehicle) g.exitVehicle(true); if (g.deathT < 0) g.player.place(s[0] + rnd(-3, 3), 0.4, s[1] + rnd(-3, 3), rnd(-3, 3)); }
          else if (act === 1 && !g.playerVehicle && g.deathT < 0) { const v = g.vehicles.nearest(g.player.pos, 30, (c: any) => !c.destroyed); if (v) { g.player.place(v.doorPoint(1).x, v.position.y, v.doorPoint(1).z, 0); g.input.tap('KeyF'); } }
          else if (act === 2) { g.input.press('KeyW'); g.input.press(Math.random() < 0.5 ? 'KeyA' : 'KeyD'); if (Math.random() < 0.3) g.input.press('Space'); }
          else if (act === 3) { for (const k of ['KeyW', 'KeyA', 'KeyD', 'Space', 'Mouse0', 'Mouse2', 'ShiftLeft']) g.input.release(k); }
          else if (act === 4) { const ws = ['pistol', 'smg', 'shotgun', 'rifle']; const id = ws[Math.floor(Math.random() * 4)]; g.pcombat.give(id, 60); g.pcombat.inv.select(id); g.cam.yaw = rnd(-3, 3); g.input.press('Mouse2'); g.input.press('Mouse0'); }
          else if (act === 5) { const s = g.pop.spawn(Math.random() < 0.5 ? 'gang' : 'civilian', g.player.pos.x + rnd(-15, 15), g.player.pos.z + rnd(-15, 15), 0.3, undefined, Math.random() < 0.5 ? 'pistol' : 'fists'); s.hostile = true; }
          else if (act === 6) { g.police.report(Math.random() < 0.5 ? 'kill' : 'copKill', g.player.pos); }
          else if (act === 7) { if (Math.random() < 0.2) { g.player.damage(1000, null, g.time); g.playerDown('down'); } else if (Math.random() < 0.3) g.playerDown('busted'); }
          else if (act === 8) { g.input.press('Tab'); frame(5); g.input.mouseDX = rnd(-60, 60); g.input.mouseDY = rnd(-60, 60); frame(2); g.input.release('Tab'); }
          else if (act === 9) { M.sandbox.act('spawn'); } // (story missions are off: sandbox only)
          else if (act === 10) { M.pause(); frame(3); M.resume(); if (Math.random() < 0.3) M.save(); }
          else if (act === 11) { const v = g.vehicles.list[Math.floor(Math.random() * g.vehicles.list.length)]; if (v && v !== g.playerVehicle) v.damage(rnd(100, 900), v.position.clone(), null); }
        } catch (e) { issues.push(`action ${act}: ${(e as Error).message}`); }
        frame(30, sec % 20 === 0);
        // invariants
        const pp = g.player.pos;
        if (!Number.isFinite(pp.x) || !Number.isFinite(pp.y) || !Number.isFinite(pp.z)) issues.push(`player NaN at ${minute}:${sec}`);
        if (pp.y < -20) issues.push(`player fell through the world at ${minute}:${sec} (${pp.x.toFixed(1)},${pp.y.toFixed(1)},${pp.z.toFixed(1)})`);
        if (g.deathT > 8) issues.push(`stuck in death screen at ${minute}:${sec}`);
        if (g.time < 0) issues.push('time negative');
        for (const v of g.vehicles.list) { const q = v.position; if (!Number.isFinite(q.x) || q.y < -30) { issues.push(`vehicle lost at ${minute}:${sec}`); break; } }
        if (g.wheelOpen && !g.input.held('wheel')) { /* closes next frame */ }
      }
      for (const k of ['KeyW', 'KeyA', 'KeyD', 'Space', 'Mouse0', 'Mouse2', 'ShiftLeft', 'Tab']) g.input.release(k);
      if (w.gc) { w.gc(); w.gc(); }
      const mem = (performance as any).memory;
      return { issues, sample: { min: minute, heap: mem ? mem.usedJSHeapSize / 1048576 : 0, npcs: g.pop.npcs.length, vehicles: g.vehicles.list.length, particles: g.particles.count, sceneChildren: g.renderer.scene.children.length, pickups: g.pickups.length } };
    }, minute);
    issues.push(...r.issues);
    samples.push(r.sample);
    console.log(JSON.stringify(r.sample));
  }
  console.log('issues:', issues.slice(0, 20));
  expect(issues).toEqual([]);
  // Bounded populations
  for (const s of samples) { expect(s.npcs).toBeLessThan(90); expect(s.vehicles).toBeLessThan(90); expect(s.sceneChildren).toBeLessThan(900); }
  // No steady memory growth: compare the average of the last 3 samples to minutes 3-5 (after warm-up).
  const avg = (a: typeof samples) => a.reduce((x, y) => x + y.heap, 0) / a.length;
  if (samples[0].heap > 0 && samples.length >= 8) {
    const early = avg(samples.slice(2, 5)), late = avg(samples.slice(-3));
    console.log(`heap early ${early.toFixed(1)} MB, late ${late.toFixed(1)} MB`);
    expect(late).toBeLessThan(early * 1.3 + 15);
  }
  clean(p);
});
