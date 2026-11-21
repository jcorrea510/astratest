import { test, expect, type Page } from '@playwright/test';
import { boot, quietStreets } from './helpers';

/** R6-P pedestrians: walk signs, no jaywalking, no phantom stumbles, fist fights, hands-up pose. Screenshots to PED_SHOTS. */
test.describe.configure({ mode: 'serial' });
let page: Page;
const SHOTS = process.env.PED_SHOTS ?? 'test-results';
test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await boot(page); });
test.afterAll(async () => { await page.close(); });

test('a crowded street for 60 s: nobody crosses against the sign, jaywalks, or stumbles into nothing', async () => {
  test.setTimeout(900_000);
  const r = await page.evaluate(`(() => {
    const g = window.__game, city = g.city;
    g.clockRunning = false; g.hour = 13; g.pedCap = 90; g.trafficCap = 0;
    const H = g.player.human.constructor.prototype, orig = H.playAction;
    const BAD = new Set(['stagger', 'knockdown', 'hit_light', 'hit_head', 'Roll', 'Hit_Chest', 'Hit_Head']);
    const bad = [];
    H.playAction = function (name, o) {
      if (BAD.has(name) && g.pop.npcs.some(q => q.char.human === this)) bad.push(name);
      return orig.call(this, name, o);
    };
    const ci = city.intersectionAt(3, 5); g.player.place(ci.x + 12, 0.25, ci.z + 12, 0);
    g.prewarm();
    const clearCars = () => { for (const c of [...g.traffic.cars]) if (!c.persistent) { g.traffic.cars.splice(g.traffic.cars.indexOf(c), 1); g.pop.remove(c.driver); g.vehicles.remove(c.v); } for (const v of [...g.vehicles.list]) if (!v.persistent && !v.driver) g.vehicles.remove(v); };
    clearCars();
    // geometry helpers: carriageway test and distance to the nearest marked crossing
    const onRoad = (x, z) => { for (const r of city.roads) { const al = r.axis === 'x' ? x : z, ac = Math.abs((r.axis === 'x' ? z : x) - r.coord); if (ac < r.half && al > r.from && al < r.to) return true; } for (const i of city.intersections) if (Math.abs(x - i.x) < i.halfX && Math.abs(z - i.z) < i.halfZ) return true; return false; };
    const segs = []; for (const a of city.pedNodes) for (const e of a.edges) if (e.crossing && a.id < e.to) segs.push([a, city.pedNodes[e.to]]);
    const distSeg = (x, z) => { let best = 99; for (const [a, b] of segs) { const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)); best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z)); } return best; };
    const P = g.visuals.pedSignals, lastWalk = P.posts.map(() => -99);
    const was = new Map();
    let offCross = 0, against = 0, entries = 0, samples = 0, maxOnRoad = 0; const ex = [];
    for (let i = 0; i < 90; i++) g.frame(1 / 30, false);
    bad.length = 0;
    for (let i = 0; i < 60 * 30; i++) {
      g.frame(1 / 30, false);
      if (i % 90 === 0) clearCars();
      P.posts.forEach((p, k) => { if (P.shown(k) === 'walk') lastWalk[k] = g.time; });
      let on = 0;
      for (const n of g.pop.npcs) {
        if (n.far || !n.alive || n.char.inVehicle || n.persistent || n.brain !== 'wander') continue;
        const road = onRoad(n.pos.x, n.pos.z); samples++;
        if (road) { on++; const d = distSeg(n.pos.x, n.pos.z); if (d > 2.4 && n.pos.y < 0.8) { offCross++; if (ex.length < 5) ex.push([+n.pos.x.toFixed(1), +n.pos.z.toFixed(1), +d.toFixed(1)]); } }
        if (road && !was.get(n)) {
          entries++;
          let bi = -1, bd = 7; P.posts.forEach((p, k) => { const d = Math.hypot(p.x - n.pos.x, p.z - n.pos.z); if (d < bd) { bd = d; bi = k; } });
          if (bi >= 0 && g.time - lastWalk[bi] > 7) against++;
        }
        was.set(n, road);
      }
      maxOnRoad = Math.max(maxOnRoad, on);
    }
    return { bad: bad.length, offCross, against, entries, samples, maxOnRoad, ex, npcs: g.pop.npcs.length };
  })()`) as any;
  console.log('crowd', JSON.stringify(r));
  expect(r.npcs).toBeGreaterThan(30);
  expect(r.bad, 'stumbles / knockdowns / rolls with no vehicle or player involved').toBe(0);
  expect(r.offCross, 'pedestrians on the carriageway away from a crosswalk').toBe(0);
  expect(r.against, 'pedestrians who stepped off the kerb on DON\'T WALK').toBe(0);
});

test('peds waiting at a signalized crosswalk cross once the sign shows WALK (and not before)', async () => {
  test.setTimeout(300_000);
  await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game, city = g.city, P = g.visuals.pedSignals, N = city.pedNodes;
    g.clockRunning = false; g.hour = 13; g.pedCap = 0; g.trafficCap = 0;
    for (const n of [...g.pop.npcs]) if (!n.persistent) g.pop.remove(n);
    // a signalized crossing edge in a busy junction, and the signal post that governs it
    let edge = null;
    for (const a of N) for (const e of a.edges) if (!edge && e.crossing && a.id < e.to && city.intersections[e.crossing.intersection].signalized && city.intersections[e.crossing.intersection].ix >= 2) edge = { a, b: N[e.to], e };
    const inter = city.intersections[edge.e.crossing.intersection];
    let post = 0, bd = 99; P.posts.forEach((p, k) => { const d = Math.min(Math.hypot(p.x - edge.a.x, p.z - edge.a.z), Math.hypot(p.x - edge.b.x, p.z - edge.b.z)); if (p.inter === inter.id && d < bd) { bd = d; post = k; } });
    // find the start of a DON'T WALK stretch followed by WALK for this post
    const at = t => { g.time = t; P.update(t); return P.shown(post); };
    let tHand = -1, tWalk = -1;
    for (let t = 0; t < 120 && tWalk < 0; t += 0.25) { const s = at(t); if (s === 'hand' && tHand < 0) tHand = t; else if (s === 'walk' && tHand >= 0) tWalk = t; }
    const mx = (edge.a.x + edge.b.x) / 2, mz = (edge.a.z + edge.b.z) / 2;
    g.player.place(mx + 14, 0.25, mz + 14, 0);
    at(tHand);
    const peds = [];
    for (let i = 0; i < 4; i++) {
      const n = g.pop.spawn('civilian', edge.a.x + (edge.b.x - edge.a.x) * 0.02 + (i - 1.5) * 0.35, edge.a.z + (edge.b.z - edge.a.z) * 0.02, 0.2);
      n.persistent = true; n.brain = 'wander'; n.activity = ''; n.buddy = null; n.node = edge.a.id; n.nextNode = edge.a.id; n.pend = edge.e;
      peds.push(n);
    }
    const dist = n => Math.hypot(n.pos.x - edge.b.x, n.pos.z - edge.b.z);
    const L = Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z);
    // phase 1: DON'T WALK for 1.5 s: nobody leaves the kerb
    let tt = tHand;
    for (let i = 0; i < 45; i++) { tt += 1 / 30; at(tt); g.frame(1 / 30, false); }
    const before = peds.filter(n => !n.alive || dist(n) < L - 3.5).length;
    // phase 2: jump to WALK and run the phase
    tt = tWalk; at(tt);
    let onWalkEnter = 0, walkFrames = 0; const minD = peds.map(() => 99);
    for (let i = 0; i < 15 * 30; i++) {
      tt += 1 / 30; at(tt); g.frame(1 / 30, false);
      if (P.shown(post) === 'walk') { walkFrames++; peds.forEach((n, k) => { if (n.alive) { minD[k] = Math.min(minD[k], dist(n)); if (n.onCross) onWalkEnter++; } }); }
    }
    // crossed = left the kerb and stepped onto the road while the sign showed WALK
    const crossed = minD.filter(d => d < L - 2.5).length;
    return { before, crossed, onWalkEnter, walkFrames, minD: minD.map(d => +d.toFixed(1)), tHand, tWalk, L: +L.toFixed(1), n: peds.length };
  })()`) as any;
  console.log('crossing', JSON.stringify(r));
  expect(r.tWalk).toBeGreaterThan(r.tHand);
  expect(r.before, 'nobody steps off the kerb on DON\'T WALK').toBe(0);
  expect(r.crossed, 'at least one waiting ped crossed during WALK').toBeGreaterThanOrEqual(1);
});

test('walk / don\'t-walk heads show the signal phase and look right', async () => {
  test.setTimeout(300_000);
  await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game, P = g.visuals.pedSignals;
    g.pedCap = 0;
    // pick a crosswalk pole of a busy junction; face it from the street side
    const k = P.posts.findIndex(p => g.city.intersections[p.inter].ix >= 2 && g.city.intersections[p.inter].iz >= 2);
    const p = P.posts[k], inter = g.city.intersections[p.inter];
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    g.player.place(p.x + fx * 9 + fz * 2.5, 0.25, p.z + fz * 9 - fx * 2.5, p.yaw + Math.PI);
    g.player.human.root.visible = false;
    const shots = {};
    // find a game time with WALK and one with DON'T WALK for this pole
    const states = {};
    for (let t = 0; t < 40 && Object.keys(states).length < 2; t += 0.25) { g.time = t; g.visuals.pedSignals.update(t); const s = P.shown(k); if (!states[s]) states[s] = t; }
    return { n: P.posts.length, k, states, x: p.x, z: p.z, yaw: p.yaw, heads: g.visuals.pedSignals.group.children.length };
  })()`) as any;
  console.log('heads', JSON.stringify(r));
  expect(r.n).toBeGreaterThan(50);
  expect(Object.keys(r.states).sort()).toEqual(['hand', 'walk']);
  for (const st of ['walk', 'hand'] as const) {
    await page.evaluate(({ k, t }) => {
      const g = (window as any).__game; g.clockRunning = false; g.time = t; g.visuals.pedSignals.update(t);
      const p = g.visuals.pedSignals.posts[k], cam = g.renderer.camera, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
      g.time = t; g.visuals.pedSignals.update(t);
      cam.position.set(p.x + fx * 5 + fz * 1.2, 2.0, p.z + fz * 5 - fx * 1.2); cam.lookAt(p.x, 2.5, p.z); cam.updateMatrixWorld(true);
      g.renderer.render();
    }, { k: r.k, t: r.states[st] });
    await page.screenshot({ path: `${SHOTS}/pedsignal-${st}.png`, timeout: 120_000 });
  }
});

test('a punched civilian fights back (brave) or runs (timid); gunfire and hits break hands-up', async () => {
  test.setTimeout(600_000);
  await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game, fists = { id: 'fists' }, pistol = { id: 'pistol' };
    g.clockRunning = false; g.hour = 13;
    g.player.place(-41, 0.25, 9, 0);
    const mk = (dx, nerve) => { const n = g.pop.spawn('civilian', -41 + dx, 11, 0.2); n.persistent = true; n.nerve = nerve; n.brain = 'idle'; return n; };
    const brave = mk(0, 0.95), timid = mk(6, 0.02);
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    const punches = { n: 0 }; const H = g.player.human.constructor.prototype, orig = H.playAction;
    H.playAction = function (name, o) { if (name.startsWith('punch_') && this === brave.char.human) punches.n++; return orig.call(this, name, o); };
    const hp0 = g.player.health;
    g.combat.onHit(brave.char, 5, g.player, false, false, fists, 'torso');
    g.combat.onHit(timid.char, 5, g.player, false, false, fists, 'torso');
    const out = { braveBrain: brave.brain, timidBrain: timid.brain };
    let guard = false, close = 99;
    for (let i = 0; i < 8 * 30; i++) { g.frame(1 / 30, false); if (brave.char.human.actionName === 'guard') guard = true; if (i > 60) close = Math.min(close, brave.pos.distanceTo(g.player.pos)); }
    Object.assign(out, { punches: punches.n, guard, close, braveBrain2: brave.brain, playerHurt: g.player.health < hp0 });
    // hands up -> shots nearby
    const a = mk(-6, 0.5); a.brain = 'surrender'; a.waitT = 30; a.stateT = 0; a.char.human.playAction('hands_up', { hold: true });
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    out.upBefore = a.char.human.actionName === 'hands_up';
    g.pop.danger(g.player.pos, 35, g.player);
    for (let i = 0; i < 3 * 30; i++) g.frame(1 / 30, false);
    Object.assign(out, { afterShot: a.brain, upAfterShot: a.char.human.actionName === 'hands_up' });
    // hands up -> shot (hit)
    const b = mk(-9, 0.5); b.brain = 'surrender'; b.waitT = 30; b.stateT = 0; b.char.human.playAction('hands_up', { hold: true });
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    g.combat.onHit(b.char, 5, g.player, false, false, pistol, 'torso');
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    Object.assign(out, { hitBrain: b.brain, upAfterHit: b.char.human.actionName === 'hands_up', hitSpeed: b.char.speed });
    return out;
  })()`) as any;
  console.log('fight', JSON.stringify(r));
  expect(r.braveBrain).toBe('fight');
  expect(r.timidBrain).toBe('flee');
  expect(r.guard, 'guard stance shown').toBe(true);
  expect(r.punches, 'the brave one throws punches').toBeGreaterThan(0);
  expect(r.close).toBeLessThan(2.2);
  expect(r.upBefore).toBe(true);
  expect(['flee', 'cower']).toContain(r.afterShot);
  expect(r.upAfterShot).toBe(false);
  expect(r.hitBrain).toBe('flee');
  expect(r.upAfterHit).toBe(false);
  expect(r.hitSpeed).toBeGreaterThan(1.5);
});

test('screenshots: hands-up pose (front and side) and fight stance', async () => {
  test.setTimeout(300_000);
  for (const [name, action, camSide] of [['hands-front', 'hands_up', false], ['hands-side', 'hands_up', true], ['guard-front', 'guard', false]] as const) {
    await page.evaluate(({ action, camSide }) => {
      const g = (window as any).__game;
      const gd = new Set(g.armyGuards.guards.map((q: any) => q.npc)); for (const n of [...g.pop.npcs]) if (!gd.has(n)) g.pop.remove(n);
      g.hour = 13; g.player.human.root.visible = false; g.player.place(-41, 0.25, 4, 0);
      const n = g.pop.spawn('civilian', -41, 12, 0.2); n.persistent = true; n.brain = 'scripted'; n.char.yaw = Math.PI;
      for (let i = 0; i < 15; i++) g.frame(1 / 30, false);
      n.char.human.playAction(action, { hold: true });
      for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
      const cam = g.renderer.camera;
      if (camSide) cam.position.set(-38.6, 1.5, 12); else cam.position.set(-41.3, 1.5, 9.6);
      cam.lookAt(-41, 1.25, 12); cam.updateMatrixWorld(true); g.renderer.render();
    }, { action, camSide });
    await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: { x: 340, y: 60, width: 600, height: 600 }, timeout: 120_000 });
  }
});
