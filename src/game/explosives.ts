/**
 * Interactive firefight explosives: destructible red industrial fuel drums (2 instanced draw calls for the whole city)
 * and shootable gas-station fuel pumps.
 *
 * Shooting a drum or pump punctures it with a pressurized flame jet that cooks off after ~0.7-1.1 s (or detonates
 * immediately under heavy damage / a second hit), triggering staggered chain-reaction explosions with nearby units.
 */
import * as THREE from 'three';
import { RAPIER, type Physics, G_STATIC, groups } from '../core/physics';
import type { Character } from '../actors/character';
import type { Combat } from '../combat/combat';
import type { Particles } from '../render/particles';
import type { GameAudio } from '../ui/contracts';
import { GAS_STATION } from './places';

interface ExplosiveUnit {
  kind: 'barrel' | 'pump';
  idx: number; // instance index for barrels, -1 for pumps
  pos: THREE.Vector3;
  radius: number;
  hp: number;
  state: 'intact' | 'burning' | 'gone';
  fuse: number;
  respawnT: number;
  by: Character | null;
  collider: RAPIER.Collider | null;
}

/** Curated firefight hotspots across the city (off road centerlines, well clear of all 7 garage bays). */
const BARREL_SPOTS: [number, number][] = [
  // Harbor Quay & Docks firefight clusters
  [512, 138], [514.2, 139.2], [510.8, 140.4],
  [526, -34], [528.2, -32.8],
  [486, 252], [488.5, 253.1], [487.0, 255.2],
  // Industrial Cannery yard
  [276, 466], [278.4, 467.2], [275.2, 468.5],
  [334, 514], [336.1, 515.6],
  // Gas Station forecourt corner (near pumps for huge chain reactions)
  [GAS_STATION.x - 10, GAS_STATION.z - 8], [GAS_STATION.x - 8.2, GAS_STATION.z - 9.1],
  // Midtown Plaza / construction alley
  [-128, 136], [-126.1, 137.4],
  [136, 134], [138.2, 135.5],
  // Eastbank warehouse district
  [742, 442], [744.3, 443.4], [743.1, 445.6],
  // Airfield hangar apron
  [724, -460], [726.3, -458.8], [725.2, -462.2],
  // Fort Calder perimeter depot
  [-470, 560], [-468.2, 561.5],
];

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class Explosives {
  private units: ExplosiveUnit[] = [];
  private bodyMesh: THREE.InstancedMesh;
  private bandMesh: THREE.InstancedMesh;
  private fxAcc = 0;

  constructor(
    scene: THREE.Scene,
    private physics: Physics,
    private combat: Combat,
    private particles: Particles,
    private audio: GameAudio,
    groundY: (x: number, z: number) => number,
  ) {
    const n = BARREL_SPOTS.length;
    const bodyGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.96, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb9261b, roughness: 0.42, metalness: 0.48 });
    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, n);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;

    const bandGeo = new THREE.CylinderGeometry(0.332, 0.332, 0.16, 12);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xf4b63c, roughness: 0.55, metalness: 0.15, emissive: 0x3b2204, emissiveIntensity: 0.25 });
    this.bandMesh = new THREE.InstancedMesh(bandGeo, bandMat, n);

    for (let i = 0; i < n; i++) {
      const [x, z] = BARREL_SPOTS[i];
      const y = groundY(x, z);
      const pos = new THREE.Vector3(x, y + 0.48, z);
      const col = this.addCollider(pos);
      this.units.push({ kind: 'barrel', idx: i, pos, radius: 0.55, hp: 35, state: 'intact', fuse: 0, respawnT: 0, by: null, collider: col });
      this.setInstance(i, pos, true);
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.bandMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.bodyMesh, this.bandMesh);

    // Interactive gas-station fuel pumps (existing geometry in citybuild; we register explosive hitboxes over each island)
    const pumpY = groundY(GAS_STATION.x, GAS_STATION.z) + 1.0;
    for (const dx of [-4.5, 4.5]) {
      for (const dz of [-2.2, 2.2]) {
        this.units.push({
          kind: 'pump',
          idx: -1,
          pos: new THREE.Vector3(GAS_STATION.x + dx, pumpY, GAS_STATION.z + dz),
          radius: 1.35,
          hp: 55,
          state: 'intact',
          fuse: 0,
          respawnT: 0,
          by: null,
          collider: null,
        });
      }
    }
  }

  private addCollider(pos: THREE.Vector3): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(0.48, 0.34)
      .setTranslation(pos.x, pos.y, pos.z)
      .setCollisionGroups(groups(G_STATIC, 0xffff));
    return this.physics.world.createCollider(desc);
  }

  private setInstance(idx: number, pos: THREE.Vector3, visible: boolean) {
    if (idx < 0) return;
    if (visible) {
      _p.copy(pos);
      _m.compose(_p, _q, _s);
      this.bodyMesh.setMatrixAt(idx, _m);
      _p.y = pos.y + 0.14;
      _m.compose(_p, _q, _s);
      this.bandMesh.setMatrixAt(idx, _m);
    } else {
      this.bodyMesh.setMatrixAt(idx, _zero);
      this.bandMesh.setMatrixAt(idx, _zero);
    }
  }

  /** Called by Combat.onStaticHit when a bullet strikes static world geometry. */
  hit(point: THREE.Vector3, damage: number, shooter: Character | null) {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.state === 'gone') continue;
      const dx = point.x - u.pos.x, dy = point.y - u.pos.y, dz = point.z - u.pos.z;
      const r = u.radius + 0.32;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      u.hp -= damage;
      u.by = shooter;
      if (u.hp <= 0) {
        this.detonate(u);
      } else if (u.state === 'intact') {
        // Puncture cook-off: pressurised fire jet + hissing sparks before blowing!
        u.state = 'burning';
        u.fuse = 0.65 + Math.random() * 0.45;
        this.particles.sparks(point.x, point.y, point.z, 12, 7);
        this.particles.fire(point.x, point.y + 0.2, point.z, 0.8);
        this.audio.play('whoosh', { pos: u.pos, volume: 0.55, pitch: 1.8 });
      }
      return;
    }
  }

  /** Trigger staggered chain reactions when an explosion occurs near barrels or pumps. */
  blast(at: THREE.Vector3, radius: number, by: Character | null) {
    const r2 = (radius + 1.5) * (radius + 1.5);
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.state === 'gone') continue;
      const dx = u.pos.x - at.x, dy = u.pos.y - at.y, dz = u.pos.z - at.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      u.by = by ?? u.by;
      u.state = 'burning';
      u.fuse = Math.min(u.fuse > 0 ? u.fuse : 1, 0.14 + Math.random() * 0.18);
    }
  }

  private detonate(u: ExplosiveUnit) {
    if (u.state === 'gone') return;
    u.state = 'gone';
    u.respawnT = 90;
    if (u.collider) {
      this.physics.world.removeCollider(u.collider, false);
      u.collider = null;
    }
    if (u.idx >= 0) {
      this.setInstance(u.idx, u.pos, false);
      this.bodyMesh.instanceMatrix.needsUpdate = true;
      this.bandMesh.instanceMatrix.needsUpdate = true;
    }
    const scale = u.kind === 'pump' ? 1.65 : 1.25;
    this.combat.explode(u.pos, u.by, scale);
    this.blast(u.pos, u.kind === 'pump' ? 10 : 7.5, u.by);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.fxAcc += dt;
    const emitFx = this.fxAcc >= 0.045;
    if (emitFx) this.fxAcc = 0;
    let dirty = false;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.state === 'burning') {
        u.fuse -= dt;
        if (emitFx) {
          this.particles.fire(u.pos.x, u.pos.y + 0.45, u.pos.z, 0.85);
          this.particles.sparks(u.pos.x, u.pos.y + 0.5, u.pos.z, 2, 5);
        }
        if (u.fuse <= 0) this.detonate(u);
      } else if (u.state === 'gone') {
        u.respawnT -= dt;
        if (u.respawnT <= 0) {
          const dx = u.pos.x - playerPos.x, dz = u.pos.z - playerPos.z;
          if (dx * dx + dz * dz > 120 * 120) {
            u.state = 'intact';
            u.hp = u.kind === 'pump' ? 55 : 35;
            u.fuse = 0;
            u.by = null;
            if (u.kind === 'barrel') {
              u.collider = this.addCollider(u.pos);
              this.setInstance(u.idx, u.pos, true);
              dirty = true;
            }
          }
        }
      }
    }
    if (dirty) {
      this.bodyMesh.instanceMatrix.needsUpdate = true;
      this.bandMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
