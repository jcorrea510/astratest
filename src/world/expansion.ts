/**
 * Meshes and colliders for everything outside the street grid: the elevated Harbor Freeway with its ramps,
 * the steel arch bridge over the Cannery Channel, Vista Drive winding up to the hilltop lookout (with houses),
 * Airfield Road, the airfield (runway, apron, hangars, tower, helipads) and Fort Calder (fenced army compound).
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { RAPIER, groups, G_STATIC, ALL, type Physics } from '../core/physics';
import { type CityMap, type P3, pathHeightAt, groundRoadAt, CHANNEL, EAST_RIVER, AIRFIELD, LOOKOUT, CUL_DE_SAC_R, FREEWAY_Z, DECK_Y, LANE_WIDTH } from './citymap';
import { Chunked, FacadeBuilder, TrimBuilder, SOLID, ROOF, type WallSpec, T_METAL, T_STONE, T_PAINT, T_NIGHTGLOW, T_GLOW } from './builders';
import { type BuildCtx, type Helipad, house, warehouse } from './buildings';
import type { ChunkInstancer } from './geometry';
import { LAMP } from './props';
import { buildArmyBase } from './armybase';
import type { Pad } from './terrain';

const C = (h: string) => new THREE.Color(h);

/** Houses along Vista Drive (positions are needed before the terrain is shaped, for their pads). */
export function vistaHouses(city: CityMap): { x: number; z: number; y: number; yaw: number; seed: number }[] {
  const p = city.paths.find(pp => pp.kind === 'hill'); if (!p) return [];
  const out: { x: number; z: number; y: number; yaw: number; seed: number }[] = [];
  let acc = 0, side = 1;
  for (let i = 1; i < p.pts.length - 4; i++) {
    const a = p.pts[i - 1], b = p.pts[i]; acc += Math.hypot(b.x - a.x, b.z - a.z);
    if (b.z > -560 || acc < 38) continue; acc = 0; side = -side;
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl * side, nz = tx / tl * side;
    const x = b.x + nx * (p.half + 15), z = b.z + nz * (p.half + 15);
    // keep clear of other parts of the winding road
    if (pathHeightAt(p, x, z).d < p.half + 11) continue;
    out.push({ x, z, y: b.y, yaw: Math.atan2(-nx, -nz), seed: Math.round(x * 31 + z * 7) });
  }
  return out;
}
/** Flat spots at the lookout for its helipad and radio mast. */
export function lookoutSpots(city: CityMap) {
  const y = city.paths.find(p => p.kind === 'hill')!.pts.slice(-1)[0].y;
  const cx = LOOKOUT.x, cz = LOOKOUT.z - 8;
  return { y, cx, cz, pad: { x: cx + 32, z: cz - 6 }, mast: { x: cx - 28, z: cz - 22 } };
}
export function expansionPads(city: CityMap): Pad[] {
  const L = lookoutSpots(city);
  return [...vistaHouses(city).map(h => ({ x: h.x, z: h.z, r: 10, y: h.y })), { x: L.pad.x, z: L.pad.z, r: 13, y: L.y - 0.05 }, { x: L.mast.x, z: L.mast.z, r: 4, y: L.y - 0.05 }];
}

function orientedBox(physics: Physics, a: P3, b: P3, halfW: number, thick: number, yOff: number, latOff = 0) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < 0.01) return;
  const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, len);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const lx = Math.cos(yaw) * latOff, lz = -Math.sin(yaw) * latOff;
  const desc = RAPIER.ColliderDesc.cuboid(halfW, thick / 2, Math.hypot(len, dy) / 2 + 0.08)
    .setTranslation((a.x + b.x) / 2 + lx, (a.y + b.y) / 2 + yOff, (a.z + b.z) / 2 + lz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setFriction(0.9).setCollisionGroups(groups(G_STATIC, ALL));
  physics.tag(physics.world.createCollider(desc), { kind: 'static' });
}

export interface Ribbon { pos: number[]; nor: number[]; uv: number[]; col: number[] }
export function ribbon(r: Ribbon, pts0: P3[], o0: number, o1: number, lift: number, color: THREE.Color, dash = 0, gap = 0) {
  // subdivide long straight segments so dashes and lighting follow
  const pts: P3[] = [pts0[0]];
  for (let i = 1; i < pts0.length; i++) { const a = pts0[i - 1], b = pts0[i]; const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (dash > 0 ? Math.min(dash, 10) : 25))); for (let k = 1; k <= n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, z: a.z + (b.z - a.z) * k / n }); }
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
    const s0 = s; s += tl;
    if (dash > 0 && ((s0 + s) / 2) % (dash + gap) > dash) continue;
    const P = (p: P3, o: number) => [p.x + nx * o, p.y + lift, p.z + nz * o];
    const A = P(a, o0), B = P(a, o1), Cc = P(b, o1), D = P(b, o0);
    const quad = [A, B, Cc, A, Cc, D];
    const uvs = [[o0 / 12, s0 / 12], [o1 / 12, s0 / 12], [o1 / 12, s / 12], [o0 / 12, s0 / 12], [o1 / 12, s / 12], [o0 / 12, s / 12]];
    for (let k = 0; k < 6; k++) { r.pos.push(...quad[k]); r.nor.push(0, 1, 0); r.uv.push(uvs[k][0], uvs[k][1]); r.col.push(color.r, color.g, color.b); }
  }
}
export function ribbonGeo(r: Ribbon) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(r.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(r.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(r.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(r.col, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

export interface ExpansionOut { lampHeads: THREE.Vector3[]; helipads: Helipad[] }

export function buildExpansion(
  root: THREE.Object3D, physics: Physics, city: CityMap, ctx: BuildCtx, props: ChunkInstancer,
  asphaltMat: THREE.Material, markMat: THREE.Material, ground: (x: number, z: number) => number,
): ExpansionOut {
  const lampHeads: THREE.Vector3[] = [];
  const helipads: Helipad[] = [];
  const trim = ctx.trim;
  const road: Ribbon = { pos: [], nor: [], uv: [], col: [] }, mk: Ribbon = { pos: [], nor: [], uv: [], col: [] };
  const white = C('#e4e1d6'), yellow = C('#e2b043'), conc = C('#a7a39b'), concDark = C('#8f8b84');
  const groundAt = (x: number, z: number) => ((x > CHANNEL.x0 && x < CHANNEL.x1 && z > -700) || (x > EAST_RIVER.x0 + 1 && x < EAST_RIVER.x1 - 1 && z > EAST_RIVER.z0)) ? -7 : ground(x, z);

  for (const p of city.paths) {
    const lift = p.elevated ? 0.0 : 0.03;
    ribbon(road, p.pts, -p.half, p.half, lift, C('#ffffff'));
    // markings
    const ml = lift + 0.012;
    if (p.lanes === 2) {
      ribbon(mk, p.pts, -0.22, -0.1, ml, yellow); ribbon(mk, p.pts, 0.1, 0.22, ml, yellow);
      for (const sg of [-1, 1]) ribbon(mk, p.pts, sg * (LANE_WIDTH + 0.2) - 0.07, sg * (LANE_WIDTH + 0.2) + 0.07, ml, white, 3.5, 6);
    } else ribbon(mk, p.pts, -0.07, 0.07, ml, yellow, 3, 3);
    for (const sg of [-1, 1]) ribbon(mk, p.pts, sg * (p.half - 0.55) - 0.07, sg * (p.half - 0.55) + 0.07, ml, white);
    // structure + colliders for elevated parts
    let since = 0, lampSince = 20;
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1], b = p.pts[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const tb = trim.at((a.x + b.x) / 2, (a.z + b.z) / 2);
      const tx = (b.x - a.x) / (segLen || 1), tz = (b.z - a.z) / (segLen || 1), nx = -tz, nz = tx;
      if (p.elevated && Math.max(a.y, b.y) > 0.25) {
        const top = Math.min(a.y, b.y);
        if (top > 2.4) tb.beam(a.x, a.y - 0.69, a.z, b.x, b.y - 0.69, b.z, p.half * 2 + 1.2, 1.3, conc, T_STONE); // top 4 cm under the road surface (no z-fighting)
        else tb.beam(a.x, (a.y - 0.2) / 2 - 0.1, a.z, b.x, (b.y - 0.2) / 2 - 0.1, b.z, p.half * 2 + 1.2, Math.max(0.3, (a.y + b.y) / 2 + 0.1), concDark, T_STONE);
        orientedBox(physics, a, b, p.half + 0.6, 0.6, -0.3);
        for (const sg of [-1, 1]) {
          tb.beam(a.x + nx * sg * (p.half + 0.35), a.y + 0.45, a.z + nz * sg * (p.half + 0.35), b.x + nx * sg * (p.half + 0.35), b.y + 0.45, b.z + nz * sg * (p.half + 0.35), 0.4, 0.9, C('#c4c0b8'), T_STONE);
          orientedBox(physics, a, b, 0.22, 1.0, 0.5, sg * (p.half + 0.35));
        }
        if (p.lanes === 2) {
          tb.beam(a.x, a.y + 0.4, a.z, b.x, b.y + 0.4, b.z, 0.5, 0.8, C('#c4c0b8'), T_STONE);
          orientedBox(physics, a, b, 0.32, 0.9, 0.45, 0);
        }
        since += segLen;
        if (since > 28 && top > 3) {
          const gy = groundAt(b.x, b.z);
          const h = b.y - 1.3 - gy;
          // Round 8: never stand a pillar in a street under the freeway (try the next segment instead)
          const clear = (p.lanes === 2 ? [-1, 1] : [0]).every(sg => !groundRoadAt(city, b.x + nx * sg * 4.5, b.z + nz * sg * 4.5, gy, 1.2));
          if (clear) since = 0;
          if (h > 1 && clear) { for (const sg of (p.lanes === 2 ? [-1, 1] : [0])) tb.cyl(b.x + nx * sg * 4.5, gy, b.z + nz * sg * 4.5, 0.85, 0.85, h, 14, conc, T_STONE); tb.beam(b.x - nx * (p.half + 0.4), b.y - 1.65, b.z - nz * (p.half + 0.4), b.x + nx * (p.half + 0.4), b.y - 1.65, b.z + nz * (p.half + 0.4), 1.6, 0.9, conc, T_STONE); for (const sg of (p.lanes === 2 ? [-1, 1] : [0])) physics.addStaticCylinder(b.x + nx * sg * 4.5, gy + h / 2, b.z + nz * sg * 4.5, h / 2, 0.85); }
        }
      }
      // lights
      lampSince += segLen;
      // Round 7: no lamp right at a path's end: there the side offset lands in the cross street of the junction
      const end = p.pts[p.pts.length - 1], nearEnd = !p.elevated && Math.hypot(b.x - end.x, b.z - end.z) < 14;
      if (lampSince > (p.kind === 'freeway' ? 45 : 36) && !nearEnd) {
        lampSince = 0;
        const sg = p.kind === 'freeway' ? ((i % 2) ? 1 : -1) : 1;
        const off = p.half + (p.elevated ? 0.35 : 1.2);
        const x = b.x + nx * sg * off, z = b.z + nz * sg * off, y = b.y + (p.elevated ? 0.9 : 0);
        const yaw = Math.atan2(-nx * sg, -nz * sg);
        props.add('streetlight', x, y, z, yaw);
        lampHeads.push(new THREE.Vector3(x - nx * sg * LAMP.reach, y + LAMP.height - 0.1, z - nz * sg * LAMP.reach));
        if (!p.elevated) physics.addStaticCylinder(x, y + 2.5, z, 2.5, 0.14);
      }
    }
  }
  // junction decks / cul-de-sacs
  for (const j of city.intersections) {
    if (j.ix >= 0) continue;
    const touching = city.paths.filter(p => p.from === j.id || p.to === j.id);
    const p0 = touching[0]; const y = p0.to === j.id ? p0.pts[p0.pts.length - 1].y : p0.pts[0].y;
    if (touching.length === 1) {
      // cul-de-sac: paved circle beyond the road end
      const far = p0.to === j.id ? p0.pts[p0.pts.length - 2] : p0.pts[1];
      const dx = j.x - far.x, dz = j.z - far.z, dl = Math.hypot(dx, dz) || 1;
      const cx = j.x + dx / dl * 8, cz = j.z + dz / dl * 8;
      const seg = 28; const pts: P3[] = [];
      for (let k = 0; k <= seg; k++) pts.push({ x: cx, y, z: cz });
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2, R = CUL_DE_SAC_R - 6;
        const P = [[cx, y + 0.03, cz], [cx + Math.cos(a1) * R, y + 0.03, cz + Math.sin(a1) * R], [cx + Math.cos(a0) * R, y + 0.03, cz + Math.sin(a0) * R]];
        for (const v of P) { road.pos.push(...v); road.nor.push(0, 1, 0); road.uv.push(v[0] / 12, v[2] / 12); road.col.push(1, 1, 1); }
      }
      void pts;
    } else {
      const tb = trim.at(j.x, j.z); const s = j.halfX * 2 + 1.2;
      const yy = p0.elevated ? y : y + 0.03; road.pos.push(j.x - j.halfX, yy, j.z + j.halfZ, j.x + j.halfX, yy, j.z + j.halfZ, j.x + j.halfX, yy, j.z - j.halfZ, j.x - j.halfX, yy, j.z + j.halfZ, j.x + j.halfX, yy, j.z - j.halfZ, j.x - j.halfX, yy, j.z - j.halfZ);
      for (let k = 0; k < 6; k++) { road.nor.push(0, 1, 0); road.col.push(1, 1, 1); }
      road.uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      if (y > 1) { tb.box(j.x, y - 0.65, j.z, s, 1.3, s, 0, conc, T_STONE); physics.addStaticBox(j.x, y - 0.3, j.z, s / 2, 0.3, s / 2); }
    }
  }
  const roadMesh = new THREE.Mesh(ribbonGeo(road), asphaltMat); roadMesh.receiveShadow = true; root.add(roadMesh);
  { const am = roadMesh.material as THREE.MeshStandardMaterial; am.polygonOffset = true; am.polygonOffsetFactor = -1; am.polygonOffsetUnits = -1; }
  const marks = new THREE.Mesh(ribbonGeo(mk), markMat); marks.receiveShadow = true; root.add(marks);

  // ---------- Cannery Channel arch bridge (steel ribs and hangers over the freeway deck) ----------
  {
    const tb = trim.at((CHANNEL.x0 + CHANNEL.x1) / 2, FREEWAY_Z);
    const steel = C('#7a2e24'), x0 = CHANNEL.x0 - 14, x1 = CHANNEL.x1 + 14, rise = 16, half = 9.6;
    for (const sg of [-1, 1]) {
      const z = FREEWAY_Z + sg * half; let px = x0, py = DECK_Y;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, x = x0 + (x1 - x0) * t, y = DECK_Y + Math.sin(t * Math.PI) * rise;
        tb.beam(px, py, z, x, y, z, 0.9, 1.1, steel, T_PAINT);
        if (k < 16) tb.beam(x, y, z, x, DECK_Y + 0.9, z, 0.12, 0.12, C('#3a3a3a'), T_METAL);
        px = x; py = y;
      }
    }
    for (let k = 2; k < 15; k += 2) { const t = k / 16, x = x0 + (x1 - x0) * t, y = DECK_Y + Math.sin(t * Math.PI) * rise; tb.beam(x, y, FREEWAY_Z - half, x, y, FREEWAY_Z + half, 0.5, 0.5, steel, T_PAINT); }
    for (const x of [x0, x1]) for (const sg of [-1, 1]) tb.box(x, DECK_Y - 4, FREEWAY_Z + sg * half, 3, 22, 3, 0, conc, T_STONE);
    tb.sphere((x0 + x1) / 2, DECK_Y + rise + 0.7, FREEWAY_Z, 0.3, C('#ff3020'), T_GLOW(3));
  }
  // ---------- Overhead freeway sign gantries ----------
  {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d')!;
    const sign = (x: number, top: string, bottom: string, arrow: string) => {
      g.fillStyle = '#0d5c35'; g.fillRect(x + 6, 6, 500, 244); g.strokeStyle = '#f2f2f2'; g.lineWidth = 6; g.strokeRect(x + 14, 14, 484, 228);
      g.fillStyle = '#f2f2f2'; g.font = '700 54px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.fillText(top, x + 256, 95, 460);
      g.font = '600 40px "Arial Narrow", Arial, sans-serif'; g.fillText(bottom, x + 256, 160, 460); g.font = '700 54px Arial'; g.fillText(arrow, x + 256, 225);
    };
    sign(0, 'Tidewell Ave', 'EXIT  ·  Hillside', '↘'); sign(512, 'Airfield', 'Fort Calder  ·  East', '↑');
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, emissiveMap: t, emissive: new THREE.Color(0.25, 0.25, 0.25) });
    for (const [x, u] of [[140, 0], [-300, 0], [380, 0.5]] as const) {
      const tb = trim.at(x, FREEWAY_Z);
      for (const sg of [-1, 1]) tb.box(x, DECK_Y + 4, FREEWAY_Z + sg * 9.3, 0.4, 8, 0.4, 0, C('#8a8f93'), T_METAL);
      tb.box(x, DECK_Y + 7.6, FREEWAY_Z, 0.5, 0.5, 19, 0, C('#8a8f93'), T_METAL);
      const geo = new THREE.PlaneGeometry(6.4, 3.2); const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, u + uv.getX(k) * 0.5);
      for (const [face, zo] of [[-Math.PI / 2, 4.5]] as const) { const mesh = new THREE.Mesh(geo, m); mesh.rotation.y = face; mesh.position.set(x - 0.3, DECK_Y + 6.1, FREEWAY_Z + zo); root.add(mesh); }
    }
  }
  // ---------- Vista Drive houses and the lookout ----------
  for (const h of vistaHouses(city)) house(ctx, { cx: h.x, cz: h.z, yaw: h.yaw, w: 9.5, d: 8, base: h.y, seed: h.seed, lotW: 16, lotD: 14 });
  {
    const tb = trim.at(LOOKOUT.x, LOOKOUT.z - 8);
    const y = city.paths.find(p => p.kind === 'hill')!.pts.slice(-1)[0].y;
    const cx = LOOKOUT.x, cz = LOOKOUT.z - 8;
    // railing on the far side of the turning circle, telescope, radio mast, helipad
    for (let k = 0; k <= 18; k++) {
      const a = Math.PI + (k / 18) * Math.PI;
      const x = cx + Math.cos(a) * (CUL_DE_SAC_R - 4), z = cz + Math.sin(a) * (CUL_DE_SAC_R - 4);
      tb.box(x, y + 0.5, z, 0.12, 1.0, 0.12, 0, C('#3a3d40'), T_METAL);
      if (k > 0) {
        const a0 = Math.PI + ((k - 1) / 18) * Math.PI;
        const x0 = cx + Math.cos(a0) * (CUL_DE_SAC_R - 4), z0 = cz + Math.sin(a0) * (CUL_DE_SAC_R - 4);
        tb.beam(x0, y + 1.0, z0, x, y + 1.0, z, 0.08, 0.08, C('#3a3d40'), T_METAL);
        orientedBox(physics, { x: x0, y, z: z0 }, { x, y, z }, 0.18, 1.1, 0.55, 0);
      }
    }
    tb.cyl(cx + 6, y, cz - 10, 0.08, 0.08, 1.1, 6, C('#333'), T_METAL); tb.cyl(cx + 6, y + 1.1, cz - 10, 0.12, 0.08, 0.6, 8, C('#b8a060'), [0.3, 0.8, 0, 0], 0, 1.2);
    const L = lookoutSpots(city);
    const mx = L.mast.x, mz = L.mast.z, my = L.y - 0.05;
    tb.cyl(mx, my, mz, 0.6, 0.15, 48, 6, C('#c84030'), T_PAINT);
    for (const hy of [16, 32, 47.5]) tb.sphere(mx, my + hy, mz, 0.3, C('#ff2a1a'), T_GLOW(4));
    const hx = L.pad.x, hz = L.pad.z, hy = L.y - 0.02;
    helipadPad(tb, physics, hx, hy, hz, 'Vista Lookout helipad', helipads);
  }
  // ---------- Airfield ----------
  {
    const A = AIRFIELD;
    const tb = (x: number, z: number) => trim.at(x, z);
    const rwW = 45, rz0 = A.z0 + 20, rz1 = A.z1 - 10, rcz = (rz0 + rz1) / 2;
    const strip: Ribbon = { pos: [], nor: [], uv: [], col: [] };
    ribbon(strip, [{ x: A.runwayX, y: 0, z: rz1 }, { x: A.runwayX, y: 0, z: rz0 }], -rwW / 2, rwW / 2, 0.04, C('#9a9894'));
    ribbon(strip, [{ x: A.apronX + 20, y: 0, z: rcz }, { x: A.runwayX - rwW / 2, y: 0, z: rcz }], -12, 12, 0.035, C('#a09e98'));
    ribbon(strip, [{ x: A.apronX, y: 0, z: A.z1 - 20 }, { x: A.apronX, y: 0, z: A.z0 + 80 }], -40, 40, 0.03, C('#b5b2aa'));
    ribbon(strip, [{ x: 764, y: 0, z: A.gateZ }, { x: A.apronX - 38, y: 0, z: A.gateZ }], -6, 6, 0.03, C('#ffffff'));
    root.add(Object.assign(new THREE.Mesh(ribbonGeo(strip), asphaltMat), { receiveShadow: true }));
    const am: Ribbon = { pos: [], nor: [], uv: [], col: [] };
    ribbon(am, [{ x: A.runwayX, y: 0, z: rz1 - 60 }, { x: A.runwayX, y: 0, z: rz0 + 60 }], -0.45, 0.45, 0.05, white, 30, 20);
    for (const sg of [-1, 1]) ribbon(am, [{ x: A.runwayX, y: 0, z: rz1 }, { x: A.runwayX, y: 0, z: rz0 }], sg * (rwW / 2 - 1.2) - 0.4, sg * (rwW / 2 - 1.2) + 0.4, 0.05, white);
    for (const zEnd of [rz0 + 8, rz1 - 38]) for (let k = -7; k <= 7; k++) if (k !== 0) ribbon(am, [{ x: A.runwayX + k * 2.6, y: 0, z: zEnd + 30 }, { x: A.runwayX + k * 2.6, y: 0, z: zEnd }], -0.7, 0.7, 0.05, white);
    ribbon(am, [{ x: A.apronX + 20, y: 0, z: rcz }, { x: A.runwayX - rwW / 2, y: 0, z: rcz }], -0.15, 0.15, 0.05, yellow);
    root.add(Object.assign(new THREE.Mesh(ribbonGeo(am), markMat), { receiveShadow: true }));
    for (let z = rz0; z <= rz1; z += 30) for (const sg of [-1, 1]) tb(A.runwayX, z).sphere(A.runwayX + sg * (rwW / 2 + 1.5), 0.25, z, 0.18, C('#fff4d0'), T_NIGHTGLOW(5));
    for (const z of [rz0 - 4, rz1 + 4]) for (let k = -6; k <= 6; k++) tb(A.runwayX, z).sphere(A.runwayX + k * 3.4, 0.25, z, 0.18, C(z < rcz ? '#ff3a2a' : '#3aff6a'), T_NIGHTGLOW(5));
    // hangars along the apron (doors face the apron)
    for (let k = 0; k < 2; k++) warehouse(ctx, { cx: A.apronX - 30 + k * 52, cz: A.z0 + 52, w: 46, d: 36, base: 0, h: 14, seed: 700 + k, yaw: 0, color: C(['#8d969c', '#7f8a80'][k]) });
    // control tower
    const tx = A.x0 + 18, tz = A.z1 - 30, fb = ctx.fac.at(tx, tz), t2 = tb(tx, tz);
    fb.box(tx, tz, 9, 9, 0, 22, 0, C('#cfcac0'), [{ kind: 2, seed: 77, cellW: 3, cellH: 3.6, winW: 1.2, winH: 1.4, sill: 1, mat: 2, originV: 0, baseY: 0, lit: 0.5, floors: 6 } as WallSpec], { ...ROOF, seed: 5 });
    fb.box(tx, tz, 13, 13, 22, 26.5, 0, C('#5d7f8f'), [{ kind: 1, seed: 78, cellW: 2.2, cellH: 4.5, winW: 0, winH: 0, sill: 0, mat: 7, originV: 0, baseY: 22, lit: 0.9, floors: 1 } as WallSpec], null);
    t2.box(tx, 27, tz, 14, 1, 14, 0, C('#4a4d50'), T_METAL); t2.cyl(tx, 27.5, tz, 0.15, 0.08, 7, 6, C('#ccc'), T_METAL); t2.sphere(tx, 34.6, tz, 0.3, C('#ffd060'), T_GLOW(4));
    physics.addStaticBox(tx, 13.5, tz, 6.5, 13.5, 6.5);
    // windsock
    t2.cyl(A.runwayX + 40, 0, rcz, 0.08, 0.06, 7, 6, C('#ddd'), T_METAL); t2.cyl(A.runwayX + 40, 6.6, rcz + 0.1, 0.45, 0.2, 3, 10, C('#ff6a1a'), T_PAINT, 0, Math.PI / 2 - 0.25);
    for (let k = 0; k < 3; k++) helipadPad(tb(A.apronX, -320 - k * 40), physics, A.apronX - 15, 0, -320 - k * 40, `Airfield helipad ${k + 1}`, helipads);
    perimeterFence(trim, physics, A.x0, A.z0, A.x1, A.z1, [{ side: 'w', at: A.gateZ, w: 16 }]);
  }
  // ---------- Fort Calder (army base): see armybase.ts ----------
  buildArmyBase(ctx, trim, physics, helipads);
  return { lampHeads, helipads };
}

/** Ground or rooftop helipad: concrete disc, H marking, ring of edge lights. */
export function helipadPad(tb: TrimBuilder, physics: Physics, x: number, y: number, z: number, name: string, out: Helipad[], R = 11) {
  const k = R / 11;
  tb.cyl(x, y, z, R, R, 0.12, 28, C('#7d7b76'), T_STONE);
  tb.cyl(x, y + 0.122, z, 8.6 * k, 8.6 * k, 0.01, 28, C('#e8b830'), T_PAINT); tb.cyl(x, y + 0.13, z, 8.1 * k, 8.1 * k, 0.01, 28, C('#6f6d68'), T_STONE);
  const hy = y + 0.15;
  for (const sx of [-1.6, 1.6]) tb.box(x + sx * k, hy, z, 0.8 * k, 0.02, 5.4 * k, 0, C('#f2f2f2'), T_PAINT);
  tb.box(x, hy, z, 3.2 * k, 0.02, 0.8 * k, 0, C('#f2f2f2'), T_PAINT);
  for (let a = 0; a < 16; a++) tb.sphere(x + Math.cos(a / 16 * 6.283) * (R - 0.6), y + 0.2, z + Math.sin(a / 16 * 6.283) * (R - 0.6), 0.12, C('#60d0ff'), T_NIGHTGLOW(5));
  physics.addStaticCylinder(x, y + 0.06 - 0.2, z, 0.26, R);
  out.push({ x, y: y + 0.12, z, name });
}

/** Chain-link fence with concrete posts (and razor wire on top for the army compound), with gaps for gates. */
export function perimeterFence(trim: Chunked<TrimBuilder>, physics: Physics, x0: number, z0: number, x1: number, z1: number, gates: { side: 'n' | 's' | 'e' | 'w'; at: number; w: number }[], razor = false) {
  const sides: { side: 'n' | 's' | 'e' | 'w'; ax: number; az: number; bx: number; bz: number }[] = [
    { side: 'n', ax: x0, az: z0, bx: x1, bz: z0 }, { side: 's', ax: x0, az: z1, bx: x1, bz: z1 }, { side: 'w', ax: x0, az: z0, bx: x0, bz: z1 }, { side: 'e', ax: x1, az: z0, bx: x1, bz: z1 },
  ];
  const mesh = C('#8f9598'), post = C('#6d6f70');
  for (const s of sides) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az), n = Math.ceil(len / 3);
    const runs: [number, number][] = []; let cur = 0;
    for (const g of gates.filter(gg => gg.side === s.side)) { const gp = (s.side === 'n' || s.side === 's') ? g.at - s.ax : g.at - s.az; runs.push([cur, gp - g.w / 2]); cur = gp + g.w / 2; }
    runs.push([cur, len]);
    for (const [r0, r1] of runs) {
      if (r1 - r0 < 0.5) continue;
      const P = (d: number) => ({ x: s.ax + (s.bx - s.ax) * d / len, z: s.az + (s.bz - s.az) * d / len });
      const a = P(r0), b = P(r1), tb = trim.at((a.x + b.x) / 2, (a.z + b.z) / 2);
      tb.beam(a.x, 1.25, a.z, b.x, 1.25, b.z, 0.03, 2.3, mesh, [0.6, 0.6, 2, 0]);
      tb.beam(a.x, 2.45, a.z, b.x, 2.45, b.z, 0.05, 0.05, post, T_METAL);
      if (razor) for (const o of [0, 0.25]) tb.beam(a.x, 2.75 + o, a.z, b.x, 2.75 + o, b.z, 0.12, 0.12, C('#9aa0a3'), T_METAL);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      physics.addStaticBox((a.x + b.x) / 2, 1.5, (a.z + b.z) / 2, 0.1, 1.5, (r1 - r0) / 2, yaw);
    }
    for (let k = 0; k <= n; k++) { const d = (k / n) * len; if (gates.some(g => g.side === s.side && Math.abs(((s.side === 'n' || s.side === 's') ? g.at - s.ax : g.at - s.az) - d) < g.w / 2)) continue; const x = s.ax + (s.bx - s.ax) * d / len, z = s.az + (s.bz - s.az) * d / len; trim.at(x, z).box(x, 1.4, z, 0.12, 2.8 + (razor ? 0.4 : 0), 0.12, 0, post, T_METAL); }
  }
}
void SOLID; void FacadeBuilder; void Rng;
