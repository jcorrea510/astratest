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
