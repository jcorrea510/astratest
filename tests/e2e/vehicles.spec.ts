import { test, expect } from '@playwright/test';
import { boot, step, watch, quietStreets } from './helpers';

/** Procedural cars: every model spawns and drives; doors swing open on the driver (left) side; glass panes break. */
test('every vehicle model spawns, drives, opens its doors and loses its glass', async ({ page }) => {
  const problems = watch(page);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const out: Record<string, unknown> = {};
    const all = ['hatch', 'sedan', 'fullsize', 'luxury', 'wagon', 'coupe', 'muscle', 'super', 'convertible', 'pickup', 'suv', 'minivan', 'van', 'race', 'taxi', 'police', 'fbi', 'swat', 'army', 'tank'];
    all.forEach((k, i) => {
      const v = g.vehicles.spawn(k, -420 + i * 13, 102, Math.PI / 2); v.persistent = true;
      out[k] = v;
    });
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    const res: Record<string, unknown> = {};
    for (const k of all) {
      const v = out[k] as any;
      const local = v.group.worldToLocal(v.doorWorldPos(0).clone());
      res[k] = { doors: v.doors.length, panes: v.panes.length, y: +v.position.y.toFixed(2), up: +v.phys.upVec().y.toFixed(2), standX: v.doors.length ? +local.x.toFixed(2) : 1, seatX: +v.tpl.seats[0].x.toFixed(2) };
      v.doors.forEach((_: unknown, j: number) => v.setDoor(j, 1));
    }
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    for (const k of all) {
      const v = out[k] as any;
      (res[k] as any).open = v.doors.every((d: any) => d.amount > 0.8);
      if (v.panes.length) {
        // windshield: find it from a point on the glass, break it, and it no longer answers
        const tp = v.tpl.panes.find((p: any) => p.name === 'windshield');
        const P = v.position.clone().set(tp.tris[0], tp.tris[1], tp.tris[2]);
        v.group.updateMatrixWorld(true); P.applyMatrix4(v.visual.matrixWorld);
        (res[k] as any).hit = v.glassAt(P);
        (res[k] as any).broke = v.breakGlass(0) && v.isGlassBroken(0) && v.glassAt(P) === null;
      }
    }
    // drive the sedan: it should turn a full circle quickly at city speed
    const s = out.sedan as any; s.doors.forEach((_: unknown, j: number) => s.setDoor(j, 0));
    s.phys.teleport(-262, 0.6, -96, Math.PI / 2); g.seatPlayer(s);
    return res;
  });
  for (const [k, v] of Object.entries(r) as [string, any][]) {
    expect(v.up, k).toBeGreaterThan(0.9);
    expect(v.y, k).toBeGreaterThan(-0.5);
    if (k !== 'tank') {
      expect(v.doors, k).toBeGreaterThanOrEqual(2);
      expect(v.open, k).toBe(true);
      expect(v.standX, k).toBeGreaterThan(0.8); // driver door stand point is on the left (+x)
      expect(v.seatX, k).toBeGreaterThan(0);
      expect(v.hit, k).toBe(0);
      expect(v.broke, k).toBe(true);
    }
  }
  await step(page, 1.5, { hold: ['KeyW'] });
  const y0 = await page.evaluate(() => (window as any).__game.playerVehicle.yaw);
  await step(page, 1.0, { hold: ['KeyW', 'KeyA'] });
  const y1 = await page.evaluate(() => (window as any).__game.playerVehicle.yaw);
  expect(await page.evaluate(() => (window as any).__game.playerVehicle.speed)).toBeGreaterThan(5);
  expect(Math.abs(Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0)))).toBeGreaterThan(0.6);
  await step(page, 0.2, { render: true });
  expect(problems.errors).toEqual([]);
});
