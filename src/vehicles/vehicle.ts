/** Vehicle visuals and state: paint, glass, lights, body roll, deformable damage, fire. */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics } from '../core/physics';
import { VehiclePhysics, type DriveInput, type VehicleLayout } from './vehiclePhysics';
import { VEHICLES, type VehicleKind, type VehicleSpec } from './specs';
import type { Character } from '../actors/character';
import { nightUniform } from '../render/materials';
import { damp } from '../core/rng';

const S = 5;
const PAINT_CELL: Record<string, [number, number]> = { car_sedan: [2, 1], car_taxi: [3, 1], car_police: [-1, -1], car_hatchback: [4, 1], car_stationwagon: [2, 2] };
export const GLASS_CELL: [number, number] = [0, 3];

export interface VehicleTemplate {
  body: THREE.BufferGeometry; wheel: THREE.BufferGeometry; layout: VehicleLayout; bbox: THREE.Box3; model: string; atlas: boolean;
}
function bakeNode(obj: THREE.Object3D, scale: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale).multiply(inv).multiply(m.matrixWorld));
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  return mergeGeometries(geos)!;
}
export function makeKayKitTemplate(gltf: GLTF, model: string, bodyScale: [number, number, number] = [1, 1, 1]): VehicleTemplate {
  const scene = gltf.scene; scene.updateMatrixWorld(true);
  const bodyNode = scene.getObjectByName(model)!;
  const wheelNodes = ['front_left', 'front_right', 'rear_left', 'rear_right'].map(n => scene.getObjectByName(`${model}_wheel_${n}`)!);
  // body: only the body mesh (exclude wheel children if nested)
  const bodyGeo = bakeNode(new THREE.Group().add((bodyNode as THREE.Mesh).clone(false)), S);
  bodyGeo.scale(bodyScale[0], bodyScale[1], bodyScale[2]);
  const wheelGeo = bakeNode(new THREE.Group().add((wheelNodes[0] as THREE.Mesh).clone(false)), S);
  wheelGeo.computeBoundingBox();
  const wb = wheelGeo.boundingBox!; const c = wb.getCenter(new THREE.Vector3()); wheelGeo.translate(-c.x, -c.y, -c.z);
  const radius = (wb.max.y - wb.min.y) / 2;
  bodyGeo.computeBoundingBox(); const bb = bodyGeo.boundingBox!;
  const wheels = wheelNodes.map((w, i) => ({ x: w.position.x * S * bodyScale[0], y: w.position.y * S, z: w.position.z * S * bodyScale[2], front: i < 2, left: i % 2 === 0 }));
  const hy = (bb.max.y - Math.max(bb.min.y, 0.05)) / 2 * 0.86;
  const layout: VehicleLayout = { half: [(bb.max.x - bb.min.x) / 2 * 0.96, hy, (bb.max.z - bb.min.z) / 2 * 0.97], centerY: Math.max(bb.min.y, 0.05) + hy + 0.05, wheels, radius };
  return { body: bodyGeo, wheel: wheelGeo, layout, bbox: bb, model, atlas: true };
}
/** Procedural box van in the same flat style (vertex colours). */
export function makeVanTemplate(wheelFrom: VehicleTemplate): VehicleTemplate {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, col: string, paint = 0) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z);
    const n = g.attributes.position.count; const cc = new THREE.Color(col); const arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { arr[i * 4] = cc.r; arr[i * 4 + 1] = cc.g; arr[i * 4 + 2] = cc.b; arr[i * 4 + 3] = paint; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 4)); g.deleteAttribute('uv'); parts.push(g);
  };
  box(2.3, 2.3, 3.9, 0, 1.72, -0.95, '#ffffff', 1); // cargo box (paint)
  box(2.2, 1.35, 1.9, 0, 1.1, 1.95, '#ffffff', 1); // cab lower
  box(2.1, 0.75, 1.35, 0, 2.05, 1.7, '#ffffff', 1); // cab upper
  box(1.98, 0.62, 0.05, 0, 2.05, 2.39, '#22323a', 2); // windshield (glass)
  box(0.05, 0.55, 0.9, 1.06, 2.05, 1.85, '#22323a', 2); box(0.05, 0.55, 0.9, -1.06, 2.05, 1.85, '#22323a', 2);
  box(2.3, 0.3, 0.25, 0, 0.55, 2.95, '#9aa0a4'); box(2.3, 0.3, 0.25, 0, 0.55, -2.95, '#9aa0a4');
  box(2.24, 0.35, 6.0, 0, 0.55, 0, '#2b2f33');
  box(2.32, 0.08, 3.92, 0, 2.86, -0.95, '#d8d4c8');
  const body = mergeGeometries(parts)!; body.computeVertexNormals(); body.computeBoundingBox();
  const bb = body.boundingBox!;
  const r = wheelFrom.layout.radius;
  const wheels = [{ x: 0.98, y: r - 0.3 + 0.36, z: 1.95, front: true, left: true }, { x: -0.98, y: r - 0.3 + 0.36, z: 1.95, front: true, left: false }, { x: 0.98, y: r - 0.3 + 0.36, z: -1.9, front: false, left: true }, { x: -0.98, y: r - 0.3 + 0.36, z: -1.9, front: false, left: false }];
  const layout: VehicleLayout = { half: [1.12, 1.15, 2.95], centerY: 1.55, wheels, radius: r * 1.1 };
  return { body, wheel: wheelFrom.wheel.clone().scale(1.1, 1.1, 1.1), layout, bbox: bb, model: 'van', atlas: false };
}

function carMaterial(atlas: THREE.Texture | null, paintCell: [number, number]): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.55, metalness: 0.1, vertexColors: !atlas });
  const u = { uPaint: { value: new THREE.Color(1, 1, 1) }, uPaintOn: { value: 0 }, uPaintCell: { value: new THREE.Vector2(...paintCell) }, uBurn: { value: 0 }, uFlash: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u); sh.uniforms.uNight = nightUniform;
    const hasMap = !!atlas;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nvarying vec2 vCell;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${hasMap ? 'vCell = floor(uv * vec2(8.0, 4.0));' : 'vCell = vec2(-5.0);'}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCell; uniform vec3 uPaint; uniform float uPaintOn, uBurn, uNight, uFlash; uniform vec2 uPaintCell;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float isGlass = ${hasMap ? 'step(distance(vCell, vec2(0.0, 3.0)), 0.1)' : 'step(1.5, vColor.a)'};
        float isPaint = ${hasMap ? 'step(distance(vCell, uPaintCell), 0.1)' : 'step(0.5, vColor.a) * (1.0 - isGlass)'} * uPaintOn;
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * (0.55 + lum * ${hasMap ? '0.9' : '0.45'}), isPaint);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.13, 0.16) + vec3(0.05, 0.08, 0.1) * (1.0 - uNight), isGlass);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.055, 0.05), uBurn);
        diffuseColor.rgb += uFlash * 0.3;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.32, isPaint), 0.08, isGlass); roughnessFactor = mix(roughnessFactor, 0.95, uBurn);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(mix(metalnessFactor, 0.25, isPaint), 0.5, isGlass) * (1.0 - uBurn);');
  };
  m.customProgramCacheKey = () => (atlas ? 'car-atlas' : 'car-vc');
  return m;
}

const lightGeo = new THREE.CircleGeometry(0.13, 12);
const beamTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 128, 4, 32, 90, 90); gr.addColorStop(0, 'rgba(255,240,200,0.9)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 128); return new THREE.CanvasTexture(c); })();

let VEH_ID = 0;
let wheelMat: THREE.MeshStandardMaterial | null = null;
export class Vehicle {
  id = VEH_ID++;
  phys: VehiclePhysics;
  spec: VehicleSpec;
  group = new THREE.Group();
  visual = new THREE.Group();
  bodyMesh: THREE.Mesh;
  wheels: THREE.Mesh[] = [];
  material: THREE.MeshStandardMaterial;
  health: number;
  destroyed = false;
  burnTime = 0;
  driver: Character | null = null;
  input: DriveInput = { throttle: 0, steer: 0, handbrake: false };
  headlights = false;
  siren = false;
  lightsBroken = false;
  private headMat: THREE.MeshBasicMaterial;
  private tailMat: THREE.MeshBasicMaterial;
  private beam: THREE.Mesh;
  private barRed?: THREE.Mesh; private barBlue?: THREE.Mesh;
  private ownGeo = false;
  private roll = 0; private pitch = 0;
  private lastVel = new THREE.Vector3();
  paint = new THREE.Color();
  parked = false;
  lastDriverTime = 0;
  locked = false;
  flashT = 0;
  persistent = false;

  constructor(physics: Physics, public kind: VehicleKind, public tpl: VehicleTemplate, x: number, y: number, z: number, yaw: number, atlas: THREE.Texture | null, paintIndex = -1) {
    this.spec = VEHICLES[kind];
    this.health = this.spec.health;
    this.phys = new VehiclePhysics(physics, this.spec, tpl.layout, x, y + 0.6, z, yaw);
    physics.tag(this.phys.collider, { kind: 'vehicle', ref: this });
    this.material = carMaterial(tpl.atlas ? atlas : null, PAINT_CELL[tpl.model] ?? [-1, -1]);
    const paints = this.spec.paints;
    if (paints[0]) { this.paint.set(paints[paintIndex >= 0 ? paintIndex % paints.length : Math.floor(Math.random() * paints.length)]).convertSRGBToLinear(); this.material.userData.u.uPaint.value.copy(this.paint); this.material.userData.u.uPaintOn.value = 1; }
    this.bodyMesh = new THREE.Mesh(tpl.body, this.material);
    this.bodyMesh.castShadow = true; this.bodyMesh.receiveShadow = true;
    this.visual.add(this.bodyMesh);
    for (const w of tpl.layout.wheels) {
      if (!wheelMat && atlas) wheelMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.75 });
      const m = new THREE.Mesh(tpl.wheel, tpl.atlas ? this.material : wheelMat!); m.castShadow = false;
      m.position.set(w.x, w.y, w.z); this.group.add(m); this.wheels.push(m);
    }
    // Lights
    this.headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85), toneMapped: false });
    this.tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.02, 0.02), toneMapped: false });
    const bb = tpl.bbox;
    const fz = bb.max.z + 0.02, rz = bb.min.z - 0.02, ly = tpl.model === 'van' ? 0.95 : bb.min.y + (bb.max.y - bb.min.y) * 0.38;
    const heads: THREE.BufferGeometry[] = [], tails: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      heads.push(lightGeo.clone().translate(sx * (bb.max.x - 0.32), ly, fz));
      tails.push(lightGeo.clone().scale(1.2, 0.7, 1).rotateY(Math.PI).translate(sx * (bb.max.x - 0.3), ly + 0.05, rz));
    }
    this.visual.add(new THREE.Mesh(mergeGeometries(heads)!, this.headMat), new THREE.Mesh(mergeGeometries(tails)!, this.tailMat));
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 9).rotateX(-Math.PI / 2).translate(0, 0.04, fz + 4.4), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
    this.beam.renderOrder = 2; this.visual.add(this.beam);
    if (kind === 'police') {
      const barY = bb.max.y + 0.02;
      this.barRed = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.02, 0.02), toneMapped: false }));
      this.barBlue = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.05, 0.3), toneMapped: false }));
      this.barRed.position.set(0.3, barY, -0.2); this.barBlue.position.set(-0.3, barY, -0.2);
      this.visual.add(this.barRed, this.barBlue);
    }
    if (kind === 'coupe') {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.4), new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.5 }));
      spoiler.position.set(0, bb.max.y - 0.25, rz + 0.35); spoiler.castShadow = true; this.visual.add(spoiler);
    }
    this.group.add(this.visual);
    this.syncTransform();
  }
  get position() { return this.group.position; }
  get speed() { return this.phys.speed; }
  get yaw() { return this.phys.yaw; }
  get name() { return this.spec.name; }
  get size() { return this.tpl.model === 'van' ? 1.25 : 1; }
  /** World position of the driver door (left side). */
  doorPoint(side: 1 | -1 = 1, out = new THREE.Vector3()) {
    const b = this.tpl.bbox;
    out.set(side * (b.max.x + 0.7), 0, 0.25).applyQuaternion(this.group.quaternion).add(this.group.position);
    return out;
  }
  seatOffset(): THREE.Vector3 { return this.tpl.model === 'van' ? new THREE.Vector3(0.48, 0.55, 1.75) : new THREE.Vector3(0.42, 0.12, 0.05); }
  syncTransform() {
    const p = this.phys.body.translation(), q = this.phys.body.rotation();
    this.group.position.set(p.x, p.y, p.z); this.group.quaternion.set(q.x, q.y, q.z, q.w);
  }
  update(dt: number, night: number, time: number, braking: boolean) {
    this.syncTransform();
    const c = this.phys.ctrl;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i], wd = this.tpl.layout.wheels[i];
      const sl = c.wheelSuspensionLength(i) ?? this.spec.suspRest;
      w.position.y = wd.y + this.spec.suspRest * 0.8 - sl;
      w.rotation.set(0, 0, 0);
      w.rotateY(c.wheelSteering(i) ?? 0);
      w.rotateX(c.wheelRotation(i) ?? 0);
      if (!wd.left) w.rotateY(Math.PI);
    }
    // Body roll/pitch from acceleration for a weighty feel.
    const v = this.phys.body.linvel();
    if (dt > 0) {
      const ax = (v.x - this.lastVel.x) / dt, az = (v.z - this.lastVel.z) / dt;
      this.lastVel.set(v.x, v.y, v.z);
      const f = this.phys.forward();
      const lon = ax * f.x + az * f.z, lat = ax * f.z - az * f.x;
      this.roll = damp(this.roll, THREE.MathUtils.clamp(lat * 0.006, -0.06, 0.06), 6, dt);
      this.pitch = damp(this.pitch, THREE.MathUtils.clamp(-lon * 0.004, -0.04, 0.04), 6, dt);
      this.visual.rotation.set(this.pitch, 0, this.roll);
    }
    // Lights
    const on = (this.headlights || night > 0.35) && !this.destroyed && !this.lightsBroken && (!!this.driver || this.persistent);
    this.headMat.color.setRGB(on ? 3 : 0.75, on ? 2.8 : 0.72, on ? 2.4 : 0.65);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = on ? 0.35 * Math.max(night, 0.2) : 0;
    this.beam.visible = on;
    const tail = this.destroyed ? 0.02 : braking ? 3 : on ? 1.1 : 0.35;
    this.tailMat.color.setRGB(tail, tail * 0.05, tail * 0.04);
    if (this.barRed && this.barBlue) {
      const ph = Math.floor(time * 6) % 2;
      const s = this.siren && !this.destroyed;
      (this.barRed.material as THREE.MeshBasicMaterial).color.setRGB(s && ph ? 5 : 0.3, 0.05, 0.05);
      (this.barBlue.material as THREE.MeshBasicMaterial).color.setRGB(0.05, 0.1, s && !ph ? 5 : 0.3);
    }
    if (this.flashT > 0) { this.flashT -= dt; this.material.userData.u.uFlash.value = Math.max(0, this.flashT * 4); }
  }
  /** Applies damage; deforms the body near the impact point (local space). Returns true when this destroyed it. */
  damage(amount: number, worldPoint?: THREE.Vector3, worldDir?: THREE.Vector3): boolean {
    if (this.destroyed) return false;
    this.health -= amount;
    if (worldPoint && amount > 25) this.deform(worldPoint, worldDir, Math.min(1, amount / 300));
    const frac = this.health / this.spec.health;
    this.phys.enginePower = frac < 0.25 ? 0.6 : 1;
    if (this.health <= 0) { this.health = 0; this.destroyed = true; this.burnTime = 0.001; this.siren = false; this.material.userData.u.uBurn.value = 0.85; this.material.userData.u.uPaintOn.value = 0; return true; }
    return false;
  }
  private deform(worldPoint: THREE.Vector3, worldDir: THREE.Vector3 | undefined, severity: number) {
    if (!this.ownGeo) { this.bodyMesh.geometry = this.bodyMesh.geometry.clone(); this.ownGeo = true; }
    const g = this.bodyMesh.geometry; const pos = g.attributes.position as THREE.BufferAttribute;
    const inv = new THREE.Matrix4().copy(this.visual.matrixWorld).invert();
    const lp = worldPoint.clone().applyMatrix4(inv);
    const center = new THREE.Vector3(0, (this.tpl.bbox.min.y + this.tpl.bbox.max.y) / 2, 0);
    const dir = worldDir ? worldDir.clone().transformDirection(inv) : center.clone().sub(lp).normalize();
    // snap the impact point to the body surface along the direction from the centre
    const radius = 1.3, push = 0.28 * severity;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const d = Math.hypot(vx - lp.x, (vy - lp.y) * 1.4, vz - lp.z);
      if (d > radius) continue;
      const k = (1 - d / radius) ** 2 * push;
      pos.setXYZ(i, vx + dir.x * k + (Math.random() - 0.5) * k * 0.3, vy + dir.y * k * 0.5 - k * 0.15, vz + dir.z * k);
    }
    pos.needsUpdate = true; g.computeVertexNormals();
    if (lp.z > this.tpl.bbox.max.z - 0.8 && severity > 0.4) this.lightsBroken = true;
  }
  private disposed = false;
  dispose() { if (this.disposed) return; this.disposed = true; this.phys.dispose(); this.group.removeFromParent(); if (this.ownGeo) this.bodyMesh.geometry.dispose(); this.material.dispose();
    this.phys.physics.untag(this.phys.collider);
    this.visual.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m !== this.bodyMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) { if (m.geometry !== lightGeo) m.geometry.dispose(); const mat = m.material as THREE.Material; if (mat !== this.material && mat !== wheelMat) mat.dispose(); } });
    this.driver = null;
  }
}
