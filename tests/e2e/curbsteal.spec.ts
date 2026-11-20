import { test, expect } from '@playwright/test';
import { boot, watch, clean, quietStreets } from './helpers';

/** R6-K: stealing a locked, parked car off the curb must end with a drivable car and a seated (not sunk) player. */
async function parkedRig(page: any, breakFirst: boolean) {
  return page.evaluate(`(() => {
    const g = window.__game;
    g.trafficCap = 0; g.pedCap = 0;
    const lane = g.city.lanes.find(l => !l.connector && l.length > 120);
    const p = lane.pts ? lane.pts[0] : null;
    const x = -280, z = -97.5;
    const v = g.vehicles.spawn('sedan', x, z, Math.PI / 2, 5, 0.25);
    v.settleParked(0); v.parked = true; v.doorsLocked = true; v.ignition = false; v.persistent = true;
    window.__v = v;
    const d = v.doorWorldPos(0); g.player.place(d.x, v.position.y - 0.3, d.z, v.yaw);
    for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
    ${breakFirst ? 'const pane = v.paneOfDoor(0); v.breakGlass(pane);' : ''}
    window.__smashed = false;
    g.input.tap('KeyF');
    const phases = new Set();
    for (let i = 0; i < 900 && !(g.playerVehicle === v && !g.carEntry.job); i++) { g.frame(1 / 30, false); if (g.carEntry.phase) phases.add(g.carEntry.phase); }
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    const sx = v.position.x, sz = v.position.z;
    g.input.press('KeyW');
    for (let i = 0; i < 240; i++) g.frame(1 / 30, false);
    g.input.release('KeyW');
    const moved = Math.hypot(v.position.x - sx, v.position.z - sz);
    const r = g.player.human.root, s = v.seatLocal(0);
    const THREE_V = s.constructor; let minFoot = 99; const pv = new THREE_V();
    g.player.human.root.traverse(o => { if (o.isBone && /toe|ball/i.test(o.name)) { o.getWorldPosition(pv); v.visual.worldToLocal(pv); minFoot = Math.min(minFoot, pv.y); } });
    const floor = v.tpl.shape.clear + 0.12 - 0.35;
    return { minFoot, floor, seated: g.playerVehicle === v, moved, phases: [...phases], dSeat: r.position.distanceTo(s), ign: v.ignition, parked: v.parked };
  })()`);
}
test('stealing a locked parked car: seated and drivable', async ({ page }) => {
  const p = watch(page); await boot(page); await quietStreets(page);
  const r = await parkedRig(page, false);
  console.log(JSON.stringify(r));
  expect(r.seated).toBe(true);
  expect(r.phases).toContain('smash');
  expect(r.dSeat).toBeLessThan(0.05);
  expect(r.moved).toBeGreaterThan(10);
  expect(r.minFoot).toBeGreaterThan(r.floor - 0.05); // feet on the floor, not through it
  clean(p);
});
test('driver glass already broken: no second smash', async ({ page }) => {
  const p = watch(page); await boot(page); await quietStreets(page);
  const r = await parkedRig(page, true);
  console.log(JSON.stringify(r));
  expect(r.seated).toBe(true);
  expect(r.phases).not.toContain('smash');
  expect(r.moved).toBeGreaterThan(10);
  clean(p);
});

test('hold aim in a car with a pistol: gun comes out, fire shoots along the aim point; no gun, nothing', async ({ page }) => {
  const p = watch(page); await boot(page); await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game;
    const v = g.vehicles.spawn('sedan', -280, -97.5, Math.PI / 2); v.persistent = true;
    const d = v.doorWorldPos(0); g.player.place(d.x, v.position.y - 0.3, d.z, v.yaw);
    for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
    g.input.tap('KeyF');
    for (let i = 0; i < 900 && !(g.playerVehicle === v && !g.carEntry.job); i++) g.frame(1 / 30, false);
    g.pcombat.give('pistol', 100); g.pcombat.inv.select('pistol');
    const out = {};
    for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
    out.idle = g.pcombat.driveAim;
    g.input.press('Mouse2');
    for (let i = 0; i < 30; i++) g.frame(1 / 30, false);
    out.aim = g.pcombat.driveAim; out.crosshair = g.hudState(null, null).crosshair;
    const before = g.pcombat.inv.state.clip;
    g.input.press('Mouse0');
    for (let i = 0; i < 12; i++) g.frame(1 / 30, false);
    g.input.release('Mouse0');
    out.fired = before - g.pcombat.inv.state.clip;
    out.seated = g.playerVehicle === v; out.rootRot = g.player.human.root.rotation.y;
    g.input.release('Mouse2');
    for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    out.after = g.pcombat.driveAim;
    g.pcombat.inv.select('fists');
    g.input.press('Mouse2'); for (let i = 0; i < 10; i++) g.frame(1 / 30, false);
    out.fistsAim = g.pcombat.driveAim; g.input.release('Mouse2');
    const camFor = side => { for (const y of [v.yaw + Math.PI / 2, v.yaw - Math.PI / 2]) { g.cam.yaw = y; g.cam.pitch = 0; for (let i = 0; i < 4; i++) g.frame(1 / 30, false); if (g.pcombat.driveSide(v) === side) return; } };
    const tryW = (id, side = 1) => { g.pcombat.give(id, 40); g.input.press('Mouse2'); camFor(side); g.input.release('Mouse2'); g.pcombat.inv.select(id); g.input.press('Mouse2'); for (let i = 0; i < 20; i++) g.frame(1 / 30, false); const o = { aim: g.pcombat.driveAim, rolled: v.rolledMask !== 0 }; const m = g.pcombat.models?.get(id); o.gunOut = null; if (m && m.g.visible) { const l = v.visual.worldToLocal(m.g.position.clone()); o.gunOut = Math.abs(l.x) - v.tpl.shape.W / 2; } g.input.release('Mouse2'); for (let i = 0; i < 5; i++) g.frame(1 / 30, false); o.rolledBack = v.rolledMask === 0; return o; };
    out.rifle = tryW('rifle'); out.rifleFar = tryW('rifle', -1); out.smg = tryW('smg'); out.rpg = tryW('rpg'); out.grenade = tryW('grenade');
    return out;
  })()`) as any;
  console.log(JSON.stringify(r));
  expect(r.idle).toBe(false);
  expect(r.aim).toBe(true);
  expect(r.crosshair).not.toBe('none');
  expect(r.fired).toBeGreaterThan(0);
  expect(r.seated).toBe(true);
  expect(r.after).toBe(false);
  expect(r.fistsAim).toBe(false);
  for (const k of ['rifle', 'smg', 'grenade']) { expect(r[k].aim, k).toBe(true); expect(r[k].rolled, k).toBe(true); expect(r[k].rolledBack, k).toBe(true); }
  expect(r.rpg.aim).toBe(false);
  expect(r.rifleFar.rolled).toBe(true);
  expect(r.rifleFar.gunOut).toBeGreaterThan(-0.6); // far side: leaning and reaching over the dash
  expect(r.rifle.gunOut).toBeGreaterThan(-0.35); // the long gun is at the window plane, not inside the cabin
  clean(p);
});

test('bullet holes never land on a car window opening (they would hang in the sky)', async ({ page }) => {
  const p = watch(page); await boot(page); await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game, THREE_V = g.player.pos.constructor;
    const v = g.vehicles.spawn('sedan', -280, -97.5, Math.PI / 2); v.persistent = true;
    for (let i = 0; i < 5; i++) g.frame(1 / 30, false);
    const pane = v.panes[0].id; const c = new THREE_V();
    v.breakGlass(pane);
    const tp = v.tpl.panes.find(x => x.id === pane); c.set(tp.tris[0], tp.tris[1], tp.tris[2]);
    v.bodyMesh.updateMatrixWorld(); const w = v.visual.localToWorld(c.clone());
    return { over: v.overGlass(w), farOver: v.overGlass(v.position.clone().setY(v.position.y - 1)) };
  })()`) as any;
  expect(r.over).toBe(true);
  expect(r.farOver).toBe(false);
  clean(p);
});

test('real shots at a car leave decals on its surface (<5 cm) that travel with the car, never in the air', async ({ page }) => {
  const p = watch(page); await boot(page); await quietStreets(page);
  const r = await page.evaluate(`(() => {
    const g = window.__game, V3 = g.player.pos.constructor;
    const v = g.vehicles.spawn('sedan', -280, -97.5, Math.PI / 2); v.persistent = true;
    for (let i = 0; i < 20; i++) g.frame(1 / 30, false);
    const def = g.pcombat.inv.def.melee ? (g.pcombat.give('pistol', 100), g.pcombat.inv.select('pistol'), g.pcombat.inv.def) : g.pcombat.inv.def;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    for (let k = 0; k < 14; k++) {
      const h = 0.4 + (k % 7) * 0.2, lat = ((k % 5) - 2) * 0.3, fwd = 0.2 + (k % 3) * 0.7;
      const target = new V3(v.position.x + fx * fwd - fz * lat, v.position.y + h, v.position.z + fz * fwd + fx * lat);
      const origin = new V3(v.position.x + fx * 7, v.position.y + 1.3, v.position.z + fz * 7);
      const dir = target.clone().sub(origin).normalize();
      g.combat.shoot(g.player, def, origin, dir, 0);
    }
    for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    const list = v.visual.userData.decals ?? [];
    const wp = d => d.getWorldPosition(new V3());
    // nearest visible-surface distance along each decal's normal: Moller-Trumbore over the skinned body mesh
    const mesh = v.bodyMesh; mesh.updateMatrixWorld(true); v.syncTransform(); mesh.updateMatrixWorld(true);
    const geo = mesh.geometry, idx = geo.index, nV = geo.attributes.position.count;
    const P = []; for (let i = 0; i < nV; i++) P.push(new V3(geo.attributes.position.getX(i), geo.attributes.position.getY(i), geo.attributes.position.getZ(i)).applyMatrix4(mesh.matrixWorld));
    const nT = idx ? idx.count / 3 : nV / 3;
    const surfDist = (o, dn) => {
      let best = Infinity; const e1 = new V3(), e2 = new V3(), h = new V3(), sv = new V3(), q = new V3();
      for (let t = 0; t < nT; t++) {
        const a = P[idx ? idx.getX(t * 3) : t * 3], b = P[idx ? idx.getX(t * 3 + 1) : t * 3 + 1], c = P[idx ? idx.getX(t * 3 + 2) : t * 3 + 2];
        e1.subVectors(b, a); e2.subVectors(c, a); h.crossVectors(dn, e2); const det = e1.dot(h); if (Math.abs(det) < 1e-9) continue;
        const f = 1 / det; sv.subVectors(o, a); const u = f * sv.dot(h); if (u < 0 || u > 1) continue;
        q.crossVectors(sv, e1); const w = f * dn.dot(q); if (w < 0 || u + w > 1) continue;
        const tt = f * e2.dot(q); if (tt > 0 && tt < best) best = tt;
      }
      return best;
    };
    const qd = new (g.cam.camera.quaternion.constructor)();
    let worst = 0; const dbg = [];
    const bb = P.reduce((m, q) => [Math.min(m[0], q.x), Math.max(m[1], q.x), Math.min(m[2], q.y), Math.max(m[3], q.y)], [9e9, -9e9, 9e9, -9e9]);
    for (const d of list) {
      const pos = d.getWorldPosition(new V3()); d.getWorldQuaternion(qd);
      const nrm = new V3(0, 0, 1).applyQuaternion(qd);
      const t1 = surfDist(pos.clone().addScaledVector(nrm, 0.3), nrm.clone().negate()), t2 = surfDist(pos.clone().addScaledVector(nrm, -0.3), nrm.clone());
      const dist = Math.min(Math.abs(t1 - 0.3), Math.abs(t2 - 0.3)); worst = Math.max(worst, dist); dbg.push([+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2), +t1.toFixed(3), +t2.toFixed(3)]);
    }
    const before = list.map(wp);
    v.phys.teleport(v.position.x + 10, v.position.y, v.position.z, v.yaw);
    for (let i = 0; i < 3; i++) g.frame(1 / 30, false);
    const moved = list.map((d, i) => wp(d).distanceTo(before[i]));
    return { dbg, bb, car: [v.position.x, v.position.y, v.position.z], nT, n: list.length, parentOk: list.every(d => d.parent === v.visual), worst, moveMin: Math.min(...moved), moveMax: Math.max(...moved) };
  })()`) as any;
  expect(r.n).toBeGreaterThan(0);
  expect(r.parentOk).toBe(true);
  console.log(JSON.stringify(r));
  expect(r.worst).toBeLessThan(0.05);
  expect(r.moveMin).toBeGreaterThan(8);
  expect(r.moveMax).toBeLessThan(12);
  clean(p);
});
