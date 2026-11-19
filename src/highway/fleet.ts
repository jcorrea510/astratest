/** Instanced rendering of every highway vehicle: one InstancedMesh (body) + one (glass) per model, plus a shared headlight-beam mesh. */
import * as THREE from 'three';
import { getTemplate } from '../vehicles/models/build';
import type { VehicleKind } from '../vehicles/specs';
import { makeCarMaterial, makeGlassMaterial, semiGeometry, busGeometry, type CarUniforms } from './cars';
import { beamTexture } from './textures';

const CAP = 56;
interface Slot { name: string; body: THREE.InstancedMesh; glass: THREE.InstancedMesh | null; lamp: THREE.InstancedBufferAttribute; n: number; hi: boolean }
export interface InstanceIn {
  model: string; x: number; y: number; z: number;
  /** model axes in world space: left (+x), up, forward */ left: THREE.Vector3; up: THREE.Vector3; fwd: THREE.Vector3;
  color: THREE.Color; brake: number; indL: number; indR: number; head: number; beam?: boolean;
}

export class Fleet {
  readonly group = new THREE.Group();
  readonly material = makeCarMaterial();
  readonly glassMaterial = makeGlassMaterial();
  private slots = new Map<string, Slot>();
  private beams: THREE.InstancedMesh;
  private beamN = 0;
  /** models whose glass is not drawn (the player's own car in the cockpit view) */
  hideGlass = new Set<string>();
  private tmp = new THREE.Matrix4();
  constructor() {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5); // extends toward +z in local space... flipped below
    g.rotateY(Math.PI); // far end at +z
    const mat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff0d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.beams = new THREE.InstancedMesh(g, mat, CAP * 2); this.beams.frustumCulled = false; this.beams.renderOrder = 4; this.beams.count = 0;
    this.group.add(this.beams);
  }
  get uniforms(): CarUniforms { return this.material.userData.u; }

  private slot(model: string): Slot {
    let s = this.slots.get(model);
    if (s) return s;
    let src: THREE.BufferGeometry, glassSrc: THREE.BufferGeometry | null = null;
    const hi = model.startsWith('player:'), name = hi ? model.slice(7) : model; // the player's own car uses the detailed LOD
    if (name === 'semi') src = semiGeometry();
    else if (name === 'bus') src = busGeometry();
    else { const t = getTemplate(name as VehicleKind), l = t.lods[hi ? 0 : 1]; src = l.body; glassSrc = l.glass ?? t.lods[0].glass; }
    const clone = (g: THREE.BufferGeometry) => {
      // share the (possibly already uploaded) attributes, add our own instanced lamp attribute
      const c = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'color', 'aKind']) { const a = g.getAttribute(k); if (a) c.setAttribute(k, a); }
      c.setIndex(g.index); c.boundingSphere = g.boundingSphere?.clone() ?? null; c.boundingBox = g.boundingBox?.clone() ?? null;
      return c;
    };
    const bg = clone(src);
    const lampArr = new Float32Array(CAP * 4);
    const lamp = new THREE.InstancedBufferAttribute(lampArr, 4); lamp.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('iLamp', lamp);
    const body = new THREE.InstancedMesh(bg, this.material, CAP);
    body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3); body.instanceColor.setUsage(THREE.DynamicDrawUsage);
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.frustumCulled = false; body.count = 0;
    this.group.add(body);
    let glass: THREE.InstancedMesh | null = null;
    if (glassSrc) {
      const gg = clone(glassSrc);
      if (!gg.getAttribute('color')) gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(gg.getAttribute('position').count * 4), 4));
      glass = new THREE.InstancedMesh(gg, this.glassMaterial, CAP);
      glass.instanceMatrix.setUsage(THREE.DynamicDrawUsage); glass.frustumCulled = false; glass.count = 0; glass.renderOrder = 1;
      this.group.add(glass);
    }
    s = { name: model, body, glass, lamp, n: 0, hi };
    this.slots.set(model, s);
    return s;
  }
  begin(): void { for (const s of this.slots.values()) s.n = 0; this.beamN = 0; }
  add(i: InstanceIn): void {
    const s = this.slot(i.model);
    if (s.n >= CAP) return;
    const e = this.tmp.elements;
    e[0] = i.left.x; e[1] = i.left.y; e[2] = i.left.z; e[3] = 0;
    e[4] = i.up.x; e[5] = i.up.y; e[6] = i.up.z; e[7] = 0;
    e[8] = i.fwd.x; e[9] = i.fwd.y; e[10] = i.fwd.z; e[11] = 0;
    e[12] = i.x; e[13] = i.y; e[14] = i.z; e[15] = 1;
    s.body.setMatrixAt(s.n, this.tmp); s.glass?.setMatrixAt(s.n, this.tmp);
    s.body.setColorAt(s.n, i.color);
    const a = s.lamp.array as Float32Array; a[s.n * 4] = i.brake; a[s.n * 4 + 1] = i.indL; a[s.n * 4 + 2] = i.indR; a[s.n * 4 + 3] = i.head;
    s.n++;
    if (i.beam && i.head > 0 && this.beamN < CAP * 2) {
      // footprint on the road ahead: along the forward vector flattened to the surface
      const f = i.fwd, len = 34, wid = 6.2;
      const fl = Math.hypot(f.x, f.z) || 1, fx = f.x / fl, fz = f.z / fl;
      this.tmp.set(fz * wid, 0, fx * len, i.x + f.x * 2.2, 0, 1, 0, i.y - 0.33 + 0.05, -fx * wid, 0, fz * len, i.z + f.z * 2.2, 0, 0, 0, 1);
      this.beams.setMatrixAt(this.beamN++, this.tmp);
    }
  }
  end(): void {
    for (const s of this.slots.values()) {
      s.body.count = s.n; s.body.instanceMatrix.needsUpdate = true; if (s.body.instanceColor) s.body.instanceColor.needsUpdate = true; s.lamp.needsUpdate = true;
      if (s.glass) { s.glass.count = s.n; s.glass.instanceMatrix.needsUpdate = true; }
      s.body.visible = s.n > 0; if (s.glass) s.glass.visible = s.n > 0 && !this.hideGlass.has(s.name);
    }
    this.beams.count = this.beamN; this.beams.instanceMatrix.needsUpdate = true; this.beams.visible = this.beamN > 0;
  }
  dispose(): void { this.group.removeFromParent(); for (const s of this.slots.values()) { s.body.dispose(); s.glass?.dispose(); } this.beams.dispose(); }
}
