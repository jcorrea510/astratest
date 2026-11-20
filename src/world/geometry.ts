/** Geometry helpers: baking GLTF models, low-poly procedural props and chunked instancing. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Rng } from '../core/rng';

export const KAYKIT_SCALE = 5;

/** Bakes every mesh of a GLTF scene into a single geometry (position/normal/uv) at the given scale. */
export function bakeModel(gltf: GLTF, scale = KAYKIT_SCALE, filter?: (name: string) => boolean): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const sm = new THREE.Matrix4().makeScale(scale, scale, scale);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (filter && !filter(mesh.name)) return;
    const g = mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(sm, mesh.matrixWorld));
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('Failed to merge model');
  merged.computeBoundingBox();
  return merged;
}

/** Applies a solid vertex colour to a geometry (used to merge flat-shaded props). */
export function colorize(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, rng?: Rng): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count; const c = new THREE.Color(color); const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const j = rng && jitter ? rng.range(-jitter, jitter) : 0;
    for (let k = 0; k < 3 && i + k < n; k++) { arr[(i + k) * 3] = c.r * (1 + j); arr[(i + k) * 3 + 1] = c.g * (1 + j); arr[(i + k) * 3 + 2] = c.b * (1 + j); }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}
export function mergeColored(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts.map(p => { const q = p.index ? p.toNonIndexed() : p; if (!q.attributes.normal) q.computeVertexNormals(); for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color'].includes(k)) q.deleteAttribute(k); return q; }), false);
  if (!m) throw new Error('merge failed');
  m.computeVertexNormals(); m.computeBoundingBox(); m.computeBoundingSphere();
  return m;
}

export function treeGeometry(seed: number): THREE.BufferGeometry {
  const r = new Rng(seed);
  const trunk = colorize(new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6).translate(0, 1.6, 0), '#6b4a34');
  const parts = [trunk];
  const blobs = r.int(2, 3);
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(r.range(1.5, 2.1), 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * r.range(0.9, 1.1), p.getY(k) * r.range(0.8, 1.0), p.getZ(k) * r.range(0.9, 1.1));
    g.translate(r.range(-0.7, 0.7), 3.6 + i * 0.9 + r.range(0, 0.5), r.range(-0.7, 0.7));
    parts.push(colorize(g, i % 2 ? '#5c8f45' : '#4f7f3c', 0.08, r));
  }
  return mergeColored(parts);
}
export function palmGeometry(seed: number): THREE.BufferGeometry {
  const r = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const h = r.range(6.5, 9), lean = r.range(0.4, 1.3);
  const segs = 6; let px = 0, py = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const x0 = lean * t0 * t0, x1 = lean * t1 * t1;
    const len = Math.hypot(x1 - x0, h / segs);
    const c = new THREE.CylinderGeometry(0.17 - t1 * 0.05, 0.2 - t0 * 0.05, len, 6);
    c.rotateZ(-Math.atan2(x1 - x0, h / segs)); c.translate((x0 + x1) / 2, (t0 + t1) / 2 * h, 0);
    parts.push(colorize(c, i % 2 ? '#8a6a48' : '#7a5c3e'));
    px = x1; py = t1 * h;
  }
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r.range(-0.2, 0.2);
    const len = r.range(3, 3.8);
    const shape = new THREE.BufferGeometry();
    const v: number[] = [];
    const steps = 5;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const w0 = Math.sin(Math.PI * Math.min(1, t0 * 1.2 + 0.05)) * 0.55, w1 = Math.sin(Math.PI * Math.min(1, t1 * 1.2 + 0.05)) * 0.55;
      const y0 = -t0 * t0 * 1.8 + t0 * 0.6, y1 = -t1 * t1 * 1.8 + t1 * 0.6;
      const a0 = [t0 * len, y0, -w0], b0 = [t0 * len, y0, w0], a1 = [t1 * len, y1, -w1], b1 = [t1 * len, y1, w1];
      v.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1, ...a0, ...a1, ...b0, ...b0, ...a1, ...b1);
    }
    shape.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    shape.rotateY(a); shape.translate(px, py, 0);
    parts.push(colorize(shape, i % 2 ? '#4f8a3a' : '#5f9a46'));
  }
  const coco = colorize(new THREE.IcosahedronGeometry(0.45, 0).translate(px, py - 0.3, 0), '#5a4630');
  parts.push(coco);
  return mergeColored(parts);
}

/** Where an added instance lives, so it can be hidden / restored later (breakable street furniture). `im` is set by build(). */
export interface InstHandle { key: string; ck: string; idx: number; im: THREE.InstancedMesh | null }
/** Groups instances into spatial chunks so frustum and distance culling stay effective. */
export class ChunkInstancer {
  private sets = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean; receive: boolean; chunks: Map<string, { m: THREE.Matrix4[]; c: THREE.Color[]; h: InstHandle[] }> }>();
  constructor(public chunkSize = 250) { }
  register(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, castShadow = true, receiveShadow = true) {
    if (!this.sets.has(key)) this.sets.set(key, { geo, mat, shadow: castShadow, receive: receiveShadow, chunks: new Map() });
  }
  add(key: string, x: number, y: number, z: number, yaw = 0, scale: number | THREE.Vector3 = 1, color?: THREE.Color): InstHandle {
    const set = this.sets.get(key); if (!set) throw new Error(`unregistered instance key ${key}`);
    const ck = `${Math.floor(x / this.chunkSize)},${Math.floor(z / this.chunkSize)}`;
    let ch = set.chunks.get(ck); if (!ch) { ch = { m: [], c: [], h: [] }; set.chunks.set(ck, ch); }
    const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
    ch.m.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), s));
    ch.c.push(color ?? new THREE.Color(1, 1, 1));
    const h: InstHandle = { key, ck, idx: ch.m.length - 1, im: null }; ch.h.push(h); return h;
  }
  build(parent: THREE.Object3D): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const [key, set] of this.sets) for (const [ck, ch] of set.chunks) {
      const im = new THREE.InstancedMesh(set.geo, set.mat, ch.m.length);
      ch.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, ch.c[i]); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = set.shadow; im.receiveShadow = set.receive;
      im.computeBoundingSphere(); im.computeBoundingBox();
      im.name = `${key}@${ck}`; for (const h of ch.h) h.im = im;
      parent.add(im); out.push(im);
    }
    return out;
  }
}
