/** Owns every vehicle: spawning, crash handling, fire/explosions, skid marks and engine audio. */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import type { Assets } from '../world/assets';
import { Vehicle, makeKayKitTemplate, makeVanTemplate, type VehicleTemplate } from '../vehicles/vehicle';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import type { Particles, SkidMarks } from '../render/particles';
import type { GameAudio, EngineVoice } from '../ui/contracts';

export interface CrashEvent { vehicle: Vehicle; impact: number; point: THREE.Vector3 }
export class VehicleManager {
  list: Vehicle[] = [];
  templates = new Map<string, VehicleTemplate>();
  onCrash: ((e: CrashEvent) => void) | null = null;
  onExplode: ((v: Vehicle, at: THREE.Vector3) => void) | null = null;
  private engines = new Map<number, EngineVoice>();
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private physics: Physics, private assets: Assets, private particles: Particles, private skids: SkidMarks, private audio: GameAudio) {
    const models = ['car_sedan', 'car_taxi', 'car_police', 'car_hatchback', 'car_stationwagon'] as const;
    for (const m of models) this.templates.set(m, makeKayKitTemplate(assets.kaykit[m], m));
    this.templates.set('coupe', makeKayKitTemplate(assets.kaykit.car_hatchback, 'car_hatchback', [1.04, 0.9, 1.06]));
    this.templates.set('van', makeVanTemplate(this.templates.get('car_sedan')!));
  }
  templateFor(kind: VehicleKind) { return kind === 'coupe' ? this.templates.get('coupe')! : this.templates.get(VEHICLES[kind].model)!; }
  spawn(kind: VehicleKind, x: number, z: number, yaw: number, paintIndex = -1, y = 0.2): Vehicle {
    const v = new Vehicle(this.physics, kind, this.templateFor(kind), x, y, z, yaw, this.assets.atlas, paintIndex);
    this.scene.add(v.group); this.list.push(v);
    return v;
  }
  remove(v: Vehicle) {
    const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1);
    this.engines.get(v.id)?.stop(); this.engines.delete(v.id);
    v.dispose();
  }
  nearest(p: THREE.Vector3, maxDist: number, filter?: (v: Vehicle) => boolean): Vehicle | null {
    let best: Vehicle | null = null, bd = maxDist;
    for (const v of this.list) { if (filter && !filter(v)) continue; const d = v.position.distanceTo(p); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  /** After the physics step: crashes and damage. */
  postStep(time: number) {
    for (const v of this.list) {
      v.phys.postStep();
      const imp = v.phys.impact;
      if (imp > 3.2 && !v.destroyed) {
        const d = v.phys.impactDir;
        const pt = this.tmp.copy(v.position).add(new THREE.Vector3(-d.x, 0.4, -d.z).multiplyScalar(2));
        const dmg = (imp - 3) * 38;
        const destroyed = v.damage(dmg, pt.clone(), new THREE.Vector3(d.x, d.y, d.z));
        v.flashT = 0.15;
        this.particles.sparks(pt.x, pt.y, pt.z, Math.min(40, Math.floor(imp * 3)), 4 + imp);
        if (imp > 6) this.audio.play('glass', { pos: pt, volume: Math.min(1, imp / 14) });
        this.audio.play('crash', { pos: pt, volume: Math.min(1, imp / 12), pitch: 0.9 + Math.random() * 0.2 });
        this.onCrash?.({ vehicle: v, impact: imp, point: pt.clone() });
        void destroyed;
      }
      void time;
    }
  }
  update(dt: number, night: number, time: number, listener: THREE.Vector3, playerVehicle: Vehicle | null) {
    for (const v of [...this.list]) {
      const braking = v.input.throttle < -0.1 && v.speed > 1;
      v.update(dt, night, time, braking || v.input.handbrake);
      const dist = v.position.distanceTo(listener);
      // Skid marks + tyre smoke
      const c = v.phys.ctrl;
      for (let i = 0; i < v.tpl.layout.wheels.length; i++) {
        const slip = v.phys.slip[i];
        const id = v.id * 8 + i;
        if (slip > 3.2 && dist < 120) {
          const cp = c.wheelContactPoint(i);
          if (cp) { this.skids.add(id, cp.x, cp.y, cp.z, Math.min(1, (slip - 3) / 5)); if (Math.random() < 0.35 && dist < 60) this.particles.tireSmoke(cp.x, cp.y, cp.z, v.phys.body.linvel().x, v.phys.body.linvel().z); }
        } else this.skids.end(id);
      }
      // Damage effects
      const frac = v.health / v.spec.health;
      if (!v.destroyed && frac < 0.45 && dist < 150 && Math.random() < (0.45 - frac) * 1.4) {
        const p = this.hoodPoint(v); this.particles.smoke(p.x, p.y, p.z, frac < 0.2 ? 0.8 : 0.3);
      }
      if (v.destroyed) {
        if (v.burnTime > 0) {
          v.burnTime += dt;
          const p = this.hoodPoint(v);
          if (dist < 200) { this.particles.fire(p.x, p.y, p.z); if (Math.random() < 0.4) this.particles.smoke(p.x, p.y + 0.8, p.z, 0.9, 1.4); }
          if (v.burnTime > 4) { v.burnTime = -1; this.explode(v); }
        } else if (v.burnTime < 0 && Math.random() < 0.15 && dist < 150) { const p = this.hoodPoint(v); this.particles.smoke(p.x, p.y + 0.5, p.z, 0.9, 1.2); }
      }
      // Engine sound for nearby driven vehicles
      const hasEngine = !v.destroyed && (v.driver || v === playerVehicle) && dist < 70;
      let ev = this.engines.get(v.id);
      if (hasEngine) {
        if (!ev) { ev = this.audio.engine(); this.engines.set(v.id, ev); }
        ev.update({ rpm: v.phys.rpm, throttle: Math.abs(v.input.throttle), pos: v.position, kind: v.kind === 'van' ? 'truck' : 'car', damage: 1 - frac });
      } else if (ev) { ev.stop(); this.engines.delete(v.id); }
    }
  }
  private hoodPoint(v: Vehicle) { return new THREE.Vector3(0, v.tpl.bbox.max.y * 0.7, v.tpl.bbox.max.z - 0.9).applyMatrix4(v.group.matrixWorld); }
  explode(v: Vehicle) {
    const p = v.position.clone();
    this.particles.explosion(p.x, p.y + 0.5, p.z);
    this.audio.play('explosion', { pos: p, volume: 1 });
    v.phys.body.applyImpulse({ x: (Math.random() - 0.5) * v.spec.mass * 2, y: v.spec.mass * 7, z: (Math.random() - 0.5) * v.spec.mass * 2 }, true);
    v.phys.body.applyTorqueImpulse({ x: v.spec.mass * 2, y: 0, z: v.spec.mass * 1.5 }, true);
    for (const o of this.list) {
      if (o === v) continue;
      const d = o.position.distanceTo(p);
      if (d < 9) { o.damage((9 - d) * 60, p, o.position.clone().sub(p).normalize()); const dir = o.position.clone().sub(p).normalize(); o.phys.body.applyImpulse({ x: dir.x * o.spec.mass * 4, y: o.spec.mass * 3, z: dir.z * o.spec.mass * 4 }, true); }
    }
    this.onExplode?.(v, p);
  }
  stopAllSounds() { for (const e of this.engines.values()) e.stop(); this.engines.clear(); }
}
