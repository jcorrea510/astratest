/**
 * Fort Calder: the army base far out on the north-east plain. Fenced and wired perimeter with a guarded gate (booth, raised boom
 * barrier), watch towers, barracks rows, HQ with flagpole and parade ground, two hangars, a motor pool with vehicle sheds, fuel
 * tanks, a water tower, sandbag nests and a helipad apron (3 pads, painted markings). Everything is merged per chunk (trim /
 * facade builders) so the whole base costs a handful of draw calls.
 */
import * as THREE from 'three';
import { ARMY_BASE } from './citymap';
import { ROOF, T_METAL, T_STONE, T_PAINT, T_ROUGH, T_GLASS, T_NIGHTGLOW, type WallSpec, type Chunked, type TrimBuilder } from './builders';
import { type BuildCtx, type Helipad, warehouse } from './buildings';
import { helipadPad, perimeterFence } from './expansion';
import type { Physics } from '../core/physics';

const C = (h: string) => new THREE.Color(h);

/** Where things sit inside the base (world coordinates); the motor pool lots and helipads are also read by the game for parked vehicles. */
export function armyLayout() {
  const B = ARMY_BASE, gz = B.gateZ;
  return {
    spineX: B.x0 + 68,
    pads: [{ x: B.x0 + 92, z: gz + 27 }, { x: B.x0 + 118, z: gz + 27 }, { x: B.x0 + 105, z: gz + 55 }],
    /** parked army vehicles: kind + position + heading */
    motorPool: [
      { kind: 'army' as const, x: B.x0 + 80, z: B.z0 + 22, yaw: Math.PI / 2 }, { kind: 'army' as const, x: B.x0 + 80, z: B.z0 + 30, yaw: Math.PI / 2 },
      { kind: 'army' as const, x: B.x0 + 80, z: B.z0 + 38, yaw: Math.PI / 2 }, { kind: 'army' as const, x: B.x0 + 80, z: B.z0 + 46, yaw: Math.PI / 2 },
      { kind: 'tank' as const, x: B.x0 + 103, z: B.z0 + 30, yaw: 0 },
      { kind: 'army' as const, x: B.x0 + 98, z: B.z0 + 52, yaw: Math.PI },
    ],
  };
}

export function buildArmyBase(ctx: BuildCtx, trim: Chunked<TrimBuilder>, physics: Physics, helipads: Helipad[]) {
  const B = ARMY_BASE, gz = B.gateZ, L = armyLayout();
  const t = (x: number, z: number) => trim.at(x, z);
  const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
  perimeterFence(trim, physics, B.x0, B.z0, B.x1, B.z1, [{ side: 'e', at: gz, w: 12 }], true);

  // ---- ground: concrete apron, internal asphalt roads, parade ground, painted lines
  const asphalt = C('#3b3d40'), conc = C('#8e8b84'), dirt = C('#6f6a55'), line = C('#d8c464');
  t(cx, cz).box(cx, 0.045, cz, B.x1 - B.x0 - 2, 0.04, B.z1 - B.z0 - 2, 0, dirt, T_ROUGH); // packed-earth yard
  t(cx, gz).box(cx + 15, 0.07, gz, B.x1 - B.x0 + 30, 0.04, 9, 0, asphalt, T_STONE); // gate road, continues out to Fort Calder Rd
  t(L.spineX, cz).box(L.spineX, 0.07, cz, 8, 0.04, B.z1 - B.z0 - 20, 0, asphalt, T_STONE); // spine road
  for (let x = B.x0 + 8; x < B.x1 + 24; x += 8) t(x, gz).box(x, 0.1, gz, 3, 0.02, 0.2, 0, line, T_PAINT);
  for (let z = B.z0 + 14; z < B.z1 - 10; z += 8) t(L.spineX, z).box(L.spineX, 0.1, z, 0.2, 0.02, 3, 0, line, T_PAINT);
  const apronX = B.x0 + 105, apronZ = gz + 40;
  t(apronX, apronZ).box(apronX, 0.09, apronZ, 62, 0.05, 66, 0, conc, T_STONE); // helicopter apron slab
  t(B.x0 + 36, gz + 44).box(B.x0 + 36, 0.08, gz + 44, 36, 0.04, 22, 0, conc, T_STONE); // parade ground
  t(B.x0 + 90, B.z0 + 40).box(B.x0 + 90, 0.08, B.z0 + 40, 44, 0.04, 56, 0, conc, T_STONE); // motor pool lot
  for (let k = 0; k < 6; k++) t(B.x0 + 36, gz + 44).box(B.x0 + 36 - 15 + k * 6, 0.11, gz + 44, 0.2, 0.02, 20, 0, C('#e8e4d8'), T_PAINT);

  // ---- gate: guard booth, raised boom barrier, signs, lamps, sandbags
  const gx = B.x1;
  ctx.fac.at(gx, gz).box(gx - 4, gz + 9, 3.6, 3.6, 0, 3.1, 0, C('#a9a58f'), [{ kind: 2, seed: 12, cellW: 1.8, cellH: 3, winW: 1.3, winH: 1.3, sill: 0.9, mat: 2, originV: 0, baseY: 0, lit: 0.9, floors: 1 } as WallSpec], { ...ROOF, seed: 2 });
  physics.addStaticBox(gx - 4, 1.55, gz + 9, 1.8, 1.55, 1.8);
  t(gx, gz).box(gx - 4, 3.25, gz + 9, 4.6, 0.2, 4.6, 0, C('#4a4d46'), T_METAL); // booth roof overhang
  const bt = t(gx + 1, gz);
  bt.box(gx + 1, 0.55, gz + 5.4, 0.6, 1.1, 0.6, 0, C('#4c4f52'), T_METAL); // barrier housing
  bt.beam(gx + 1, 1.0, gz + 5.4, gx + 1, 6.5, gz - 1.5, 0.22, 0.22, C('#e8e2d2'), T_PAINT); // arm raised
  for (let k = 0; k < 4; k++) { const f = 0.15 + k * 0.2; bt.beam(gx + 1, 1.0 + 5.5 * f, gz + 5.4 - 6.9 * f, gx + 1, 1.0 + 5.5 * (f + 0.1), gz + 5.4 - 6.9 * (f + 0.1), 0.24, 0.24, C('#c0392b'), T_PAINT); }
  bt.box(gx + 1, 0.55, gz - 5.2, 0.5, 1.1, 0.5, 0, C('#4c4f52'), T_METAL);
  for (const s of [-1, 1]) { // chicane blocks and tyre-shredder strips
    for (let k = 0; k < 3; k++) t(gx - 14, gz + s * 6).box(gx - 14 - k * 5, 0.45, gz + s * (6.5 + k * 0.6), 4.2, 0.9, 1.0, 0, C('#a8a49a'), T_STONE);
    physics.addStaticBox(gx - 19, 0.45, gz + s * 7.2, 7, 0.45, 0.5);
  }
  t(gx, gz - 8).box(gx - 1, 2.4, gz - 11, 0.15, 3.2, 6, 0, C('#2d3a2a'), T_PAINT); // gate sign board
  t(gx, gz - 8).box(gx - 1.1, 2.4, gz - 11, 0.05, 2.4, 5.2, 0, C('#e8e2cf'), T_PAINT);
  for (const s of [-1, 1]) t(gx, gz).cyl(gx - 0.5, 0, gz + s * 8, 0.09, 0.07, 7, 8, C('#6d6f70'), T_METAL), t(gx, gz).box(gx - 0.5, 7.1, gz + s * 8, 0.8, 0.12, 0.35, 0, C('#fff6d8'), T_NIGHTGLOW(6));
  const bag = (x: number, z: number, n: number, yaw = 0, dx = 1.2) => {
    for (let k = 0; k < n; k++) for (let r = 0; r < 3; r++) { if (r > 0 && k >= n - r) continue; t(x, z).box(x + Math.cos(yaw) * (k + r * 0.5) * dx, 0.2 + r * 0.38, z - Math.sin(yaw) * (k + r * 0.5) * dx, 1.1, 0.36, 0.55, yaw, C(r % 2 ? '#8c7a55' : '#7f6f4b'), [0.95, 0, 2, 0]); }
    physics.addStaticBox(x + Math.cos(yaw) * (n * dx) / 2, 0.55, z - Math.sin(yaw) * (n * dx) / 2, (n * dx) / 2, 0.55, 0.3, yaw);
  };
  bag(gx - 9, gz - 12, 6, Math.PI / 2, 1.1); bag(gx - 9, gz + 12 - 6.6, 6, Math.PI / 2, 1.1);

  // ---- watch towers: corners, mid-sides and the gate flanks
  const towers: [number, number][] = [[B.x0 + 5, B.z0 + 5], [B.x1 - 5, B.z0 + 5], [B.x0 + 5, B.z1 - 5], [B.x1 - 5, B.z1 - 5], [L.spineX, B.z0 + 5], [L.spineX, B.z1 - 5], [B.x1 - 5, gz - 30], [B.x1 - 5, gz + 30]];
  for (const [x, z] of towers) {
    const tb = t(x, z);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) tb.beam(x + dx * 1.8, 0, z + dz * 1.8, x + dx * 1.3, 8, z + dz * 1.3, 0.28, 0.28, C('#5a5040'), T_ROUGH);
    for (const yy of [2.5, 5.2]) for (const [ax, az, bx, bz] of [[-1.55, -1.55, 1.55, 1.55], [1.55, -1.55, -1.55, 1.55]]) tb.beam(x + ax, yy, z + az, x + bx, yy + 2.6, z + bz, 0.1, 0.1, C('#5a5040'), T_ROUGH);
    tb.box(x, 8.05, z, 3.8, 0.22, 3.8, 0, C('#5a5040'), T_ROUGH); tb.box(x, 9.0, z, 3.4, 1.7, 3.4, 0, C('#6b6b5a'), T_PAINT);
    tb.box(x, 9.4, z, 3.5, 0.65, 3.5, 0, C('#202426'), T_GLASS); tb.box(x, 10.35, z, 4.2, 0.22, 4.2, 0, C('#4a4a40'), T_METAL);
    tb.box(x, 10.6, z + 1.9, 0.5, 0.3, 0.4, 0, C('#fff6d8'), T_NIGHTGLOW(6));
    physics.addStaticBox(x, 4, z, 1.6, 4, 1.6);
  }

  // ---- barracks (north row of three, one south), HQ
  const bar: WallSpec = { kind: 2, seed: 31, cellW: 3.2, cellH: 3.4, winW: 1.4, winH: 1.3, sill: 1.0, mat: 2, originV: 0.3, baseY: 0, lit: 0.6, floors: 2 };
  const barracks = (x: number, z: number, k: number) => {
    const fb = ctx.fac.at(x, z);
    fb.box(x, z, 38, 11, 0, 7.2, 0, C(['#b8b29e', '#a9a58f', '#bdb7a2', '#aaa690'][k % 4]), [{ ...bar, seed: 31 + k }], { ...ROOF, seed: 9 + k }, C('#5b5e55'));
    physics.addStaticBox(x, 3.6, z, 19, 3.6, 5.5);
    t(x, z).box(x, 0.12, z + 6.3, 38, 0.08, 1.6, 0, conc, T_STONE); // stoop
    t(x, z).box(x + 12, 7.5, z, 3.4, 1.0, 0.3, 0, C('#b8b09a'), T_PAINT);
  };
  for (let k = 0; k < 3; k++) barracks(B.x0 + 38, B.z0 + 22 + k * 25, k);
  barracks(B.x0 + 38, B.z1 - 22, 3);
  { // HQ
    const x = B.x0 + 38, z = gz + 18, fb = ctx.fac.at(x, z);
    fb.box(x, z, 26, 14, 0, 10.4, 0, C('#c2bba6'), [{ ...bar, seed: 55, floors: 3, cellW: 3.6 }], { ...ROOF, seed: 13 }, C('#5b5e55'));
    physics.addStaticBox(x, 5.2, z, 13, 5.2, 7);
    t(x, z).box(x, 0.4, z + 7.6, 8, 0.8, 2.4, 0, conc, T_STONE); // entrance steps
    for (const s of [-1, 1]) t(x, z).cyl(x + s * 3.2, 0, z + 8, 0.35, 0.35, 5.5, 10, C('#d8d3c4'), T_STONE);
    t(x, z).box(x, 5.8, z + 8, 9, 0.5, 2.8, 0, C('#d8d3c4'), T_STONE);
  }
  // flagpole on the parade ground
  { const fx = B.x0 + 38, fz = gz + 44, tb = t(fx, fz); tb.cyl(fx, 0.1, fz, 0.1, 0.06, 15, 8, C('#ddd'), T_METAL); tb.box(fx + 1.3, 13.4, fz, 2.4, 1.5, 0.04, 0, C('#2a4a6b'), T_PAINT); tb.box(fx + 1.3, 13.4, fz, 2.4, 0.18, 0.05, 0, C('#c9b13a'), T_PAINT); tb.sphere(fx, 15.2, fz, 0.14, C('#c9b13a'), T_METAL); }

  // ---- hangars (east side, north half) with doors facing the motor pool
  warehouse(ctx, { cx: B.x1 - 20, cz: B.z0 + 40, w: 44, d: 30, base: 0, h: 11, seed: 911, yaw: -Math.PI / 2, color: C('#6b7158') });
  warehouse(ctx, { cx: B.x1 - 20, cz: B.z0 + 82, w: 44, d: 30, base: 0, h: 11, seed: 912, yaw: -Math.PI / 2, color: C('#646b52') });
  physics.addStaticBox(B.x1 - 20, 5.5, B.z0 + 40, 15, 5.5, 22); physics.addStaticBox(B.x1 - 20, 5.5, B.z0 + 82, 15, 5.5, 22);

  // ---- motor pool: open vehicle shed, fuel tanks, jerry-can stack
  { const sx = B.x0 + 80, sz = B.z0 + 34, tb = t(sx, sz);
    for (let k = 0; k <= 4; k++) for (const dx of [-5.5, 5.5]) tb.box(sx + dx, 2.2, sz - 20 + k * 10, 0.3, 4.4, 0.3, 0, C('#55584c'), T_METAL);
    tb.box(sx, 4.5, sz, 12.5, 0.3, 42, 0, C('#6a6f5c'), T_METAL, 0, 0.04);
  }
  for (let k = 0; k < 3; k++) { const fx = B.x0 + 78 + k * 7, fz = B.z0 + 83, tb = t(fx, fz); tb.cyl(fx, 0, fz, 2.2, 2.2, 5.2, 14, C('#7d806d'), T_METAL); tb.cyl(fx, 5.2, fz, 1.9, 0.6, 1.1, 14, C('#7d806d'), T_METAL); physics.addStaticCylinder(fx, 2.6, fz, 2.6, 2.2); }
  for (let k = 0; k < 8; k++) t(B.x0 + 76, B.z0 + 96).box(B.x0 + 74 + (k % 4) * 0.7, 0.35 + Math.floor(k / 4) * 0.7, B.z0 + 96 + (k % 2) * 0.3, 0.55, 0.7, 0.3, 0.1 * k, C('#5b6644'), T_METAL);

  // ---- water tower and generator hut
  { const wx = B.x0 + 12, wz = gz + 34, tb = t(wx, wz);
    for (const [dx, dz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) tb.beam(wx + dx * 1.2, 0, wz + dz * 1.2, wx + dx, 14, wz + dz, 0.35, 0.35, C('#6a6e63'), T_METAL);
    for (const yy of [4.5, 9]) for (const [ax, az, bx, bz] of [[-2.4, -2.4, 2, 2], [2.4, -2.4, -2, 2]]) tb.beam(wx + ax, yy, wz + az, wx + bx, yy + 4.5, wz + bz, 0.12, 0.12, C('#6a6e63'), T_METAL);
    tb.cyl(wx, 14, wz, 3.2, 3.2, 4.4, 20, C('#8d958f'), T_METAL); tb.cyl(wx, 18.4, wz, 3.2, 0.6, 1.4, 20, C('#8d958f'), T_METAL);
    tb.box(wx, 15.5, wz + 3.25, 3.0, 0.7, 0.05, 0, C('#2b3a30'), T_PAINT);
    physics.addStaticBox(wx, 7, wz, 2.6, 7, 2.6); }
  { const hx = B.x0 + 14, hz = B.z1 - 14, tb = t(hx, hz); tb.box(hx, 1.6, hz, 6, 3.2, 4, 0, C('#6a6f5c'), T_METAL); tb.box(hx + 1.8, 3.5, hz, 1.1, 1.0, 1.1, 0, C('#3a3c3a'), T_METAL); physics.addStaticBox(hx, 1.6, hz, 3, 1.6, 2); }

  // ---- helipad apron: pads with markings, wind sock, floodlights, sandbag revetments
  L.pads.forEach((p, k) => helipadPad(t(p.x, p.z), physics, p.x, 0.1, p.z, `Fort Calder helipad ${k + 1}`, helipads, 9));
  for (const p of L.pads) for (const s of [-1, 1]) t(p.x, p.z).box(p.x + s * 11, 0.13, p.z, 0.25, 0.03, 14, 0, line, T_PAINT); // taxi lines
  { const sx = apronX + 28, sz = apronZ - 28, tb = t(sx, sz); tb.cyl(sx, 0.1, sz, 0.07, 0.05, 7, 8, C('#cfcfcf'), T_METAL); tb.cyl(sx + 0.6, 6.6, sz, 0.4, 0.1, 1.5, 8, C('#ff7a1a'), T_PAINT, 0, 0, Math.PI / 2 - 0.2); }
  for (const [fx, fz] of [[apronX - 28, apronZ - 30], [apronX + 28, apronZ + 30], [apronX - 28, apronZ + 30]]) { const tb = t(fx, fz); tb.cyl(fx, 0.1, fz, 0.12, 0.08, 9, 8, C('#6d6f70'), T_METAL); tb.box(fx, 9.2, fz, 1.2, 0.2, 0.6, 0, C('#fff6d8'), T_NIGHTGLOW(7)); }
  bag(apronX - 29, apronZ + 3, 8, Math.PI / 2, 1.1);
  bag(L.spineX + 6, B.z0 + 18, 5, 0, 1.1);
  // spine-side lamp posts
  for (let z = B.z0 + 24; z < B.z1 - 12; z += 26) { const tb = t(L.spineX, z); tb.cyl(L.spineX + 5, 0.1, z, 0.08, 0.06, 7.5, 8, C('#6d6f70'), T_METAL); tb.box(L.spineX + 4.3, 7.6, z, 1.4, 0.15, 0.4, 0, C('#fff6d8'), T_NIGHTGLOW(6)); }
}
