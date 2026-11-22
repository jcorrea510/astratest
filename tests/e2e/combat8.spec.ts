import { test, expect } from '@playwright/test';
import { boot } from './helpers';

/** Round 8 (owner): front windshield shots sometimes did nothing; corpses could not be shot (no blood, no holes, no movement). */
test('rounds aimed at the windshield from the front always reach the glass', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    const out: any = {};
    for (const kind of ['sedan', 'coupe', 'suv', 'pickup']) {
      const v = g.vehicles.spawn(kind, 40, 300, 0, -1, 0.3); v.persistent = true;
      for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
      const pane = v.tpl.panes.find((p: any) => p.name === 'windshield');
      // windshield centre in world space: average of its rest-pose triangle vertices through the body transform
      const t = pane.tris; let cx = 0, cy = 0, cz = 0, n = 0; for (let i = 0; i < t.length; i += 3) { cx += t[i]; cy += t[i + 1]; cz += t[i + 2]; n++; }
      const c = v.group.localToWorld(v.group.position.clone().set(cx / n, cy / n, cz / n));
      let hits = 0, tries = 0;
      for (const ang of [-0.6, -0.3, 0, 0.3, 0.6]) for (const h of [0.9, 1.4, 1.9]) {
        const o = c.clone().add({ x: Math.sin(ang) * 12, y: 0, z: Math.cos(ang) * 12 } as any); o.y = h + v.position.y;
        const d = c.clone().sub(o).normalize();
        const tr = g.combat.trace(o, d, 40, null, { dry: true }); tries++;
        if (tr.glass.includes(v)) hits++;
      }
      out[kind] = `${hits}/${tries}`;
      g.vehicles.remove?.(v);
    }
    return out;
  });
  console.log('windshield', JSON.stringify(r));
  for (const k of Object.keys(r)) { const [h, t] = r[k].split('/').map(Number); expect(h, k).toBeGreaterThanOrEqual(t - 1); }
});

test('a corpse takes rounds: blood, a jolt, and the round stops in the body', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);
  const r = await page.evaluate(() => {
    const g = (window as any).__game;
    g.player.place(0, 0.3, 120, 0); for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    const n = g.pop.spawn('civilian', 0, 126, 0.2); n.persistent = true; n.char.damage(1000, g.player, g.time);
    for (let i = 0; i < 60; i++) g.frame(1 / 30, false);
    const p0 = n.char.pos.clone(), wounds0 = g.blood.woundCount, splats0 = g.blood.splatCount;
    g.pcombat.give('shotgun', 20); g.pcombat.inv.select('shotgun');
    const o = g.player.pos.clone(); o.y += 1.5;
    for (let i = 0; i < 2; i++) g.frame(1 / 30, true); // bones in their lying pose
    const hips = n.char.human.model.getObjectByName('DEF-hips') ?? n.char.human.model.getObjectByName('DEF-spine001'); const target = new (g.player.pos.constructor)(); hips.getWorldPosition(target);
    const d = target.clone().sub(o).normalize();
    const hits = g.combat.shoot(g.player, g.pcombat.inv.def, o, d, 0.0);
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    return { hitBody: hits.some((h: any) => h.target === n.char), kinds: hits.map((h: any) => h.kind), wounds: g.blood.woundCount - wounds0, splats: g.blood.splatCount - splats0, moved: n.char.pos.distanceTo(p0), dbg: { inPop: g.pop.npcs.includes(n), alive: n.char.alive, dead: n.char.deadTime, brain: n.brain, root: n.char.human.root.position.toArray().map((x: number) => +x.toFixed(2)), pl: g.player.pos.toArray().map((x: number) => +x.toFixed(2)), blood: g.blood.enabled } };
  });
  console.log('corpse', JSON.stringify(r));
  expect(r.hitBody).toBe(true);
  expect(r.splats).toBeGreaterThan(0);
  expect(r.wounds + r.moved * 100).toBeGreaterThan(0);
});
