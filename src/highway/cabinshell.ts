/**
 * First-person cabin frame: where the player's own body has its windshield and side windows (read from the template's glass
 * mesh), and a copy of the body mesh with the front greenhouse (A-pillars, windshield header, front roof, door-mirror housings)
 * cut away. The cockpit draws its own thin, dark interior pillars, header and headliner in their place, so the body's exterior
 * loft (built to be seen from outside, far too thick from the driver's eye) never shows in the cockpit. Pure geometry, done once.
 */
import * as THREE from 'three';
import { getTemplate } from '../vehicles/models/build';
import type { VehicleKind } from '../vehicles/specs';
import { K } from '../vehicles/models/kinds';

export interface V3 { x: number; y: number; z: number }
export interface CabinFrame {
  /** side-window sill height (the beltline): the dash top and the door sills sit at it */
  belt: number;
  /** driver-side (+x) side-window sill: x = its widest point (the door line), z = its front end; the A-pillar base and the door mirror mount */
  base: V3;
  /** windshield base z on the car's centre line (the windshield base curves back toward the corners) */
  baseCz: number;
  /** windshield top outer corner (driver side, +x) */
  top: V3;
  /** headliner height */
  roofIn: number;
  /** front edge of the body roof kept in the shell (everything above the belt ahead of it is cut away) */
  zCut: number;
  open: boolean;
}

/** Reads the windshield / side-glass corners from a glass mesh (normals tell the windshield from the side glass). */
export function frameFromGlass(glass: THREE.BufferGeometry | null | undefined, fb: { belt: number; zA: number; zR1: number; roofY: number; halfW: number; open: boolean }): CabinFrame {
  const out: CabinFrame = {
    belt: fb.belt, base: { x: fb.halfW - 0.18, y: fb.belt, z: fb.zA - 0.15 }, baseCz: fb.zA, top: { x: fb.halfW - 0.3, y: fb.roofY - 0.1, z: fb.zR1 + 0.05 },
    roofIn: fb.roofY - 0.04, zCut: fb.zR1 - 0.04, open: fb.open,
  };
  const P = glass?.getAttribute('position'), N = glass?.getAttribute('normal');
  if (P && N) {
    const ws: number[] = [], sd: number[] = [];
    for (let i = 0; i < P.count; i++) {
      if (N.getZ(i) > 0.35 && Math.abs(N.getX(i)) < 0.6) ws.push(i);
      else if (N.getX(i) > 0.6 && P.getX(i) > 0) sd.push(i);
    }
    if (ws.length > 8 && sd.length > 8) {
      let y0 = Infinity, y1 = -Infinity, s0 = Infinity;
      for (const i of ws) { y0 = Math.min(y0, P.getY(i)); y1 = Math.max(y1, P.getY(i)); }
      for (const i of sd) s0 = Math.min(s0, P.getY(i));
      const r = y1 - y0;
      let top = -1, cz = -Infinity, bz = -Infinity, bx = 0;
      for (const i of ws) {
        const x = P.getX(i), y = P.getY(i);
        if (y > y1 - 0.1 * r && x > 0 && (top < 0 || x > P.getX(top))) top = i;
        if (y < y0 + 0.08 * r && Math.abs(x) < 0.15) cz = Math.max(cz, P.getZ(i));
      }
      for (const i of sd) if (P.getY(i) < s0 + 0.03) { bz = Math.max(bz, P.getZ(i)); bx = Math.max(bx, P.getX(i)); } // front end and widest point of the sill line
      out.belt = s0;
      out.base = { x: bx, y: s0, z: bz };
      if (top >= 0) out.top = { x: P.getX(top), y: P.getY(top), z: P.getZ(top) };
      out.baseCz = Number.isFinite(cz) ? Math.max(cz, bz) : fb.zA;
      out.roofIn = Math.min(fb.roofY - 0.035, out.top.y + 0.07);
      out.zCut = Math.min(out.top.z, fb.zR1) - 0.04;
    }
  }
  return out;
}

const frames = new Map<VehicleKind, CabinFrame>();
/** Cabin frame of a vehicle kind (cached). */
export function cabinFrame(kind: VehicleKind): CabinFrame {
  let f = frames.get(kind);
  if (f) return f;
  const t = getTemplate(kind), gh = t.shape.gh, S = t.seats[0];
  f = frameFromGlass(t.lods[0].glass, { belt: S.y + 0.47, zA: gh?.zA ?? S.z + 0.9, zR1: gh?.zR1 ?? S.z + 0.1, roofY: t.roofY, halfW: t.shape.W / 2, open: !!gh?.open });
  frames.set(kind, f);
  return f;
}

/**
 * Copy of a (non-indexed) body mesh without the front greenhouse: triangles above the beltline and ahead of `zCut`
 * (A-pillars, windshield frame, the roof's front edge) and every door-mirror triangle. Indexed input is returned unchanged.
 */
export function stripFrontGreenhouse(g: THREE.BufferGeometry, belt: number, zCut: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, kind = g.getAttribute('aKind');
  if (g.index || !pos) return g;
  const keep: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const ymax = Math.max(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2));
    if (kind && Math.round(kind.getX(i)) === K.MIRROR) continue;
    if (cz > zCut && (cy > belt + 0.012 || (ymax > belt + 0.05 && cy > belt - 0.02))) continue;
    keep.push(i);
  }
  const c = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color', 'aKind']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined; if (!a) continue;
    const sz = a.itemSize, src = a.array, out = new Float32Array(keep.length * 3 * sz);
    keep.forEach((v, j) => { for (let q = 0; q < 3 * sz; q++) out[j * 3 * sz + q] = src[v * sz + q]; });
    c.setAttribute(name, new THREE.BufferAttribute(out, sz));
  }
  c.computeBoundingSphere(); c.computeBoundingBox();
  return c;
}
