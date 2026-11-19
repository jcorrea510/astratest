/** Owns every vehicle: spawning, crash handling, fire/explosions, skid marks and engine audio. */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import type { Assets } from '../world/assets';
import { Vehicle } from '../vehicles/vehicle';
import type { VehicleKind } from '../vehicles/specs';
import { WATER_LEVEL } from '../world/citymap';
import type { Particles, SkidMarks } from '../render/particles';
import type { GameAudio, EngineVoice, LoopVoice } from '../ui/contracts';

export interface CrashEvent { vehicle: Vehicle; impact: number; point: THREE.Vector3 }
export class VehicleManager {
  list: Vehicle[] = [];
  onCrash: ((e: CrashEvent) => void) | null = null;
  /** extra crash subscribers (traffic reacts to accidents) */
  crashListeners: ((e: CrashEvent) => void)[] = [];
  onExplode: ((v: Vehicle, at: THREE.Vector3) => void) | null = null;
  private engines = new Map<number, EngineVoice>();
  private skidVoice: LoopVoice | null = null;
  private skidWas = false;
  private tmp = new THREE.Vector3();
  private sirenVoice: LoopVoice | null = null;
  /** Police-class vehicles that carry a light bar and siren. */
  static hasSiren(v: Vehicle) { return v.kind === 'police' || v.kind === 'fbi' || v.kind === 'swat' || v.kind === 'army'; }
  /** Driver controls: J/K/L pick wail/yelp/phaser (press the active one again to silence), U toggles the light bar. */
  sirenKeys(pv: Vehicle, pressed: (a: 'sirenWail' | 'sirenYelp' | 'sirenPhaser' | 'lightBar') => boolean) {
    if (!VehicleManager.hasSiren(pv) || pv.destroyed) return;
    (['sirenWail', 'sirenYelp', 'sirenPhaser'] as const).forEach((a, i) => { if (pressed(a)) { pv.sirenTone = pv.sirenTone === i + 1 ? 0 : i + 1; if (pv.sirenTone) pv.lightBar = true; } });
    if (pressed('lightBar')) { pv.lightBar = !pv.lightBar; if (!pv.lightBar) pv.sirenTone = 0; }
  }
  private updatePlayerSiren(pv: Vehicle | null) {
    const on = !!pv && pv.sirenTone > 0 && !pv.destroyed;
    if (on && pv) {
      if (!this.sirenVoice) this.sirenVoice = this.audio.siren();
      this.sirenVoice.tone = pv.sirenTone; this.sirenVoice.update(pv.position, 1);
    } else if (this.sirenVoice) { this.sirenVoice.stop(); this.sirenVoice = null; }
  }

  constructor(private scene: THREE.Scene, private physics: Physics, assets: Assets, private particles: Particles, private skids: SkidMarks, private audio: GameAudio) {
    void assets;
    // shattered windows: a burst of glass and the crunch
    Vehicle.onGlassCrack = (_v, _pane, at) => {
      this.particles.impact(at.x, at.y, at.z, 0, 0.1, 0, 'glass', 0.5);
      this.audio.play('glass', { pos: at, volume: 0.35, pitch: 1.35 });
    };
    Vehicle.onGlassBreak = (_v, _pane, at) => {
      this.particles.impact(at.x, at.y, at.z, 0, 0.6, 0, 'glass', 2.2);
      this.particles.impact(at.x, at.y - 0.2, at.z, 0, -0.3, 0, 'glass', 1.5);
      this.audio.play('glass', { pos: at, volume: 0.8 });
    };
  }
  spawn(kind: VehicleKind, x: number, z: number, yaw: number, paintIndex = -1, y = 0.2): Vehicle {
    const v = new Vehicle(this.physics, kind, null, x, y, z, yaw, null, paintIndex);
    this.scene.add(v.group); this.list.push(v);
    return v;
  }
  remove(v: Vehicle) {
    const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1);
    this.engines.get(v.id)?.stop(); this.engines.delete(v.id);
    for (let i = 0; i < 8; i++) this.skids.end(v.id * 8 + i);
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
      if (imp > 4 && !v.destroyed) {
        const d = v.phys.impactDir;
        const pt = this.tmp.copy(v.position).add(new THREE.Vector3(-d.x, 0.4, -d.z).multiplyScalar(2));
        // sub-linear: ordinary knocks dent, only big hits wreck a car
        const dmg = Math.pow(imp - 3, 0.85) * 26;
        const destroyed = v.damage(dmg, pt.clone(), new THREE.Vector3(d.x, d.y, d.z), v.driver ?? v.lastDamagedBy);
        v.flashT = 0.15;
        this.particles.sparks(pt.x, pt.y, pt.z, Math.min(40, Math.floor(imp * 3)), 4 + imp);
        if (imp > 6) this.audio.play('glass', { pos: pt, volume: Math.min(1, imp / 14) });
        this.audio.play('crash', { pos: pt, volume: Math.min(1, imp / 12), pitch: 0.9 + Math.random() * 0.2 });
        const ev: CrashEvent = { vehicle: v, impact: imp, point: pt.clone() };
        this.onCrash?.(ev); for (const l of this.crashListeners) l(ev);
        void destroyed;
      }
      void time;
    }
  }
  update(dt: number, night: number, time: number, listener: THREE.Vector3, playerVehicle: Vehicle | null) {
    this.updateSkidAudio(playerVehicle);
    this.updatePlayerSiren(playerVehicle);
    for (const v of [...this.list]) {
      const braking = v.input.throttle < -0.1 && v.speed > 1;
      v.update(dt, night, time, braking || v.input.handbrake);
      // Deep water floods the engine: the car is lost and slowly sinks.
      if (!v.flooded && v.position.y < WATER_LEVEL - 0.2) {
        v.flooded = true; v.destroyed = true; v.health = 0; v.siren = false; v.burnTime = -1;
        v.phys.body.setLinearDamping(2.2); v.phys.body.setAngularDamping(2.2);
        const p = v.position; this.particles.splash(p.x, WATER_LEVEL, p.z, 30); this.audio.play('splash', { pos: p, volume: 1 });
      }
      const dist = v.position.distanceTo(listener);
      v.group.visible = dist < 260 || v === playerVehicle;
      v.bodyMesh.castShadow = dist < 60;
      v.updateLod(v === playerVehicle ? 0 : dist);
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
        } else if (v.burnTime < 0 && !v.flooded && Math.random() < 0.15 && dist < 150) { const p = this.hoodPoint(v); this.particles.smoke(p.x, p.y + 0.5, p.z, 0.9, 1.2); }
      }
      // Engine sound for nearby driven vehicles
      const hasEngine = !v.destroyed && v.ignition && (v.driver || v === playerVehicle) && dist < 70; // CAR-ENTRY: silent until hotwired
      let ev = this.engines.get(v.id);
      if (hasEngine) {
        if (!ev) { ev = this.audio.engine(); this.engines.set(v.id, ev); }
        ev.update({ rpm: v.phys.rpm, throttle: Math.abs(v.input.throttle), pos: v.position, kind: v.spec.sound ?? 'car', damage: 1 - frac });
      } else if (ev) { ev.stop(); this.engines.delete(v.id); }
    }
  }
  /** Tyre squeal for the player's car (loop) plus a screech one-shot when a slide starts. */
  private updateSkidAudio(pv: Vehicle | null) {
    const slip = pv && !pv.destroyed ? Math.max(...pv.phys.slip) : 0;
    const vol = Math.min(1, Math.max(0, (slip - 3) / 6));
    if (vol > 0.02 && pv) {
      if (!this.skidVoice) this.skidVoice = this.audio.skid();
      this.skidVoice.update(pv.position, vol);
      if (!this.skidWas && vol > 0.35) this.audio.play('tireScreech', { pos: pv.position, volume: vol });
      this.skidWas = true;
    } else {
      if (this.skidVoice) { this.skidVoice.stop(); this.skidVoice = null; }
      this.skidWas = false;
    }
  }
  private hoodPoint(v: Vehicle) { return v.tpl.hood.clone().applyMatrix4(v.group.matrixWorld); }
  explode(v: Vehicle) {
    const p = v.position.clone();
    this.particles.explosion(p.x, p.y + 0.5, p.z);
    this.audio.play('explosion', { pos: p, volume: 1 });
    v.phys.body.applyImpulse({ x: (Math.random() - 0.5) * v.spec.mass * 2, y: v.spec.mass * 7, z: (Math.random() - 0.5) * v.spec.mass * 2 }, true);
    v.phys.body.applyTorqueImpulse({ x: v.spec.mass * 2, y: 0, z: v.spec.mass * 1.5 }, true);
    for (const o of this.list) {
      if (o === v) continue;
      const d = o.position.distanceTo(p);
      if (d < 9) { o.damage((9 - d) * 60, p, o.position.clone().sub(p).normalize(), v.lastDamagedBy); const dir = o.position.clone().sub(p).normalize(); o.phys.body.applyImpulse({ x: dir.x * o.spec.mass * 4, y: o.spec.mass * 3, z: dir.z * o.spec.mass * 4 }, true); }
    }
    this.onExplode?.(v, p);
  }
  stopAllSounds() { for (const e of this.engines.values()) e.stop(); this.engines.clear(); this.skidVoice?.stop(); this.skidVoice = null; this.sirenVoice?.stop(); this.sirenVoice = null; }
}
