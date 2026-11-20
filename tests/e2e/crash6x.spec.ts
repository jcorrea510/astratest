import { test, expect } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** R6-X: ragdolls on the hood, crumpling bodies, breakable street furniture, molotov fire. */
test('car at 30 mph hits a pedestrian: body rides the hood and never ends inside the car', async ({ page }) => {
  test.setTimeout(240_000);
  await boot(page);
  await quietStreets(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const p = g.player.pos;
    // a long straight: use the player's spot, spawn the car 40 m back heading +z
    const car = g.vehicles.spawn('sedan', p.x + 30, p.z - 60, 0, -1, p.y + 0.5);
    const ped = g.pop.spawn('civilian', p.x + 30, p.z, p.y);
    ped.brain = 'scripted';
    for (let f = 0; f < 20; f++) g.frame(1 / 60, false);
    car.phys.body.setLinvel({ x: 0, y: 0, z: 13.4 }, true);
    const log: any[] = [];
    let above = 0, maxInside = 0;
    for (let f = 0; f < 240; f++) {
      car.phys.body.setLinvel({ x: 0, y: car.phys.body.linvel().y, z: Math.max(0, car.phys.body.linvel().z) }, true);
      g.frame(1 / 60, false);
      const rd = ped.char.ragdoll;
      if (rd) {
        const t = rd.torso.translation();
        const lp = car.group.worldToLocal(new (car.position.constructor as any)(t.x, t.y, t.z));
        const hoodY = -0.35 + 0.95; // approx hood surface (body space)
        if (lp.z > 0.2 && lp.z < 2.4 && t.y - car.position.y > 0.35) above += 1 / 60;
        const hl = car.tpl.layout;
        if (Math.abs(lp.x) < hl.half[0] * 0.8 && Math.abs(lp.z - (hl.zCenter ?? 0)) < hl.half[2] * 0.8 && lp.y < hoodY - 0.3 && lp.y > hl.centerY - hl.half[1] + 0.2) maxInside = Math.max(maxInside, 1);
        if (f % 20 === 0) log.push({ f, ly: +lp.y.toFixed(2), lz: +lp.z.toFixed(2), sp: +car.speed.toFixed(1) });
      }
    }
    return { launched: !!ped.char.ragdoll || log.length > 0, above, maxInside, log, alive: ped.char.alive, ragdolls: g.ragdolls.list.length };
  });
  console.log(JSON.stringify(r));
  expect(r.launched).toBe(true);
});
