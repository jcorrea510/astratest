import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** Round 9 (owner): gore with every gun: arms and legs come off (heavy guns in one hit, pistols after a few); off with the Blood setting. */
test.describe.configure({ mode: 'serial' });
let page: Page;
const SHOTS = process.env.GORE_SHOTS || '';
test.beforeAll(async ({ browser }) => { test.setTimeout(300_000); page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage(); await boot(page); await quietStreets(page); });
test.afterAll(async () => { await page.context().close(); });

/** Shoots `boneName` (up to `max` rounds) and reports whether that bone was collapsed (severed). */
const sever = (boneName: string, weapon: string, max: number, shot = '') => page.evaluate(({ boneName, weapon, max, shot }) => {
  const g = (window as any).__game, V = g.player.pos.constructor;
  g.player.place(-250, 0.25, -80, 0);
  const n = g.pop.spawn('civilian', -250, -74, 0.25); n.brain = 'scripted'; n.persistent = true; n.char.yaw = Math.PI;
  // tough enough to stay standing: a pistol victim that dies on the 2nd or 3rd round falls while we aim, and the corpse's arm is then a moving target (CI saw 8 rounds go by)
  if (weapon === 'pistol') n.char.health = n.char.maxHealth = 1000;
  for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
  g.pcombat.give(weapon, 60); g.pcombat.inv.select(weapon);
  const find = () => { let b: any = null; n.char.human.model.traverse((o: any) => { if (!b && o.name === boneName) b = o; }); return b; };
  let shots = 0;
  const pieces0 = g.blood.pieceCount;
  while (shots < max && find().scale.x > 0.5) {
    n.char.human.model.updateMatrixWorld(true);
    const b = find(), p = b.getWorldPosition(new V()), kid = b.children.find((c: any) => c.isBone);
    const tgt = kid ? p.clone().lerp(kid.getWorldPosition(new V()), 0.5) : p;
    const from = new V(-250, tgt.y, -78.5), dir = tgt.clone().sub(from).normalize();
    g.combat.shoot(g.player, g.pcombat.inv.def, from, dir, 0); shots++;
    for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
  }
  for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
  const b = find();
  if (shot) {
    const c = g.cam.camera, p = n.char.human.root.getWorldPosition(new V());
    c.position.set(p.x + 2.2, p.y + 1.5, p.z + 2.4); c.lookAt(p.x, p.y + 0.3, p.z); c.updateMatrixWorld(true); g.renderer.render();
  }
  return { scale: b.scale.x, shots, pieces: g.blood.pieceCount - pieces0, alive: n.alive, bleeders: g.blood.bleeders.length };
}, { boneName, weapon, max, shot });

for (const [name, bone, weapon, max] of [
  ['shotgun takes an arm off in one blast', 'DEF-upper_armL', 'shotgun', 2],
  ['shotgun takes a leg off', 'DEF-thighR', 'shotgun', 2],
  ['a pistol wears an arm down until it comes off', 'DEF-upper_armR', 'pistol', 8],
  ['a pistol takes a lower leg off at the knee', 'DEF-shinL', 'pistol', 8],
] as const) {
  test(name, async () => {
    const r = await sever(bone, weapon, max, SHOTS ? `${bone}-${weapon}` : '');
    console.log(name, JSON.stringify(r));
    expect(r.scale).toBeLessThan(0.01);
    expect(r.pieces).toBeGreaterThan(0);
    expect(r.bleeders).toBeGreaterThan(0);
    if (weapon === 'shotgun') expect(r.shots).toBeLessThanOrEqual(2);
    else expect(r.shots).toBeGreaterThan(1);
    if ((bone.includes('thigh') || bone.includes('shin')) && weapon !== 'pistol') expect(r.alive).toBe(false);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/gore9-${bone}-${weapon}.png` });
  });
}

test('piece cap holds and Blood & gore off means no severing', async () => {
  const cap = await page.evaluate(() => { const g = (window as any).__game; return g.blood.pieceCount; });
  expect(cap).toBeLessThanOrEqual(8);
  const off = await page.evaluate(() => { const g = (window as any).__game; g.settings.blood = false; g.frame(1 / 30, false); return g.blood.enabled; });
  expect(off).toBe(false);
  const r = await sever('DEF-upper_armL', 'shotgun', 2);
  expect(r.scale).toBeGreaterThan(0.5); expect(r.pieces).toBe(0);
  await page.evaluate(() => { const g = (window as any).__game; g.settings.blood = true; g.frame(1 / 30, false); });
});
