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
  // only the pillar itself: not the windshield's bottom trim, and not the mirror arms further out (x near the pillar's top end)
  const top = cand.filter(c => c.cy > ymin + 0.08).sort((a, b) => b.cy - a.cy).slice(0, 14);
  const xTop = [0, 1].map(side => { const xs = top.filter(c => (c.cx > 0 ? 0 : 1) === side).map(c => Math.abs(c.cx)).sort((a, b) => a - b); return xs.length ? xs[xs.length >> 1] : 0; });
  for (const c of cand) { const side = c.cx > 0 ? 0 : 1; if (c.cy > ymin + 0.08 && Math.abs(Math.abs(c.cx) - xTop[side]) < 0.14) tris[side].push(c.i); }
  let pillar: Pillar | null = null;
  const vert = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  /** centre line through the mean of the lowest and of the highest vertices of a triangle list */
  const fit = (list: number[]): Pillar | null => {
    let lo = Infinity, hi = -Infinity;
    for (const i of list) for (let q = 0; q < 3; q++) { const y = pos.getY(i + q); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const span = (hi - lo) * 0.12, A = new THREE.Vector3(), B = new THREE.Vector3(); let na = 0, nb = 0;
    for (const i of list) for (let q = 0; q < 3; q++) {
      const y = pos.getY(i + q);
      if (y < lo + span) { A.add(vert(i + q)); na++; } else if (y > hi - span) { B.add(vert(i + q)); nb++; }
    }
    return na && nb ? { a: A.multiplyScalar(1 / na), b: B.multiplyScalar(1 / nb) } : null;
  };
  const distTo = (l: Pillar, v: THREE.Vector3): number => { const d = l.b.clone().sub(l.a), t = Math.min(1, Math.max(0, v.clone().sub(l.a).dot(d) / d.lengthSq())); return v.distanceTo(l.a.clone().addScaledVector(d, t)); };
  for (let side = 0; side < 2; side++) {
    if (tris[side].length < 4) continue;
    let line = fit(tris[side]); if (!line) continue;
    // only triangles that really lie along the pillar (the window-frame rail that joins its top end must not be dragged in)
    const list = tris[side].filter(i => [0, 1, 2].every(q => distTo(line!, vert(i + q)) < 0.085));
    if (list.length < 4) continue;
    line = fit(list); if (!line) continue;
    const d = line.b.clone().sub(line.a), dd = d.lengthSq();
    for (const i of list) for (let q = 0; q < 3; q++) {
      const v = vert(i + q), t = Math.min(1, Math.max(0, v.clone().sub(line.a).dot(d) / dd)), c = line.a.clone().addScaledVector(d, t);
      v.sub(c).multiplyScalar(keep).add(c);
      out[(i + q) * 3] = v.x; out[(i + q) * 3 + 1] = v.y; out[(i + q) * 3 + 2] = v.z;
    }
    if (side === 0) pillar = line;
  }
  const c = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color', 'aKind']) { const a = g.getAttribute(name); if (a) c.setAttribute(name, name === 'position' ? new THREE.BufferAttribute(out, 3) : a); }
  c.computeBoundingSphere(); c.computeBoundingBox();
  return { geo: c, pillar };
}
