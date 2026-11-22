import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 7 (owner): gore: a heavy round can take a head off; a limb hit shows a wound and keeps bleeding. Budgeted. */
test.describe.configure({ mode: 'serial' });
let page: Page;
const SHOTS = process.env.GORE_SHOTS || '';
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(); await boot(page); await quietStreets(page); });
test.afterAll(async () => { await page.context().close(); });

const shootZone = (zone: string, weapon: string) => page.evaluate(({ zone, weapon }) => {
  const g = (window as any).__game, V = g.player.pos.constructor;
  g.player.place(-250, 0.25, -80, 0);
  const n = g.pop.spawn('civilian', -250, -74, 0.25); n.brain = 'scripted'; n.persistent = true; n.char.yaw = Math.PI;
  for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
  n.char.human.model.updateMatrixWorld(true);
  const bones: Record<string, string> = { head: 'DEF-head', leg: 'DEF-thighL', torso: 'DEF-spine003' };
  let b: any = null; n.char.human.model.traverse((o: any) => { if (!b && o.name === bones[zone]) b = o; });
  const tgt = b ? b.getWorldPosition(new V()) : n.pos.clone().setY(n.pos.y + 1.2);
  const from = new V(-250, tgt.y, -78.5), dir = tgt.clone().sub(from).normalize();
  g.pcombat.give(weapon, 30); g.pcombat.inv.select(weapon);
  g.combat.shoot(g.player, g.pcombat.inv.def, from, dir, 0);
  for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
  let head: any = null; n.char.human.model.traverse((o: any) => { if (!head && o.name === 'DEF-head') head = o; });
  return { alive: n.alive, headScale: head ? +head.scale.x.toFixed(3) : null, bleeders: g.blood.bleeders.length, id: n.id };
}, { zone, weapon });

test('a shotgun to the head at close range takes it off and the neck bleeds; a leg hit bleeds and keeps the head', async () => {
  const head = await shootZone('head', 'shotgun');
  console.log('head', JSON.stringify(head));
  expect(head.alive).toBe(false);
  expect(head.headScale).toBeLessThan(0.01);
  expect(head.bleeders).toBeGreaterThan(0);
  if (SHOTS) {
    await page.evaluate((id) => {
      const g = (window as any).__game, n = g.pop.npcs.find((q: any) => q.id === id); if (!n) return;
      for (let i = 0; i < 6; i++) g.frame(1 / 30, false);
      const c = g.cam.camera, p = n.char.human.root.getWorldPosition(new g.player.pos.constructor());
      c.position.set(p.x + 1.6, p.y + 1.3, p.z + 1.6); c.lookAt(p.x, p.y + 0.4, p.z); c.updateMatrixWorld(true);
      n.char.human.mesh.visible = true; g.renderer.render();
    }, head.id);
    await page.screenshot({ path: `${SHOTS}/gore-head.png` });
  }
  const leg = await shootZone('leg', 'pistol');
  console.log('leg', JSON.stringify(leg));
  expect(leg.headScale).toBe(1);
  expect(leg.bleeders).toBeGreaterThan(0);
  const off = await page.evaluate(() => { const g = (window as any).__game; g.settings.blood = false; g.frame(1 / 30, false); return g.blood.enabled; });
  expect(off).toBe(false);
});
