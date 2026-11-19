/**
 * First-person body shell: the player's own body mesh with its A-pillars slimmed to a realistic width (the loft that builds the
 * windshield frame is 8.5 cm wide in plan and, seen from the driver's eye, reads as a heavy black bar). Pure geometry work, done once.
 */
import * as THREE from 'three';

export interface Pillar { a: THREE.Vector3; b: THREE.Vector3 }
/** Slimmed fraction of the original pillar width (0.55 leaves about 4.7 cm). */
export const PILLAR_KEEP = 0.55;

/**
 * Returns a copy of `g` whose dark windshield-pillar triangles (front of `zFront`, above the dash line) are squeezed toward the
 * pillar's centre line (the lowest dark triangles, the windshield's bottom trim, are left alone), plus the centre line of the driver-side (+x) pillar. Non-indexed template geometry only.
 */
export function slimPillars(g: THREE.BufferGeometry, zFront: number, keep = PILLAR_KEEP): { geo: THREE.BufferGeometry; pillar: Pillar | null } {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, kind = g.getAttribute('aKind'), col = g.getAttribute('color');
  if (!kind || !col || g.index) return { geo: g, pillar: null };
  const out = new Float32Array(pos.array.length); out.set(pos.array as Float32Array);
  const dark = (i: number): boolean => { const k = Math.round(kind.getX(i)); return (k === 0 || k === 2) && col.getX(i) < 0.012 && col.getY(i) < 0.012 && col.getZ(i) < 0.012; };
  // triangle set per side: dark, ahead of the roof's front edge, above the windshield's bottom trim strip
  const tris: number[][] = [[], []], cand: { i: number; cx: number; cy: number }[] = [];
  let ymin = Infinity;
  for (let i = 0; i < pos.count; i += 3) {
    if (!dark(i)) continue;
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    if (cz < zFront || Math.abs(cx) < 0.3) continue;
    cand.push({ i, cx, cy }); ymin = Math.min(ymin, cy);
  }
  for (const c of cand) if (c.cy > ymin + 0.08) tris[c.cx > 0 ? 0 : 1].push(c.i);
  let pillar: Pillar | null = null;
  for (let side = 0; side < 2; side++) {
    const list = tris[side]; if (list.length < 4) continue;
    // centre line: mean of the lowest and the highest vertices
    let lo = Infinity, hi = -Infinity;
    for (const i of list) for (let q = 0; q < 3; q++) { const y = pos.getY(i + q); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const span = (hi - lo) * 0.12, A = new THREE.Vector3(), B = new THREE.Vector3(); let na = 0, nb = 0;
    for (const i of list) for (let q = 0; q < 3; q++) {
      const y = pos.getY(i + q);
      if (y < lo + span) { A.add(new THREE.Vector3(pos.getX(i + q), y, pos.getZ(i + q))); na++; }
      else if (y > hi - span) { B.add(new THREE.Vector3(pos.getX(i + q), y, pos.getZ(i + q))); nb++; }
    }
    if (!na || !nb) continue;
    A.multiplyScalar(1 / na); B.multiplyScalar(1 / nb);
    const d = B.clone().sub(A), dd = d.lengthSq();
    for (const i of list) for (let q = 0; q < 3; q++) {
      const v = new THREE.Vector3(pos.getX(i + q), pos.getY(i + q), pos.getZ(i + q));
      const t = Math.min(1, Math.max(0, v.clone().sub(A).dot(d) / dd)), c = A.clone().addScaledVector(d, t);
      v.sub(c).multiplyScalar(keep).add(c);
      out[(i + q) * 3] = v.x; out[(i + q) * 3 + 1] = v.y; out[(i + q) * 3 + 2] = v.z;
    }
    if (side === 0) pillar = { a: A, b: B };
  }
  const c = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color', 'aKind']) { const a = g.getAttribute(name); if (a) c.setAttribute(name, name === 'position' ? new THREE.BufferAttribute(out, 3) : a); }
  c.computeBoundingSphere(); c.computeBoundingBox();
  return { geo: c, pillar };
}
