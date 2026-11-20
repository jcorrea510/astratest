import { test } from '@playwright/test';
import { boot, quietStreets } from './helpers';
const OUT = process.env.SHOT_DIR ?? '/tmp/claude-0/-home-user-astratest/d1ebd1cb-1eba-5496-ba2a-bb23f33ded71/scratchpad/shots';
test('hands up shots', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page); await quietStreets(page);
  const variants: Record<string, any> = JSON.parse(process.env.VARIANTS ?? '{"cur":null}');
  for (const [name, pose] of Object.entries(variants)) {
    await page.evaluate(({ pose }) => {
      const g = (window as any).__game;
      if (pose) (window as any).__ACTIONS.hands_up.poses = [[0, {}], [1, pose]];
      g.clockRunning = false; g.hour = 13;
      g.player.place(-41, 0.25, 9, 0);
      const gd = new Set(g.armyGuards.guards.map((q: any) => q.npc)); for (const n of [...g.pop.npcs]) if (!gd.has(n)) g.pop.remove(n);
      const n = g.pop.spawn('civilian', -41, 12, 0.2); n.persistent = true; n.brain = 'scripted'; n.char.yaw = Math.PI;
      (window as any).__t = n;
      for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
      n.char.human.playAction('hands_up', { hold: true });
      for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
      const cam = g.renderer.camera; cam.position.set(-41.6, 1.5, 9.4); cam.lookAt(-41, 1.25, 12); cam.updateMatrixWorld(true);
      g.renderer.render();
    }, { pose });
    await page.screenshot({ path: `${OUT}/hands-${name}.png`, clip: { x: 340, y: 60, width: 600, height: 600 } });
    await page.evaluate(() => { const g = (window as any).__game; g.pop.remove((window as any).__t); });
  }
});
