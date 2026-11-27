/** Owns every vehicle: spawning, crash handling, fire/explosions, skid marks and engine audio. */
import * as THREE from 'three';
import { addPooledLight, type LightPool } from '../render/lightPool';
import type { Physics } from '../core/physics';
import type { Assets } from '../world/assets';
import { Vehicle, barStrobe } from '../vehicles/vehicle';
import type { VehicleKind } from '../vehicles/specs';
import { WATER_LEVEL } from '../world/citymap';
import type { Particles, SkidMarks } from '../render/particles';
import type { GameAudio, EngineVoice, LoopVoice } from '../ui/contracts';

export interface CrashEvent { vehicle: Vehicle; impact: number; point: THREE.Vector3 }
/**
 * Headlight spot intensity and fall-off. Round 13 (owner, on an iPad: "headlights shine too bright when reflecting, it's hard
 * to see"): 420 cd with decay 1.1 lit the road 5-15x brighter than the street lights around it, and the glare off asphalt,
 * paint and glass blew out. Now a believable low beam: a pool a few times the street lighting near the car, fading by ~25 m.
 */
export const HEADLIGHT_CD = 190;
export const HEADLIGHT_DECAY = 1.45;
/** Road illuminance (renderer units) a headlight spot gives at `d` metres: what the tests hold to. */
export const headlightAt = (d: number) => HEADLIGHT_CD / Math.pow(Math.max(1, d), HEADLIGHT_DECAY);
export class VehicleManager {
  list: Vehicle[] = [];
  onCrash: ((e: CrashEvent) => void) | null = null;
  /** extra crash subscribers (traffic reacts to accidents) */
  crashListeners: ((e: CrashEvent) => void)[] = [];
  /** camera vertical FOV (deg) for screen-size LOD; a game.ts hook sets it each frame (62 = default) */
  lodFov = 62;
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
  /** called for every removed vehicle before its body is freed (managers drop their references: AI traffic, dispatch) */
  removeListeners: ((v: Vehicle) => void)[] = [];
  remove(v: Vehicle) {
    if (v.disposed) return; // double remove
    for (const l of this.removeListeners) l(v);
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
  private qInv = new THREE.Quaternion(); private tmp2 = new THREE.Vector3(); private tmp3 = new THREE.Vector3();
  /** After the physics step: crashes and damage. */
  postStep(time: number) {
    for (const v of this.list) {
      v.phys.postStep();
      const imp = v.phys.impact;
      if (imp > 4 && !v.destroyed) {
        const d = v.phys.impactDir;
        // contact: where the line from the centre towards the obstacle leaves the body box; metal moves the opposite way (into the car)
        const L = v.tpl.layout, zc = L.zCenter ?? 0, qi = this.qInv.copy(v.group.quaternion).invert();
        const dl = this.tmp2.set(d.x, 0, d.z).applyQuaternion(qi); if (dl.lengthSq() < 1e-4) dl.set(0, 0, 1);
        dl.normalize();
        const tt = Math.min(L.half[0] / Math.max(1e-3, Math.abs(dl.x)), L.half[2] / Math.max(1e-3, Math.abs(dl.z)));
        const lp = this.tmp3.set(dl.x * tt, L.centerY - L.half[1] + 0.55, zc + dl.z * tt);
        v.group.updateMatrixWorld(true);
        const pt = v.group.localToWorld(lp.clone());
        const into = new THREE.Vector3(-d.x, 0, -d.z).normalize();
        // sub-linear: ordinary knocks dent, only big hits wreck a car
        const dmg = Math.pow(imp - 3, 0.85) * 26;
        const destroyed = v.damage(dmg, pt.clone(), into, v.driver ?? v.lastDamagedBy, false);
        v.crumple(pt, into, Math.min(1.4, (imp - 2.5) / 8));
        v.flashT = 0.15;
        this.particles.sparks(pt.x, pt.y, pt.z, Math.min(40, Math.floor(imp * 3)), 4 + imp);
        if (imp > 6) this.audio.play('glass', { pos: pt, volume: Math.min(1, imp / 14) });
        const au = this.audio as unknown as { crash?: (i: number, p?: THREE.Vector3) => void }; if (au.crash) au.crash(imp / 12, pt); else this.audio.play('crash', { pos: pt, volume: Math.min(1, imp / 12), pitch: 0.9 + Math.random() * 0.2 }); // R6-A: one path per impact
        const ev: CrashEvent = { vehicle: v, impact: imp, point: pt.clone() };
        this.onCrash?.(ev); for (const l of this.crashListeners) l(ev);
        void destroyed;
      }
      void time;
    }
  }
  /**
   * Round 9 (owner: "police lights should shine in the dark just like headlights do and be brighter"): every strobing light
   * bar near the camera throws flashing red / blue pools on the road around the car (cheap additive decals, all presets), and
   * the nearest one also lights walls and cars with a real red + blue point light pair (Medium and up; count fixed per preset).
   */
  private barPools: { m: THREE.Mesh; side: 0 | 1 }[] = [];
  private barLights: THREE.PointLight[] = [];
  private barTex: THREE.Texture | null = null;
  private litBuf: Vehicle[] = [];
  private curHeadsBuf: (Vehicle | null)[] = [];
  private listSnap: Vehicle[] = [];
  private castBuf: { v: Vehicle; d: number }[] = [];
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private cullSphere = new THREE.Sphere();
  private cullCentre = new THREE.Vector3();
  setBarLightCount(n: number) {
    while (this.barLights.length < n * 2) { const l = new THREE.PointLight(this.barLights.length % 2 ? 0x2a5cff : 0xff2a1a, 0, 26, 1.6); l.castShadow = false; addPooledLight(this.scene, l, 2.5); this.barLights.push(l); }
    while (this.barLights.length > n * 2) { const l = this.barLights.pop()!; (this.scene.userData.lightPool as LightPool | undefined)?.remove(l); this.scene.remove(l); l.dispose(); }
  }
  private ensureBarPools() {
    if (this.barPools.length || typeof document === 'undefined') return;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.barTex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const side = (i % 2) as 0 | 1;
      const mat = new THREE.MeshBasicMaterial({ map: this.barTex, color: side ? 0x2050ff : 0xff2010, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true });
      const m = new THREE.Mesh(geo, mat); m.renderOrder = 2; m.frustumCulled = false; m.visible = false; this.scene.add(m); this.barPools.push({ m, side });
    }
  }
  private updateBarLights(night: number, time: number, listener: THREE.Vector3) {
    this.ensureBarPools();
    const lit = this.litBuf; lit.length = 0;
    for (const v of this.list) if (v.barOn && v.group.visible && v.position.distanceToSquared(listener) < 140 * 140) lit.push(v);
    if (lit.length > 1) lit.sort((a, b) => a.position.distanceToSquared(listener) - b.position.distanceToSquared(listener));
    const st = barStrobe(time), k = 0.25 + 0.75 * Math.min(1, night * 1.5);
    for (let i = 0; i < this.barPools.length; i++) {
      const pl = this.barPools[i], v = lit[i >> 1];
      if (!v) { pl.m.visible = false; continue; }
      const f = v.phys.forward(), sx = -f.z, sz = f.x, o = pl.side ? -1.6 : 1.6;
      pl.m.position.set(v.position.x + sx * o, v.position.y - v.phys.layout.half[1] + 0.06, v.position.z + sz * o);
      pl.m.scale.setScalar(9);
      (pl.m.material as THREE.MeshBasicMaterial).opacity = st[pl.side] * 0.55 * k;
      pl.m.visible = st[pl.side] > 0;
    }
    for (let i = 0; i < this.barLights.length; i++) {
      const l = this.barLights[i], v = lit[i >> 1], side = i % 2;
      if (!v) { l.intensity = 0; continue; }
      const f = v.phys.forward(), sx = -f.z, sz = f.x, o = side ? -0.5 : 0.5;
      l.position.set(v.position.x + sx * o, v.position.y + v.phys.layout.half[1] + 0.4, v.position.z + sz * o);
      l.intensity = st[side] * 260 * k;
    }
  }
  /** Max cars that cast shadows at once (nearest first); set from the graphics preset. */
  shadowBudget = 10;
  /** Round 7: real headlight spots (no shadows) for the player's car and the nearest lit cars; the count is fixed per
   * graphics preset (set by the game) so the light count never changes mid-play (no shader recompiles). */
  private heads: { l: THREE.SpotLight; t: THREE.Object3D; v: Vehicle | null; w: number }[] = [];
  setHeadlightCount(n: number) {
    while (this.heads.length < n) {
      const l = new THREE.SpotLight(0xfff0d8, 0, 45, 0.5, 0.6, HEADLIGHT_DECAY), t = new THREE.Object3D();
      l.target = t; l.castShadow = false; this.scene.add(l, t); this.heads.push({ l, t, v: null, w: 0 });
    }
    while (this.heads.length > n) { const h = this.heads.pop()!; this.scene.remove(h.l, h.t); h.l.dispose(); }
  }
  /**
   * Round 8: the few real headlight beams stick to their car and fade in/out (~0.3 s) instead of jumping between cars
   * every frame as distances changed (the road reflections flickered on and off at night).
   */
  private updateHeadlights(night: number, listener: THREE.Vector3, pv: Vehicle | null, dt: number) {
    if (!this.heads.length) return;
    const cur = this.curHeadsBuf;
    cur.length = this.heads.length;
    for (let i = 0; i < this.heads.length; i++) cur[i] = this.heads[i].v;
    const want = pickHeadlightCars(this.list, cur, listener, pv, this.heads.length);
    for (const h of this.heads) {
      if (h.v && !this.list.includes(h.v)) { h.v = null; h.w = 0; } // removed / despawned: its physics body is gone (reading it panicked)
      const keep = !!h.v && want.includes(h.v) && !h.v.destroyed;
      if (!keep) { h.w = Math.max(0, h.w - dt * 3.5); if (h.w === 0) h.v = null; }
      else h.w = Math.min(1, h.w + dt * 3.5);
    }
    for (const v of want) {
      let has = false;
      for (let i = 0; i < this.heads.length; i++) if (this.heads[i].v === v) { has = true; break; }
      if (has) continue;
      for (let i = 0; i < this.heads.length; i++) if (!this.heads[i].v) { this.heads[i].v = v; this.heads[i].w = 0; break; }
    }
    for (const h of this.heads) {
      const v = h.v;
      if (!v || night < 0.05) { h.l.intensity = 0; continue; }
      const f = v.phys.forward(), L = v.phys.layout, front = (L.half[2] ?? 2.2) + (L.zCenter ?? 0);
      h.l.position.set(v.position.x + f.x * front, v.position.y + 0.35, v.position.z + f.z * front);
      h.t.position.set(v.position.x + f.x * (front + 22), v.position.y - 1.2, v.position.z + f.z * (front + 22));
      h.l.intensity = HEADLIGHT_CD * Math.min(1, night * 1.6) * h.w * h.w * (3 - 2 * h.w);
    }
  }
  update(dt: number, night: number, time: number, listener: THREE.Vector3, playerVehicle: Vehicle | null, camera?: THREE.Camera) {
    this.updateHeadlights(night, listener, playerVehicle, dt);
    this.updateBarLights(night, time, listener);
    this.updateSkidAudio(playerVehicle);
    this.updatePlayerSiren(playerVehicle);
    if (camera) {
      this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projScreen);
    }
    const snap = this.listSnap;
    snap.length = this.list.length;
    for (let i = 0; i < this.list.length; i++) snap[i] = this.list[i];
    for (let si = 0; si < snap.length; si++) {
      const v = snap[si];
      const braking = v.input.throttle < -0.1 && v.speed > 1;
      v.update(dt, night, time, braking || v.input.handbrake);
      // Deep water floods the engine: the car is lost and slowly sinks.
      if (!v.flooded && v.position.y < WATER_LEVEL - 0.2) {
        v.flooded = true; v.destroyed = true; v.health = 0; v.siren = false; v.burnTime = -1;
        v.phys.body.setLinearDamping(2.2); v.phys.body.setAngularDamping(2.2);
        const p = v.position; this.particles.splash(p.x, WATER_LEVEL, p.z, 30); this.audio.play('splash', { pos: p, volume: 1 });
      }
      const dist = v.position.distanceTo(listener);
      const inDist = dist < 260 || v === playerVehicle;
      const inView = !camera || v === playerVehicle || dist < 50 || this.frustum.intersectsSphere(this.cullSphere.set(this.cullCentre.set(v.position.x, v.position.y + 1, v.position.z), 6));
      v.group.visible = inDist && inView;
      v.bodyMesh.castShadow = v.group.visible && dist < 44;
      v.updateLod(v === playerVehicle ? 0 : dist, this.lodFov);
      // Skid marks + tyre smoke
      const c = v.phys.ctrl;
      for (let i = 0; i < v.tpl.layout.wheels.length; i++) {
        const slip = v.phys.slip[i];
        const id = v.id * 8 + i;
        if (slip > 3.2 && dist < 120) {
          const cp = c.wheelContactPoint(i);
          if (cp) {
            this.skids.add(id, cp.x, cp.y, cp.z, Math.min(1, (slip - 3) / 5));
            const driftIntensity = Math.min(2, (slip - 3) / 4);
            if (Math.random() < (slip > 5.5 ? 0.62 : 0.35) && dist < 68) this.particles.tireSmoke(cp.x, cp.y, cp.z, v.phys.body.linvel().x, v.phys.body.linvel().z, driftIntensity);
          }
        } else this.skids.end(id);
      }
      // Performance exhaust backfire on high-RPM upshifts / rapid throttle lifts
      if (v.backfireTriggered) {
        v.backfireTriggered = false;
        if (dist < 75 && v.group.visible && !v.destroyed) {
          const fwd = v.phys.forward(), L = v.tpl.layout;
          const rear = (L.half[2] ?? 2.1) - (L.zCenter ?? 0) + 0.08;
          const exY = v.position.y - L.half[1] + 0.34;
          const sx = -fwd.z, sz = fwd.x;
          for (const side of [-0.46, 0.46]) {
            const exX = v.position.x - fwd.x * rear + sx * side;
            const exZ = v.position.z - fwd.z * rear + sz * side;
            this.particles.backfire(exX, exY, exZ, -fwd.x, 0.05, -fwd.z);
          }
          this.audio.play('ricochet', { pos: v.position, volume: v === playerVehicle ? 0.24 : 0.11, pitch: 0.34 + Math.random() * 0.08 });
        }
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
    snap.length = 0;
    // shadow caster budget: only the nearest few cars are drawn into the shadow map
    const cast = this.castBuf; let cn = 0;
    for (const v of this.list) if (v.bodyMesh.castShadow) {
      const e = cast[cn] ?? (cast[cn] = { v, d: 0 });
      e.v = v; e.d = v.position.distanceToSquared(listener); cn++;
    }
    if (cn > this.shadowBudget) {
      for (let i = 1; i < cn; i++) {
        const cur = cast[i]; let j = i - 1;
        while (j >= 0 && cast[j].d > cur.d) { cast[j + 1] = cast[j]; j--; }
        cast[j + 1] = cur;
      }
      for (let i = this.shadowBudget; i < cn; i++) cast[i].v.bodyMesh.castShadow = false;
    }
  }
  /** Tyre squeal for the player's car (loop) plus a screech one-shot when a slide starts. */
  private updateSkidAudio(pv: Vehicle | null) {
    let slip = 0;
    if (pv && !pv.destroyed) {
      const sl = pv.phys.slip;
      for (let i = 0; i < sl.length; i++) if (sl[i] > slip) slip = sl[i];
    }
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

/**
 * Round 8: which lit cars get the real headlight beams: the player's car first, then the nearest within 90 m. A car that
 * already has a beam keeps it until another is clearly nearer (35 % margin), so the beams don't hop between two cars at
 * similar distances. Pure (tests).
 */
export function pickHeadlightCars<V extends { headOn: boolean; destroyed: boolean; position: { distanceToSquared(p: THREE.Vector3): number } }>(
  cars: V[], current: (V | null)[], listener: THREE.Vector3, pv: V | null, n: number): V[] {
  const score = (v: V) => v === pv ? -1 : v.position.distanceToSquared(listener) * (current.includes(v) ? 0.55 : 1);
  return cars.filter(v => v.headOn && !v.destroyed && v.position.distanceToSquared(listener) < 90 * 90).sort((a, b) => score(a) - score(b)).slice(0, n);
}
