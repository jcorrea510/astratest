/**
 * R6-X: street furniture that breaks when a car hits it fast enough. The static instance is hidden and its collider
 * removed; a dynamic body (same mesh) takes over and tips over. Lamps go dark. Everything respawns once it is far away.
 * Signal poles and trees are not registered, so they never break.
 */
import * as THREE from 'three';
import { RAPIER, type Physics, G_STATIC, G_VEHICLE, G_PROP, groups } from '../core/physics';
import type { Vehicle } from '../vehicles/vehicle';
import type { InstHandle } from '../world/geometry';

export type BreakKind = 'lamp' | 'hydrant' | 'bin' | 'meter' | 'phone' | 'mailbox';
export interface BreakableDef {
  kind: BreakKind; x: number; y: number; z: number; yaw: number;
  handle: InstHandle; geo: THREE.BufferGeometry; mat: THREE.Material;
  /** index into the city's lamp heads (-1 if none) */
  lampIdx: number;
  /** recreates the static collider (after a respawn) */
  makeCollider: () => RAPIER.Collider;
  collider: RAPIER.Collider | null;
  broken?: boolean;
}
interface KindSpec { h: number; r: number; mass: number; speed: number; dmg: number }
const SPEC: Record<BreakKind, KindSpec> = {
  lamp: { h: 8.5, r: 0.14, mass: 240, speed: 5.5, dmg: 9 },
  hydrant: { h: 0.9, r: 0.2, mass: 80, speed: 9, dmg: 14 },
  bin: { h: 1, r: 0.3, mass: 30, speed: 3.5, dmg: 3 },
  meter: { h: 1.4, r: 0.08, mass: 25, speed: 4.5, dmg: 3 },
  phone: { h: 2, r: 0.22, mass: 110, speed: 6.5, dmg: 6 },
  mailbox: { h: 1.4, r: 0.3, mass: 60, speed: 7, dmg: 5 },
};
const CELL = 24;
interface Fallen { def: BreakableDef; body: RAPIER.RigidBody; holder: THREE.Group; age: number; jet: number }
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _d = new THREE.Vector3();

export interface BreakHooks {
  /** a lamp head went dark (on=false) or was restored */
  onLamp?: (idx: number, on: boolean) => void;
  sfx?: (name: string, at: THREE.Vector3, volume: number) => void;
  splash?: (x: number, y: number, z: number, n: number) => void;
  sparks?: (x: number, y: number, z: number, n: number) => void;
}

export class Breakables {
  fallen: Fallen[] = [];
  private grid = new Map<number, BreakableDef[]>();
  /** minimum seconds a broken piece lies before it may respawn, and the distance it must be away from the viewer */
  respawnAfter = 45; respawnDist = 110;
  onBreak: ((def: BreakableDef, v: Vehicle, speed: number) => void) | null = null;
  constructor(private scene: THREE.Object3D, private physics: Physics, public defs: BreakableDef[], private hooks: BreakHooks = {}) {
    for (const d of defs) { const k = this.key(d.x, d.z); let l = this.grid.get(k); if (!l) { l = []; this.grid.set(k, l); } l.push(d); }
  }
  private key(x: number, z: number) { return (Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096); }
  /** Per frame: look for fast vehicles touching furniture; sync fallen pieces; respawn far ones. */
  update(dt: number, vehicles: Iterable<Vehicle>, focus: THREE.Vector3) {
    for (const v of vehicles) {
      const sp = Math.abs(v.speed);
      if (sp < 3.4 || v.destroyed && sp < 6) continue;
      const p = v.position, L = v.tpl.layout, reach = Math.max(L.half[0], L.half[2]) + 1;
      const yaw = v.yaw, c = Math.cos(yaw), s = Math.sin(yaw), zc = L.zCenter ?? 0;
      for (let gx = Math.floor((p.x - reach) / CELL); gx <= Math.floor((p.x + reach) / CELL); gx++) for (let gz = Math.floor((p.z - reach) / CELL); gz <= Math.floor((p.z + reach) / CELL); gz++) {
        const l = this.grid.get((gx + 4096) * 8192 + (gz + 4096)); if (!l) continue;
        for (const d of l) {
          if (d.broken) continue;
          const sp0 = SPEC[d.kind];
          if (Math.abs(d.y - p.y) > 4) continue;
          const dx = d.x - p.x, dz = d.z - p.z;
          const lx = dx * c - dz * s, lz = dx * s + dz * c;
          if (Math.abs(lx) < L.half[0] + sp0.r + 0.05 && Math.abs(lz - zc) < L.half[2] + sp0.r + 0.05 && sp >= sp0.speed) this.hit(d, v, sp);
        }
      }
    }
    this.syncFallen(dt, focus);
  }
  /** Breaks a piece (also used by tests / explosions). */
  hit(d: BreakableDef, v: Vehicle | null, sp: number, dir?: THREE.Vector3) {
    if (d.broken) return; d.broken = true;
    const spec = SPEC[d.kind], w = this.physics.world;
    if (d.collider) { this.physics.untag(d.collider); w.removeCollider(d.collider, true); d.collider = null; }
    if (d.handle.im) { d.handle.im.setMatrixAt(d.handle.idx, ZERO); d.handle.im.instanceMatrix.needsUpdate = true; }
    // travel direction
    const dirV = dir ? _d.copy(dir) : v ? _d.set(v.phys.body.linvel().x, 0, v.phys.body.linvel().z) : _d.set(1, 0, 0);
    const spd = Math.max(sp, 1); if (dirV.lengthSq() < 1e-6) dirV.set(1, 0, 0); dirV.normalize();
    // dynamic body
    const qy = _q.setFromAxisAngle(_v.set(0, 1, 0), d.yaw);
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(d.x, d.y + spec.h / 2 + 0.02, d.z).setRotation({ x: qy.x, y: qy.y, z: qy.z, w: qy.w })
      .setLinearDamping(0.1).setAngularDamping(0.25).setCcdEnabled(true));
    const cd = d.kind === 'lamp' || d.kind === 'meter' ? RAPIER.ColliderDesc.capsule(Math.max(0.05, spec.h / 2 - spec.r), spec.r)
      : RAPIER.ColliderDesc.cylinder(spec.h / 2, spec.r);
    w.createCollider(cd.setMass(spec.mass).setFriction(0.6).setRestitution(0.18).setCollisionGroups(groups(G_PROP, G_STATIC | G_VEHICLE | G_PROP)), body);
    // kick: base shoved along the travel direction, top left behind -> it tips over away from the car
    const tipAxis = _v.set(0, 1, 0).cross(dirV).normalize();
    const w0 = Math.min(3.2, (spd * (d.kind === 'lamp' ? 0.7 : 1.0)) / Math.max(1, spec.h) * 1.3 + 0.6);
    body.setAngvel({ x: tipAxis.x * w0, y: 0, z: tipAxis.z * w0 }, true);
    body.setLinvel({ x: dirV.x * spd * 0.35, y: d.kind === 'lamp' ? 0.4 : 2.0, z: dirV.z * spd * 0.35 }, true);
    const holder = new THREE.Group(); const mesh = new THREE.Mesh(d.geo, d.mat); mesh.position.y = -spec.h / 2 - 0.02; mesh.castShadow = true; mesh.receiveShadow = true;
    holder.add(mesh); this.scene.add(holder);
    holder.position.set(d.x, d.y + spec.h / 2, d.z); holder.quaternion.copy(qy);
    this.fallen.push({ def: d, body, holder, age: 0, jet: d.kind === 'hydrant' ? 7 : 0 });
    if (d.lampIdx >= 0) this.hooks.onLamp?.(d.lampIdx, false);
    const at = _v.set(d.x, d.y + 0.6, d.z);
    this.hooks.sfx?.(d.kind === 'lamp' ? 'crash' : 'metalHit', at.clone(), Math.min(1, 0.4 + spd / 20));
    this.hooks.sparks?.(d.x, d.y + 0.5, d.z, 14);
    // the car loses speed shoving it over, and takes a dent
    if (v) {
      const m = v.spec.mass, dv = Math.min(spd * 0.6, spec.mass / (m + spec.mass) * spd * 1.25 + 0.5);
      const f = v.phys.body.linvel(), fl = Math.hypot(f.x, f.z) || 1;
      v.phys.body.applyImpulse({ x: -f.x / fl * m * dv, y: 0, z: -f.z / fl * m * dv }, true);
      const into = new THREE.Vector3(-f.x / fl, 0, -f.z / fl), pt = new THREE.Vector3(d.x, d.y + 0.5, d.z);
      v.damage(spec.dmg * spd * 0.5, pt, into, v.driver ?? v.lastDamagedBy, false);
      v.crumple(pt, into, Math.min(0.6, 0.12 + spd / 60));
    }
    this.onBreak?.(d, v as Vehicle, spd);
  }
  private syncFallen(dt: number, focus: THREE.Vector3) {
    for (let i = this.fallen.length - 1; i >= 0; i--) {
      const f = this.fallen[i]; f.age += dt;
      if (!f.body.isSleeping()) {
        const t = f.body.translation(), r = f.body.rotation();
        f.holder.position.set(t.x, t.y, t.z); f.holder.quaternion.set(r.x, r.y, r.z, r.w);
      }
      if (f.jet > 0) {
        f.jet -= dt;
        if (Math.random() < 0.7) this.hooks.splash?.(f.def.x, f.def.y + 0.9, f.def.z, 2);
      }
      if (f.age > this.respawnAfter && f.def.x !== undefined && Math.hypot(f.def.x - focus.x, f.def.z - focus.z) > this.respawnDist && Math.hypot(f.holder.position.x - focus.x, f.holder.position.z - focus.z) > this.respawnDist) this.respawn(f, i);
    }
  }
  private respawn(f: Fallen, i: number) {
    const d = f.def;
    this.physics.world.removeRigidBody(f.body);
    f.holder.removeFromParent();
    this.fallen.splice(i, 1);
    d.collider = d.makeCollider(); d.broken = false;
    if (d.handle.im) {
      _q.setFromAxisAngle(_v.set(0, 1, 0), d.yaw);
      d.handle.im.setMatrixAt(d.handle.idx, new THREE.Matrix4().compose(new THREE.Vector3(d.x, d.y, d.z), _q, new THREE.Vector3(1, 1, 1)));
      d.handle.im.instanceMatrix.needsUpdate = true;
    }
    if (d.lampIdx >= 0) this.hooks.onLamp?.(d.lampIdx, true);
  }
  /** Nearest intact piece of a kind (tests). */
  nearest(kind: BreakKind, x: number, z: number): BreakableDef | null {
    let b: BreakableDef | null = null, bd = Infinity;
    for (const d of this.defs) { if (d.kind !== kind || d.broken) continue; const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; b = d; } }
    return b;
  }
  /** Tilt (degrees from vertical) of a fallen piece's axis. */
  tiltOf(d: BreakableDef): number {
    const f = this.fallen.find(x => x.def === d); if (!f) return 0;
    const up = _v.set(0, 1, 0).applyQuaternion(f.holder.quaternion);
    return Math.acos(Math.min(1, Math.max(-1, up.y))) * 180 / Math.PI;
  }
}
