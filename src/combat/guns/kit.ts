/**
 * Weapon model kit: part builders (profiles, lathes, cylinders, rails, sights) that are merged per material and per
 * moving group ('body', 'mag', 'slide', 'pump', 'bolt'). Metres; muzzle along +z, firing-hand grip near the origin (y up).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mats, type Mat } from './materials';
export type { Mat };

// ---------------------------------------------------------------- part builders
export type Part = { geo: THREE.BufferGeometry; mat: Mat; group: string };
export class Kit {
  parts: Part[] = [];
  group = 'body';
  in(group: string, fn: () => void) { const g = this.group; this.group = group; fn(); this.group = g; }
  push(geo: THREE.BufferGeometry, mat: Mat) { this.parts.push({ geo, mat, group: this.group }); }
  /**
   * Side profile in (z forward, y up) extruded `w` wide across x, centred on x0, with a bevel. Points go around the outline.
   */
  prof(pts: [number, number][], w: number, mat: Mat, bevel = 0.003, x0 = 0) {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const b = Math.min(bevel, w * 0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, w - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 4 });
    g.rotateY(-Math.PI / 2); g.translate(x0 + (w - 2 * b) / 2, 0, 0);
    this.push(g, mat); return this;
  }
  /** Box (centre, size). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: Mat, rx = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz); if (rx) g.rotateX(rx); g.translate(cx, cy, cz); this.push(g, mat); return this;
  }
  /** Cylinder along z from z0 to z1. */
  cyl(r: number, z0: number, z1: number, y: number, mat: Mat, seg = 12, x = 0, r1 = r) {
    const g = new THREE.CylinderGeometry(r1, r, z1 - z0, seg); g.rotateX(Math.PI / 2); g.translate(x, y, (z0 + z1) / 2); this.push(g, mat); return this;
  }
  /** Cylinder along x (pins, knobs, bolt handles). */
  cylX(r: number, len: number, x: number, y: number, z: number, mat: Mat, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); this.push(g, mat); return this;
  }
  /** Vertical cylinder. */
  cylY(r: number, h: number, x: number, y: number, z: number, mat: Mat, seg = 10, r1 = r) {
    const g = new THREE.CylinderGeometry(r1, r, h, seg); g.translate(x, y, z); this.push(g, mat); return this;
  }
  /** Lathe around the z axis: points are [radius, z]. */
  lathe(pts: [number, number][], y: number, mat: Mat, seg = 14, x = 0) {
    const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(Math.max(0.0005, r), z)), seg); g.rotateX(Math.PI / 2); g.translate(x, y, 0); this.push(g, mat); return this;
  }
  /** Lathe around the vertical axis: points are [radius, y]. */
  latheY(pts: [number, number][], mat: Mat, seg = 16, x = 0, z = 0) {
    const g = new THREE.LatheGeometry(pts.map(([r, yy]) => new THREE.Vector2(Math.max(0.0005, r), yy)), seg); g.translate(x, 0, z); this.push(g, mat); return this;
  }
  /** Bore: a dark disc just inside the muzzle so barrels read as hollow. */
  bore(r: number, z: number, y: number) { const g = new THREE.CircleGeometry(r, 10); g.translate(0, y, z + 0.0008); this.push(g, 'bore'); return this; }
  /** Picatinny rail from z0 to z1 on top at height y. */
  rail(z0: number, z1: number, y: number, w = 0.021, mat: Mat = 'steel') {
    this.box(0, y + 0.004, (z0 + z1) / 2, w * 0.7, 0.008, z1 - z0, mat);
    for (let z = z0 + 0.006; z < z1 - 0.004; z += 0.01) this.box(0, y + 0.0095, z, w, 0.004, 0.0052, mat);
    return this;
  }
  /** Front post + rear notch iron sights. */
  irons(zf: number, zr: number, y: number, mat: Mat = 'steel') { this.box(0, y + 0.006, zf, 0.004, 0.012, 0.006, mat); this.box(-0.006, y + 0.005, zr, 0.004, 0.01, 0.008, mat).box(0.006, y + 0.005, zr, 0.004, 0.01, 0.008, mat); return this; }
  /** Telescopic sight centred over the bore from z0 to z1, axis at height y. */
  scope(z0: number, z1: number, y: number, r = 0.019, obj = 0.026) {
    const L = z1 - z0;
    this.lathe([[0, z0], [r * 1.25, z0], [r * 1.3, z0 + 0.012], [r * 1.05, z0 + 0.04], [r, z0 + 0.06], [r, z0 + L * 0.42], [r * 1.12, z0 + L * 0.45], [r * 1.12, z0 + L * 0.55], [r, z0 + L * 0.58], [r, z1 - 0.07], [obj, z1 - 0.03], [obj * 1.05, z1], [0, z1]], y, 'steel', 16);
    this.cylY(0.007, 0.022, 0, y + r + 0.009, z0 + L * 0.5, 'steel', 10); this.cylX(0.007, 0.03, 0.022, y, z0 + L * 0.5, 'steel');
    const lens = (rr: number, z: number) => { const g = new THREE.CircleGeometry(rr, 14); g.translate(0, y, z); this.push(g, 'lens'); const g2 = new THREE.CircleGeometry(rr, 14); g2.rotateY(Math.PI); g2.translate(0, y, z); this.push(g2, 'lens'); };
    lens(obj * 0.85, z1 + 0.001); lens(r * 1.05, z0 - 0.001);
    // rings
    for (const z of [z0 + L * 0.28, z0 + L * 0.72]) { this.cyl(r + 0.004, z - 0.007, z + 0.007, y, 'steel', 14); this.box(0, y - r - 0.006, z, 0.016, 0.014, 0.014, 'steel'); }
    return this;
  }
  /** Small red-dot sight. */
  redDot(z: number, y: number) {
    this.prof([[z - 0.03, y], [z + 0.03, y], [z + 0.03, y + 0.014], [z + 0.02, y + 0.04], [z - 0.02, y + 0.04], [z - 0.03, y + 0.014]], 0.026, 'polymer', 0.002);
    const g = new THREE.CircleGeometry(0.009, 12); g.rotateY(Math.PI); g.translate(0, y + 0.026, z - 0.0305); this.push(g, 'lens');
    return this;
  }
  build(id: string): THREE.Group {
    const root = new THREE.Group(); root.name = `weapon:${id}`;
    const M = mats();
    const byGroup = new Map<string, Map<Mat, THREE.BufferGeometry[]>>();
    for (const p of this.parts) {
      let gm = byGroup.get(p.group); if (!gm) byGroup.set(p.group, gm = new Map());
      let list = gm.get(p.mat); if (!list) gm.set(p.mat, list = []);
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; g.clearGroups();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      list.push(g);
    }
    for (const [group, gm] of byGroup) {
      const node = group === 'body' ? root : new THREE.Group(); node.name = group;
      for (const [mat, list] of gm) {
        const merged = mergeGeometries(list, false); if (!merged) continue;
        merged.computeBoundingSphere(); merged.userData.shared = true;
        const mesh = new THREE.Mesh(merged, M[mat]); mesh.castShadow = mat !== 'lens' && mat !== 'bore'; mesh.name = `${group}:${mat}`;
        node.add(mesh);
      }
      if (node !== root) root.add(node);
    }
    return root;
  }
}

/** What a builder returns: gun-space anchor points (muzzle tip, case ejection, stock butt, fore-hand palm, firing-hand palm). */
export type Built = { muzzle: THREE.Vector3; eject: THREE.Vector3; butt?: THREE.Vector3; support?: THREE.Vector3; grip?: THREE.Vector3 };
