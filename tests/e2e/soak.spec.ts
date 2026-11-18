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
  // Heap is measured after forced full GCs (--expose-gc). NOTE: HeapProfiler.collectGarbage over CDP also runs wasm-object
  // finalizers eagerly and makes Rapier panic ("unreachable") mid-run, so the in-page gc() is used instead.
  const heapMB = async () => {
    return page.evaluate(async () => { const w = window as any; for (let i = 0; i < 3; i++) { w.gc(); await new Promise(r => setTimeout(r, 30)); } const g = (window as any).__game; const i = g.renderer.renderer?.info; return { heap: (performance as any).memory.usedJSHeapSize / 1048576, geo: i?.memory.geometries ?? 0, tex: i?.memory.textures ?? 0 }; });
  };
  const start = await heapMB();
  console.log(`heap at start (forced GC): ${start.heap.toFixed(1)} MB, geometries ${start.geo}, textures ${start.tex}`);
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
      return { issues, sample: { min: minute, heap: 0, npcs: g.pop.npcs.length, vehicles: g.vehicles.list.length, particles: g.particles.count, sceneChildren: g.renderer.scene.children.length, pickups: g.pickups.length } };
    }, minute);
    issues.push(...r.issues);
    const hm = await heapMB(); r.sample.heap = hm.heap; (r.sample as any).geo = hm.geo; (r.sample as any).tex = hm.tex;
    samples.push(r.sample);
    console.log(JSON.stringify(r.sample));
  }
  console.log('issues:', issues.slice(0, 20));
  expect(issues).toEqual([]);
  // Bounded populations
  for (const s of samples) { expect(s.npcs).toBeLessThan(90); expect(s.vehicles).toBeLessThan(90); expect(s.sceneChildren).toBeLessThan(900); }
  // Memory: no leak and no bloat. Forced-GC heap at the very start vs the very end of the run.
  // Live population differs per sample (a crowd costs ~50 MB), so the end value is the minimum of the last 3 samples.
  const end = { heap: Math.min(...samples.slice(-3).map(x => x.heap)) };
  console.log(`heap start ${start.heap.toFixed(1)} MB -> end ${end.heap.toFixed(1)} MB (growth ${(end.heap - start.heap).toFixed(1)} MB)`);
  expect(start.heap, 'baseline heap (MB)').toBeLessThan(450);
  expect(end.heap - start.heap, 'heap growth over the soak (MB)').toBeLessThan(40);
  clean(p);
});
