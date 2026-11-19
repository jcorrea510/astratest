/** The Flatiron: a wedge-shaped tower on the sharp tip of a Broadway triangle block (3 facade walls, cornices, a convex collider). */
import * as THREE from 'three';
import { RAPIER, groups, G_STATIC, ALL } from '../core/physics';
import { ROOF, SOLID, T_STONE, type WallSpec } from './builders';
import type { BuildCtx } from './buildings';
import { CURB_HEIGHT } from './citymap';
import { flatironFootprint } from './broadway';

export function buildFlatiron(ctx: BuildCtx) {
  const f = flatironFootprint();
  let pts = [f.apex, f.a, f.b];
  const cx = (pts[0].x + pts[1].x + pts[2].x) / 3, cz = (pts[0].z + pts[1].z + pts[2].z) / 3;
  // order so each edge's left normal (-ez, ex) points away from the centroid (facades face outward)
  const e = { x: pts[1].x - pts[0].x, z: pts[1].z - pts[0].z };
  const mx = (pts[0].x + pts[1].x) / 2 - cx, mz = (pts[0].z + pts[1].z) / 2 - cz;
  if ((-e.z) * mx + e.x * mz < 0) pts = [pts[0], pts[2], pts[1]];
  const base = CURB_HEIGHT, groundH = 5, floorH = 3.4, floors = Math.round((f.height - groundH) / floorH), top = base + groundH + floors * floorH;
  const fb = ctx.fac.at(cx, cz), tb = ctx.trim.at(cx, cz);
  const stone = new THREE.Color('#c8bda6'), trimC = new THREE.Color('#e4dccb');
  const seed = 1902;
  const ground: WallSpec = { kind: 2, seed: seed % 9973, cellW: 3.2, cellH: groundH, winW: 1.8, winH: groundH - 1.6, sill: 0.9, mat: 3, originV: 0, baseY: base, lit: 0.6, floors: 1 };
  const upper: WallSpec = { kind: 2, seed: (seed + 3) % 9973, cellW: 2.6, cellH: floorH, winW: 1.2, winH: 1.9, sill: 0.85, mat: 3, originV: groundH, baseY: base, lit: 0.45, floors };
  for (let i = 0; i < 3; i++) {
    const a = pts[i], b = pts[(i + 1) % 3];
    fb.wall(a.x, a.z, b.x, b.z, base, base + groundH, stone, ground);
    fb.wall(a.x, a.z, b.x, b.z, base + groundH, top, stone, upper);
    const len = Math.hypot(b.x - a.x, b.z - a.z), yaw = -Math.atan2(b.z - a.z, b.x - a.x), mxx = (a.x + b.x) / 2, mzz = (a.z + b.z) / 2;
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    tb.box(mxx + nx * 0.25, top - 0.4, mzz + nz * 0.25, len, 0.6, 0.6, yaw, trimC, T_STONE);
    tb.box(mxx + nx * 0.2, base + groundH + 0.1, mzz + nz * 0.2, len, 0.25, 0.5, yaw, trimC, T_STONE);
    tb.box(mxx + nx * 0.1, top + 0.45, mzz + nz * 0.1, len, 0.9, 0.3, yaw, trimC, T_STONE);
  }
  // roof (a triangle drawn as a degenerate quad)
  const V = (p: { x: number; z: number }) => new THREE.Vector3(p.x, top, p.z);
  const r = [V(pts[0]), V(pts[1]), V(pts[2]), V(pts[2])];
  const n = new THREE.Vector3().subVectors(r[1], r[0]).cross(new THREE.Vector3().subVectors(r[3], r[0]));
  const roof = { ...ROOF, seed: 77 };
  const uv = [0, 0, 1, 0, 1, 1, 0, 1];
  if (n.y >= 0) fb.quad(r[0], r[1], r[2], r[3], uv, new THREE.Color('#5f5c58'), roof); else fb.quad(r[0], r[2], r[1], r[1], uv, new THREE.Color('#5f5c58'), roof);
  void SOLID;
  const verts = new Float32Array(pts.flatMap(p => [p.x, 0, p.z, p.x, top, p.z]));
  const desc = RAPIER.ColliderDesc.convexHull(verts);
  if (desc) ctx.physics.tag(ctx.physics.world.createCollider(desc.setFriction(0.7).setCollisionGroups(groups(G_STATIC, ALL))), { kind: 'static' });
}
