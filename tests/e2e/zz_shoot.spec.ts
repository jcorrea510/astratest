import { test } from '@playwright/test';
import { boot, quietStreets } from './helpers';
test('shootout shots', async ({ page }) => {
  test.setTimeout(400000);
  await page.setViewportSize({ width: 1000, height: 560 });
  await boot(page); await quietStreets(page);
  await page.evaluate(() => {
    const g = (window as any).__game; g.hour = 14;
    const lane = g.city.lanes.find((l: any) => !l.connector && l.length > 120);
    const car = g.traffic.spawnOnLane('police', lane, 20, 'cruise', 'police');
    car.patrol = true; car.maxSpeed = 0; car.persistent = true; car.v.persistent = true;
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    const v = car.v, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    g.player.place(v.position.x + fx * 15, v.position.y, v.position.z + fz * 15, 0);
    (window as any).__car = car;
    g.pcombat.give('pistol', 200); g.pcombat.inv.select('pistol');
  });
  const snap = async (name: string, frames: number) => {
    await page.evaluate((frames) => { const g = (window as any).__game; for (let i = 0; i < frames; i++) g.frame(1 / 30, false);
      const v = (window as any).__car.v, c = g.renderer.camera, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      c.position.set(v.position.x + fx * 8 - fz * 5, v.position.y + 2.2, v.position.z + fz * 8 + fx * 5); c.lookAt(v.position.x + fx * 1, v.position.y + 0.8, v.position.z + fz * 1);
      c.updateMatrixWorld(); g.renderer.render(); }, frames);
    await page.screenshot({ path: `/tmp/shoot_${name}.png` });
  };
  await snap('0', 3);
  await page.evaluate(() => {
    const g = (window as any).__game, v = (window as any).__car.v, W = (window as any).__W;
    const o = g.player.pos.clone(); o.y += 1.4; const t = v.position.clone(); t.y += 0.6; const d = t.sub(o).normalize();
    (window as any).__shot = () => g.combat.shoot(g.player, g.pcombat.inv.def, o, d, 0);
  });
  const info = await page.evaluate(() => { const g = (window as any).__game; try { (window as any).__shot(); } catch (e) { return String(e); } return 'shot heat=' + g.police.heat; });
  console.log(info);
  await snap('1', 8);
  await snap('2', 20);
  await snap('3', 30);
  console.log(await page.evaluate(() => { const g = (window as any).__game, c = (window as any).__car; return JSON.stringify({ heat: g.police.heat, out: !c.driver.char.inVehicle, brain: c.driver.brain, pos: c.driver.pos, hp: c.driver.char.health, foot: g.police.foot.length, crouch: c.driver.crouching, cover: !!c.driver.coverPoint }); }));
});
