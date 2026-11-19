/** Police escalation by stars: which units are on the street, their crews, the tank, the helicopter and the handcuff arrest. */
import * as THREE from 'three';
import type { Population } from './population';
import type { Traffic, AiCar } from './traffic';
import type { Character } from '../actors/character';
import type { Npc } from '../actors/npc';
import type { Look } from '../actors/look';
import type { CityMap } from '../world/citymap';
import { samplePath } from '../world/citymap';
import type { WeaponId } from '../combat/weapons';
import { WEAPONS } from '../combat/weapons';
import type { Combat } from '../combat/combat';
import type { CameraRig } from './camera';
import type { Helicopter } from '../vehicles/helicopter';
import type { Vehicle } from '../vehicles/vehicle';

export type UnitKind = 'police' | 'fbi' | 'swat' | 'army' | 'tank';
export const UNIT_KINDS: UnitKind[] = ['police', 'fbi', 'swat', 'army', 'tank'];

/** How many vehicles of each kind a wanted level calls in (kept small for performance). */
export function wantedUnits(heat: number): Record<UnitKind, number> {
  const h = Math.max(0, Math.min(5, Math.round(heat)));
  return {
    police: h === 0 ? 0 : h === 1 ? 2 : h === 2 ? 3 : h === 3 ? 3 : h === 4 ? 2 : 2,
    swat: h >= 3 ? (h === 3 ? 1 : h === 4 ? 1 : 1) : 0,
    fbi: h >= 4 ? 2 : 0,
    army: h >= 5 ? 2 : 0,
    tank: h >= 5 ? 1 : 0,
  };
}
export const wantsHelicopter = (heat: number) => heat >= 4;

const BASE = { skin: '#c68c63', hair: '#2a2420', shoes: '#151515', sleeves: 'short' as const, legs: 'pants' as const, hairStyle: 'short' as const, height: 1 };
export const COP_LOOK: Look = { ...BASE, top: '#2c3e5c', bottom: '#1e2738', hat: '#1e2738', detail: '#d9b44a', hatStyle: 'police', build: 1.04 };
const FBI_LOOK: Look = { ...BASE, top: '#14161b', bottom: '#14161b', hat: '#14161b', detail: '#e8e8e8', hatStyle: 'none', topStyle: 'suit', accent: '#f2f2f2', sleeves: 'long', build: 1.06 };
const SWAT_LOOK: Look = { ...BASE, top: '#1c222b', bottom: '#181d25', hat: '#11151b', detail: '#8d96a3', hatStyle: 'cap', topStyle: 'jacket', sleeves: 'long', shoeStyle: 'boots', build: 1.14 };
const ARMY_LOOK: Look = { ...BASE, top: '#5b6340', bottom: '#4e5636', hat: '#454c2f', detail: '#2f3520', hatStyle: 'cap', topStyle: 'jacket', sleeves: 'long', shoeStyle: 'boots', build: 1.1 };
export const LOOK_OF: Record<UnitKind, Look> = { police: COP_LOOK, fbi: FBI_LOOK, swat: SWAT_LOOK, army: ARMY_LOOK, tank: ARMY_LOOK };
const CREW: Record<UnitKind, number> = { police: 0, fbi: 2, swat: 3, army: 3, tank: 0 };
const GEAR: Record<UnitKind, { armor: number; hp: number }> = { police: { armor: 45, hp: 100 }, fbi: { armor: 60, hp: 110 }, swat: { armor: 100, hp: 140 }, army: { armor: 100, hp: 150 }, tank: { armor: 0, hp: 100 } };

export function weaponFor(kind: UnitKind, heat: number): WeaponId {
  const r = Math.random();
  switch (kind) {
    case 'fbi': return r < 0.5 ? 'smg' : 'rifle';
    case 'swat': return r < 0.7 ? 'rifle' : 'shotgun';
    case 'army': case 'tank': return r < 0.75 ? 'rifle' : 'shotgun';
    default: return heat <= 1 ? 'fists' : heat === 2 ? 'pistol' : heat === 3 ? (r < 0.5 ? 'smg' : 'pistol') : (r < 0.5 ? 'rifle' : 'smg');
  }
}

export interface DispatchHooks {
  combat: Combat; cam: CameraRig;
  dragOut(v: Vehicle, side: 1 | -1, puller: Character): boolean;
  busted(): void;
  spawnHeli(x: number, z: number, yaw: number): Helicopter;
  removeHeli(h: Helicopter): void;
  night(): number;
}

interface Arrest { cop: Npc; t: number; done: (() => void) | null; finished: boolean; phase: number; yaw: number; from: THREE.Vector3 }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Dispatch {
  hooks: DispatchHooks | null = null;
  kinds = new Map<AiCar, UnitKind>();
  crew = new Map<AiCar, Npc[]>();
  footKind = new WeakMap<Npc, UnitKind>();
  heli: Helicopter | null = null;
  arrest: Arrest | null = null;
  /** cop -> seconds the player's stopped car has been surrounded */
  dragT = 0;
  pendingArrest: { cop: Npc; t: number } | null = null;
  private lanes: CityMap['lanes'] = [];
  private tankCd = new Map<AiCar, number>();
  private light: THREE.SpotLight | null = null; private beam: THREE.Mesh | null = null; private lightTarget = new THREE.Object3D();
  constructor(private city: CityMap, private pop: Population, private traffic: Traffic, private scene: THREE.Scene) { }

  kindOf(car: AiCar): UnitKind { return this.kinds.get(car) ?? 'police'; }
  /** The unit kind that is missing for this wanted level, or null. */
  nextNeeded(units: AiCar[], heat: number, extra = 0): UnitKind | null {
    const want = wantedUnits(heat);
    want.police += extra;
    if (units.length >= 8 + extra) return null;
    // most serious first so the tank and the SWAT van are not starved by cruisers
    for (const k of ['tank', 'army', 'swat', 'fbi', 'police'] as UnitKind[]) if (units.filter(u => this.kindOf(u) === k).length < want[k]) return k;
    return null;
  }

  /** Spawns one unit of `kind` out of view on a road heading to the target (or null when no lane was found). */
  spawnUnit(kind: UnitKind, target: THREE.Vector3, camera: THREE.Camera, heat: number): AiCar | null {
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const sp = { x: 0, z: 0, dx: 0, dz: 0 };
    if (!this.lanes.length) this.lanes = this.city.lanes.filter(l => !l.connector && l.length >= 30);
    for (let tries = 0; tries < 60; tries++) {
      const lane = this.lanes[Math.floor(Math.random() * this.lanes.length)];
      const s = 10 + Math.random() * (lane.length - 20);
      samplePath(lane, s, sp);
      const p = new THREE.Vector3(sp.x, 1, sp.z);
      const d = p.distanceTo(target);
      if (d < 60 || d > 170) continue;
      if (frustum.containsPoint(p) && d < 100 && tries < 40) continue;
      if ((target.x - sp.x) * sp.dx + (target.z - sp.z) * sp.dz < 0) continue;
      const car = this.traffic.spawnOnLane(kind, lane, s, 'pursuit', 'police', LOOK_OF[kind]);
      car.persistent = true; car.v.persistent = true; car.target = target.clone();
      this.kinds.set(car, kind);
      this.gear(car.driver, kind, heat);
      const crew: Npc[] = [];
      const seats = car.v.tpl.seats.length;
      for (let i = 1; i <= CREW[kind] && i < seats; i++) {
        const n = this.pop.spawn('police', sp.x, sp.z, 0.5, LOOK_OF[kind]);
        this.traffic.seat(n, car.v, i); this.gear(n, kind, heat); crew.push(n);
      }
      car.passengers = crew; this.crew.set(car, crew);
      if (kind === 'tank') { car.ram = true; car.maxSpeed = 15; }
      return car;
    }
    return null;
  }
  gear(n: Npc, kind: UnitKind, heat: number) {
    const g = GEAR[kind]; n.char.maxHealth = g.hp; n.char.health = g.hp; n.char.armor = g.armor;
    this.footKind.set(n, kind);
    const w = weaponFor(kind, heat); n.weapon = w; n.clip = WEAPONS[w].clip;
  }
  /** Gives an officer who just left a vehicle (or was spawned on foot) a weapon model and combat orders. */
  arm(n: Npc, kind: UnitKind, heat: number, lethal: boolean) {
    if (!this.footKind.has(n)) this.gear(n, kind, heat);
    const k = this.footKind.get(n) ?? kind;
    n.arm(n.weapon === 'fists' && k !== 'police' ? weaponFor(k, heat) : n.weapon, this.scene);
    n.brain = lethal ? 'combat' : 'chase'; n.persistent = true; n.stateT = 0;
  }
  /** Everyone in the unit steps out. Returns the officers (driver first). */
  bail(car: AiCar, side: 1 | -1 = 1): Npc[] {
    const out: Npc[] = [];
    const cop = this.traffic.eject(car, car.v, side); if (cop) out.push(cop);
    for (const n of this.crew.get(car) ?? []) if (n.alive && n.char.inVehicle === car.v) { this.traffic.ejectPassenger(n, car.v); out.push(n); }
    this.crew.delete(car); car.passengers = [];
    car.v.siren = true; car.v.persistent = false;
    return out;
  }

  /** Crew that left a unit by themselves (the car was shot up or wrecked) still join the fight. */
  collectCrew(): Npc[] {
    const out: Npc[] = [];
    for (const [car, crew] of this.crew) for (const n of crew) if (n.alive && n.char.inVehicle !== car.v) { out.push(n); }
    return out;
  }
  /** The tank turns its turret onto the player and fires shells. */
  updateTank(car: AiCar, player: Character, dt: number) {
    const v = car.v, h = this.hooks; if (!h || v.destroyed) return;
    const from = v.position.clone(); from.y += 2.3;
    const to = player.inVehicle ? (player.inVehicle as { position: THREE.Vector3 }).position.clone() : player.pos.clone();
    to.y += 1;
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
    const yaw = wrap(Math.atan2(dx, dz) - v.yaw), pitch = Math.atan2(to.y - from.y, Math.max(d, 1)) * 0.6;
    v.setTurret(yaw, pitch);
    let cd = (this.tankCd.get(car) ?? 3) - dt;
    if (cd <= 0 && d < 95 && d > 10 && Math.abs(wrap(yaw - v.turretYaw)) < 0.15 && this.pop.runner.hasLOS(from, to)) {
      const dir = new THREE.Vector3(dx, to.y - from.y, dz).normalize();
      const origin = from.clone().addScaledVector(dir, 4.2);
      h.combat.launch(car.driver.char, WEAPONS.rpg, origin, dir, 0.004);
      h.cam.addShake(0.15);
      cd = 5.5;
    }
    this.tankCd.set(car, cd);
  }

  // ------------------------------------------------------------------------------------------------ helicopter
  updateHeli(dt: number, player: Character, heat: number, active: boolean, vsHeli = false) {
    const h = this.hooks; if (!h) return;
    if (this.heli && (this.heli.destroyed || !this.pop || !active)) {
      if (!active || this.heli.destroyed) { this.dropHeli(); }
    }
    if (active && !this.heli) {
      const a = Math.random() * Math.PI * 2;
      this.heli = h.spawnHeli(player.pos.x + Math.sin(a) * 90, player.pos.z + Math.cos(a) * 90, a + Math.PI);
      const b = this.heli; b.engineOn = true; b.rotor = 1; b.persistent = true;
      b.teleport(b.position.x, player.pos.y + 45, b.position.z, a + Math.PI);
      this.ensureLight();
    }
    const b = this.heli; if (!b) return;
    const pos = b.position, pp = player.inVehicle ? (player.inVehicle as { position: THREE.Vector3 }).position : player.pos;
    const dx = pp.x - pos.x, dz = pp.z - pos.z, d = Math.hypot(dx, dz);
    const err = wrap(Math.atan2(dx, dz) - b.yaw);
    b.input.yaw = THREE.MathUtils.clamp(err * 1.6, -1, 1);
    b.input.pitch = d > 28 && Math.abs(err) < 0.9 ? THREE.MathUtils.clamp((d - 28) / 50, 0.1, 1) : (d < 14 ? -0.25 : 0);
    b.input.lift = THREE.MathUtils.clamp((pp.y + (vsHeli ? 10 : 42) - pos.y) * 0.25, -1, 1);
    // searchlight
    const night = h.night();
    if (this.light && this.beam) {
      const on = night > 0.25 && !b.destroyed;
      // the light stays in the scene (a changing light count recompiles every material = a hitch); intensity does the on/off
      this.light.intensity = on ? 170 : 0; this.beam.visible = on;
      if (on) {
        const from = pos.clone(); from.y -= 1.2;
        this.light.position.copy(from); this.lightTarget.position.copy(pp);
        const dir = pp.clone().sub(from), len = dir.length(); dir.normalize();
        this.beam.position.copy(from).addScaledVector(dir, len / 2);
        this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
        this.beam.scale.set(len * 0.05, len, len * 0.05);
        (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.045 * Math.min(1, night * 1.5);
      }
    }
    void dt; void heat;
  }
  private footFireT = new Map<Npc, number>();
  private heliBurst = 0; private heliGunT = 2; private heliRocketT = 7;
  private tmpC = new THREE.Vector3(); private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3();
  /**
   * The player stole a helicopter: officers on the ground and the police helicopter shoot it down (real hit-scan bullets
   * and rockets through combat, so the damage -> smoke -> crash chain of Helicopter applies).
   */
  attackHeli(dt: number, ph: Helicopter, foot: Npc[], heat: number) {
    const h = this.hooks; if (!h || ph.destroyed) return;
    const aim = this.tmpA.copy(ph.position);
    for (const n of foot) {
      if (!n.alive || n.weapon === 'fists' || n.char.inVehicle) continue;
      let t = (this.footFireT.get(n) ?? Math.random() * 1.5) - dt;
      if (t <= 0) {
        const w = WEAPONS[n.weapon];
        t = (w.auto ? 0.45 : 1.0) + Math.random() * 0.9;
        const from = this.tmpB.set(n.pos.x, n.pos.y + 1.4, n.pos.z);
        const dist = from.distanceTo(aim);
        if (dist < 100 && dist > 6 && this.pop.runner.hasLOS(from, this.tmpC.copy(aim).sub(from).multiplyScalar(1 - 5 / dist).add(from))) { // stop short: the helicopter's own collider would block the ray
          const dir = aim.clone().sub(from).normalize();
          const e = 0.01 + dist * 0.0012;
          dir.x += (Math.random() - 0.5) * e; dir.y += (Math.random() - 0.5) * e; dir.z += (Math.random() - 0.5) * e; dir.normalize();
          n.char.yaw = Math.atan2(dir.x, dir.z);
          h.combat.shoot(n.char, w, from, dir, w.aimSpread);
          // tracer bullets alone rarely connect with a moving target: a share of shots count as hits
          if (Math.random() < (heat >= 5 ? 0.2 : heat === 4 ? 0.1 : 0.05)) ph.damage(w.damage * 0.8, aim.clone(), dir, n.char);
        }
      }
      this.footFireT.set(n, t);
    }
    const heli = this.heli;
    if (heli && !heli.destroyed) {
      const shooter = foot.find(n => n.alive)?.char ?? this.pop.npcs.find(n => n.alive && n.role === 'police')?.char;
      if (shooter) {
        const from = heli.position.clone(); from.y -= 1;
        const dir = aim.clone().sub(from); const dist = dir.length(); dir.normalize();
        this.heliGunT -= dt;
        if (this.heliBurst <= 0 && this.heliGunT <= 0 && dist < 130) { this.heliBurst = 6; this.heliGunT = 1.8; }
        if (this.heliBurst > 0 && (this.heliBurst -= dt * 9) > 0) {
          dir.x += (Math.random() - 0.5) * 0.03; dir.y += (Math.random() - 0.5) * 0.03; dir.z += (Math.random() - 0.5) * 0.03; dir.normalize();
          h.combat.shoot(shooter, WEAPONS.rifle, from, dir, WEAPONS.rifle.aimSpread);
        }
        this.heliRocketT -= dt;
        if (heat >= 4 && this.heliRocketT <= 0 && dist < 140 && dist > 20) {
          this.heliRocketT = 9;
          h.combat.launch(shooter, WEAPONS.rpg, from, dir, 0.01);
        }
      }
    }
  }
  private ensureLight() {
    if (this.light) return;
    const l = new THREE.SpotLight('#eaf4ff', 170, 120, 0.075, 0.85, 1.6);
    l.castShadow = false; l.target = this.lightTarget; l.intensity = 0;
    this.scene.add(l, this.lightTarget);
    const g = new THREE.CylinderGeometry(0.12, 1, 1, 18, 1, true);
    const m = new THREE.MeshBasicMaterial({ color: '#dfeeff', transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(g, m); beam.frustumCulled = false; beam.visible = false; this.scene.add(beam);
    this.light = l; this.beam = beam;
  }
  dropHeli() {
    if (this.heli) { this.heli.input.pitch = 0; this.heli.input.yaw = 0; this.heli.input.lift = 0.3; this.heli.persistent = false; this.hooks?.removeHeli(this.heli); this.heli = null; }
    if (this.light && this.beam) { this.light.intensity = 0; this.beam.visible = false; }
  }

  // ------------------------------------------------------------------------------------------------ foot orders
  shout(_n: Npc, _line: 'cop' = 'cop') { /* NPC voices removed */ }

  // ------------------------------------------------------------------------------------------------ arrest
  get arresting() { return this.arrest !== null; }
  /** The cop is next to a slow, non-violent player on foot: hands up, kneel, cuffs, then the ARRESTED card. */
  beginArrest(cop: Npc, player: Character) {
    if (this.arrest || !this.hooks) return;
    const yaw = Math.atan2(player.pos.x - cop.pos.x, player.pos.z - cop.pos.z);
    this.arrest = { cop, t: 0, done: null, finished: false, phase: 0, yaw, from: cop.pos.clone() };
    cop.brain = 'scripted'; cop.stateT = 0; cop.char.human.setSpeed(0);
    this.hooks.busted(); // sets the death flow (the card waits for our animation hook)
    player.human.setState('crouch');
    this.frame(player);
  }
  /** Wired to g.events.arrestAnimationDone. */
  animHook = (done: () => void) => {
    const a = this.arrest;
    if (!a) { done(); return; }
    if (a.finished) done(); else a.done = done;
  };
  private frame(player: Character) {
    const a = this.arrest, h = this.hooks; if (!a || !h) return;
    const side = new THREE.Vector3(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
    h.cam.cinematic = {
      pos: player.pos.clone().addScaledVector(side, 3.3).addScaledVector(new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)), -1.4).setY(player.pos.y + 1.45),
      look: player.pos.clone().setY(player.pos.y + 0.95),
    };
  }
  updateArrest(dt: number, player: Character) {
    const a = this.arrest; if (!a) return;
    a.t += dt;
    player.health = player.maxHealth; // nobody shoots a suspect who is being cuffed
    const cop = a.cop, ph = player.human, ch = cop.char.human;
    player.yaw = a.yaw; ph.root.rotation.y = a.yaw;
    const behind = player.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)), -0.8);
    if (a.t < 0.15 && a.phase === 0) { a.phase = 1; ph.playAction('hands_up'); this.shout(cop); }
    if (a.t >= 0.9 && a.phase === 1) { a.phase = 2; ph.playAction('kneel'); }
    // the officer steps round to stand right behind the kneeling suspect
    const k = THREE.MathUtils.smoothstep(a.t, 0.4, 1.6);
    cop.char.place(THREE.MathUtils.lerp(a.from.x, behind.x, k), player.pos.y, THREE.MathUtils.lerp(a.from.z, behind.z, k), a.yaw);
    if (a.t >= 1.7 && a.phase === 2) { a.phase = 3; ch.playAction('cuffing'); }
    if (a.t >= 2.4 && a.phase === 3) { a.phase = 4; ph.stopAction('hands_up'); ph.playAction('handcuffed'); }
    if (a.t >= 3.3 && !a.finished) { a.finished = true; const d = a.done; a.done = null; d?.(); }
    this.frame(player);
  }
  /** Called when the arrest scene is over (respawn). */
  endArrest(player?: Character) {
    if (player) { player.human.stopAction('kneel'); player.human.stopAction('handcuffed'); player.human.stopAction('hands_up'); }
    if (this.arrest) { this.arrest.cop.brain = 'idle'; this.arrest = null; }
    if (this.hooks) this.hooks.cam.cinematic = null;
    this.pendingArrest = null; this.dragT = 0;
  }

  /** Despawns everything the dispatch owns. */
  standDown() {
    this.kinds.clear(); this.crew.clear(); this.tankCd.clear(); this.footFireT.clear();
    this.dropHeli();
    if (!this.arrest) { this.pendingArrest = null; this.dragT = 0; }
  }
}
