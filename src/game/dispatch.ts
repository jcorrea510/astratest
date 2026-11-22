/** Police escalation by stars: which units are on the street, their crews, the tank, the helicopter and the handcuff arrest. */
import * as THREE from 'three';
import type { Population } from './population';
import type { Traffic, AiCar } from './traffic';
import type { Character } from '../actors/character';
import type { Npc } from '../actors/npc';
import type { Look } from '../actors/look';
import type { CityMap } from '../world/citymap';
import { samplePath, nearestLane, ARMY_BASE } from '../world/citymap';
import { POLICE_STATION } from './places';
import { helipadList } from '../vehicles/helicopterManager';
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
  /** one-shot world sound at a position (taser) */
  sfx?(name: 'taser', at: THREE.Vector3): void;
}

interface Arrest { base: THREE.Vector3; cop: Npc; t: number; done: (() => void) | null; finished: boolean; phase: number; yaw: number; from: THREE.Vector3; tase: boolean; pre: number; zapped: boolean; fromSet: boolean; shock: number }
/** Seconds the taser phase of an on-foot arrest lasts (fire, convulse, drop to the knees) before the officer walks up to cuff. */
export const TASE_T = 1.6; // Round 8: quicker (the whole arrest took up to ~9 s)
/** A police helicopter appears at least this far from the player (and at most this far; a further pad is reached by flying). */
/** Reinforcement cars spawn at least this many metres from the player and the camera, outside the view. */
export const REINFORCE_MIN = 120;
export const HELI_MIN_DIST = 380, HELI_MAX_DIST = 700;
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
  constructor(private city: CityMap, private pop: Population, private traffic: Traffic, private scene: THREE.Scene) { this.ensureLight(); } // Round 8: the searchlight exists from the start (adding a light mid-game recompiles every shader)

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

  /** Where a unit of this kind starts: army/tank at the Fort Calder gate, SWAT/FBI at the precinct, police alternate precinct / patrol. */
  originLane(kind: UnitKind): { lane: CityMap['lanes'][number]; s: number } | null {
    const gate = kind === 'army' || kind === 'tank';
    const at = gate ? { x: ARMY_BASE.x1, z: ARMY_BASE.gateZ } : POLICE_STATION;
    const key = gate ? 'gate' : 'precinct';
    let o = this.originCache.get(key);
    if (!o) { const n = nearestLane(this.city, at.x, at.z, false); if (n) { o = { lane: n.lane, s: n.s }; this.originCache.set(key, o); } }
    return o ?? null;
  }
  private originCache = new Map<string, { lane: CityMap['lanes'][number]; s: number }>();
  private spawnCount = 0;
  /** Seconds a unit of this kind needs from its origin to the target at ~18 m/s along the road (straight line x1.3); for tests/HUD. */
  eta(kind: UnitKind, target: THREE.Vector3): number {
    const o = this.originLane(kind); if (!o) return 0;
    const sp = { x: 0, z: 0, dx: 0, dz: 0 }; samplePath(o.lane, o.s, sp);
    return Math.hypot(sp.x - target.x, sp.z - target.z) * 1.3 / 18;
  }

  /**
   * Spawns one unit of `kind`. `origin` 'base' (default) starts it where it really comes from (precinct, patrol area or Fort Calder's gate)
   * and it drives to the target; 'near' drops it out of view close to the target (sandbox).
   */
  spawnUnit(kind: UnitKind, target: THREE.Vector3, camera: THREE.Camera, heat: number, origin: 'base' | 'near' = 'base'): AiCar | null {
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const sp = { x: 0, z: 0, dx: 0, dz: 0 };
    if (!this.lanes.length) this.lanes = this.city.lanes.filter(l => !l.connector && l.length >= 30);
    let useOrigin = origin === 'base' && !!this.originLane(kind) && (kind !== 'police' || (this.spawnCount++ % 2 === 0));
    const cam = camera.position;
    /** reinforcements never appear where the player can see them or near him: behind the view and at least REINFORCE_MIN away */
    const hidden = (x: number, z: number) => {
      const pt = new THREE.Vector3(x, 1, z);
      return Math.hypot(x - target.x, z - target.z) >= REINFORCE_MIN && Math.hypot(x - cam.x, z - cam.z) >= REINFORCE_MIN
        && !frustum.containsPoint(pt) && !frustum.containsPoint(pt.setY(6));
    };
    for (let tries = 0; tries < 80; tries++) {
      let lane: CityMap['lanes'][number], s: number;
      if (useOrigin) {
        const o = this.originLane(kind)!; lane = o.lane; s = o.s;
        // keep convoy cars apart: slide back along the lane until the spot is free
        for (let k = 0; k < 8; k++) { samplePath(lane, Math.max(2, s), sp); if (!this.traffic.cars.some(c => Math.hypot(c.v.position.x - sp.x, c.v.position.z - sp.z) < 9)) break; s -= 11; if (s < 2) { s = o.s + 11 * (k + 1); if (s > lane.length - 2) break; } }
        s = Math.max(2, Math.min(lane.length - 2, s));
        samplePath(lane, s, sp);
        if (!hidden(sp.x, sp.z)) { useOrigin = false; continue; } // the station / gate is in view or next to the player: the unit is already out on patrol, coming from afar
      } else if (origin === 'base') { // a unit from the far side of town
        lane = this.lanes[Math.floor(Math.random() * this.lanes.length)];
        s = 10 + Math.random() * (lane.length - 20);
        samplePath(lane, s, sp);
        const d = Math.hypot(sp.x - target.x, sp.z - target.z);
        if (tries < 70 ? (d < (kind === 'police' ? 220 : 160) || d > 480 || !hidden(sp.x, sp.z)) : !hidden(sp.x, sp.z)) continue;
      } else {
        lane = this.lanes[Math.floor(Math.random() * this.lanes.length)];
        s = 10 + Math.random() * (lane.length - 20);
        samplePath(lane, s, sp);
        const p = new THREE.Vector3(sp.x, 1, sp.z);
        const d = p.distanceTo(target);
        if (d < 60 || d > 170) continue;
        if (frustum.containsPoint(p) && d < 100 && tries < 70) continue;
        if ((target.x - sp.x) * sp.dx + (target.z - sp.z) * sp.dz < 0) continue;
      }
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
    const v = car.v, h = this.hooks; if (!h || v.destroyed || this.arrest) return;
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
  /**
   * Where a police helicopter enters the scene: along the bearing from the player to the precinct air unit, at least HELI_MIN_DIST away
   * (further when the pad itself is further), never inside the camera frustum. Pure given the inputs; unit tested.
   */
  heliSpawnPoint(player: THREE.Vector3, camera?: THREE.Camera, rand = Math.random): THREE.Vector3 {
    const pad = helipadList().find(p => p.variant === 'police') ?? { x: POLICE_STATION.x, z: POLICE_STATION.z };
    const bx = pad.x - player.x, bz = pad.z - player.z, pd = Math.hypot(bx, bz);
    const base = pd > 1 ? Math.atan2(bx, bz) : rand() * Math.PI * 2;
    const dist = Math.min(HELI_MAX_DIST, Math.max(HELI_MIN_DIST, pd));
    let frustum: THREE.Frustum | null = null;
    if (camera) { camera.updateMatrixWorld(); frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); }
    const out = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      const a = base + (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.45);
      out.set(player.x + Math.sin(a) * dist, player.y + 55, player.z + Math.cos(a) * dist);
      if (!frustum || !frustum.containsPoint(out)) break;
    }
    return out;
  }
  updateHeli(dt: number, player: Character, heat: number, active: boolean, vsHeli = false, camera?: THREE.Camera) {
    const h = this.hooks; if (!h) return;
    if (this.heli && (this.heli.destroyed || !this.pop || !active)) {
      if (!active || this.heli.destroyed) { this.dropHeli(); }
    }
    if (active && !this.heli) {
      // it comes from the precinct air unit: it appears far out (outside the view) already on its way in, never on top of the player
      const sp = this.heliSpawnPoint(player.pos, camera), yaw = Math.atan2(player.pos.x - sp.x, player.pos.z - sp.z);
      this.heli = h.spawnHeli(sp.x, sp.z, yaw);
      const b = this.heli; b.engineOn = true; b.rotor = 1; b.persistent = true;
      b.teleport(sp.x, sp.y, sp.z, yaw);
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
  private tmpC = new THREE.Vector3(); private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3();
  /**
   * The player stole a helicopter: officers on the ground and the police helicopter shoot it down (real hit-scan bullets
   * and rockets through combat, so the damage -> smoke -> crash chain of Helicopter applies).
   */
  attackHeli(dt: number, ph: Helicopter, foot: Npc[], heat: number) {
    const h = this.hooks; if (!h || ph.destroyed || this.arrest) return;
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
    // the police helicopter is a spotter: searchlight and radio only, it never fires (see updateHeli)
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
  /**
   * A non-violent player on foot is arrested. `tase` (default): the officer, who may still be several metres away, fires a taser
   * (wire + crackle + convulsing stun, then the suspect drops to the knees), walks up, and only then hands up / kneel / cuffs / the
   * ARRESTED card. Without `tase` (dragged out of a car) the cuffing starts at once. Everyone else holds fire for the whole scene.
   */
  beginArrest(cop: Npc, player: Character, tase = true) {
    if (this.arrest || !this.hooks) return;
    const yaw = Math.atan2(player.pos.x - cop.pos.x, player.pos.z - cop.pos.z);
    const dist = Math.hypot(player.pos.x - cop.pos.x, player.pos.z - cop.pos.z);
    const approach = tase ? Math.min(1.6, Math.max(0, (dist - 1.3) / 4.5)) : 0;
    this.arrest = { base: player.pos.clone(), cop, t: 0, done: null, finished: false, phase: 0, yaw, from: cop.pos.clone(), tase, pre: tase ? TASE_T + approach : 0, zapped: false, fromSet: !tase, shock: 0 };
    cop.brain = 'scripted'; cop.stateT = 0; cop.char.human.setSpeed(0);
    this.hooks.busted(); // sets the death flow (the card waits for our animation hook)
    player.vel.set(0, 0, 0);
    if (tase) player.human.setState('loco'); else player.human.setState('crouch');
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
  private wire: THREE.Line | null = null; private spark: THREE.Mesh | null = null;
  private wirePts = new Float32Array(10 * 3);
  private ensureWire() {
    if (this.wire) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.wirePts, 3));
    this.wire = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.9, fog: false }));
    this.wire.frustumCulled = false; this.wire.visible = false;
    this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#9fd0ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.spark.visible = false; this.spark.frustumCulled = false;
    this.scene.add(this.wire, this.spark);
  }
  /** Taser wire: officer's hand to the suspect's chest with a crackling sag; the spark flickers on the suspect. */
  private drawWire(cop: Npc, player: Character, on: boolean) {
    this.ensureWire(); const w = this.wire!, sp = this.spark!;
    w.visible = sp.visible = on; if (!on) return;
    const x0 = cop.pos.x + Math.sin(cop.char.yaw) * 0.45, y0 = cop.pos.y + 1.35, z0 = cop.pos.z + Math.cos(cop.char.yaw) * 0.45;
    const x1 = player.pos.x, y1 = player.pos.y + 1.15, z1 = player.pos.z;
    const P = this.wirePts, n = P.length / 3;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), j = Math.sin(u * Math.PI) * 0.06;
      P[i * 3] = x0 + (x1 - x0) * u + (Math.random() - 0.5) * j; P[i * 3 + 1] = y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * 0.25 + (Math.random() - 0.5) * j; P[i * 3 + 2] = z0 + (z1 - z0) * u + (Math.random() - 0.5) * j;
    }
    (w.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    sp.position.set(x1, y1, z1); sp.scale.setScalar(0.6 + Math.random() * 1.2);
    (w.material as THREE.LineBasicMaterial).opacity = 0.5 + Math.random() * 0.5;
  }
  /** Seconds into the arrest; the taser phase is t < TASE_T. Exposed for tests / the HUD. */
  get arrestStage(): 'none' | 'tase' | 'approach' | 'cuff' { const a = this.arrest; if (!a) return 'none'; return a.t < (a.tase ? TASE_T : 0) ? 'tase' : a.t < a.pre ? 'approach' : 'cuff'; }
  updateArrest(dt: number, player: Character) {
    const a = this.arrest; if (!a) return;
    a.t += dt;
    player.health = player.maxHealth; // nobody shoots a suspect who is being cuffed
    const cop = a.cop, ph = player.human, ch = cop.char.human;
    player.yaw = a.yaw; ph.root.rotation.y = a.yaw;
    const behind = a.base.clone().addScaledVector(new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)), -0.8);
    if (a.tase && a.t < a.pre) {
      // --- taser: stand and aim, fire, the suspect convulses and drops to the knees, the officer closes in
      player.vel.set(0, 0, 0);
      if (a.t < TASE_T) {
        cop.char.faceTowards(a.yaw, 14, dt); ch.setSpeed(0); ch.setUpperMode('pistol');
        if (!a.zapped) {
          a.zapped = true; this.hooks?.sfx?.('taser', cop.pos); ch.playOnce('Pistol_Shoot', 'upper', 0.04);
          ph.playAction('tased'); this.hooks?.cam.addShake(0.12);
        }
        a.shock -= dt; if (a.shock <= 0) { a.shock = 0.16; this.hooks?.cam.addShake(0.035); }
        // Round 8: down onto the knees as a pose state (a kneel *action* was replaced by every later hands / cuff action: the
        // suspect stood up and knelt again, which looked glitchy)
        if (a.t >= 0.8 && a.phase === 0) { a.phase = 1; ph.stopAction('tased'); ph.setState('crouch'); }
        this.drawWire(cop, player, a.t < TASE_T - 0.15);
      } else {
        this.drawWire(cop, player, false); ch.setUpperMode('loco');
        const k = THREE.MathUtils.smoothstep(a.t, TASE_T, a.pre);
        const gx = THREE.MathUtils.lerp(a.from.x, behind.x, k), gz = THREE.MathUtils.lerp(a.from.z, behind.z, k);
        cop.char.place(gx, player.pos.y, gz, a.yaw); ch.setSpeed(k < 0.97 ? 4.2 : 0);
      }
      this.frame(player);
      return;
    }
    if (!a.fromSet) { a.fromSet = true; a.from.copy(behind); this.drawWire(cop, player, false); ch.setSpeed(0); ch.setUpperMode('loco'); }
    const u = a.t - a.pre;
    // ~2.7 s: on the knees with hands up, officer steps in behind, takes both wrists, cuffs click, suspect led one step
    if (u >= 0.05 && a.phase <= 1) { a.phase = 2; ph.stopAction('tased'); ph.setState('crouch'); ph.playAction('hands_up'); this.shout(cop); }
    if (u >= 0.5 && a.phase === 2) { a.phase = 3; ph.setState('crouch'); }
    const k = THREE.MathUtils.smoothstep(u, 0.05, 1.1);
    const lead = THREE.MathUtils.smoothstep(u, 2.1, 2.6) * 0.7;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    cop.char.place(THREE.MathUtils.lerp(a.from.x, behind.x, k) + fx * lead, player.pos.y, THREE.MathUtils.lerp(a.from.z, behind.z, k) + fz * lead, a.yaw);
    if (lead > 0) player.place(a.base.x + fx * lead, player.pos.y, a.base.z + fz * lead, a.yaw);
    if (u >= 1.1 && a.phase === 3) { a.phase = 4; ch.playAction('cuff_reach'); }
    if (u >= 1.4 && a.phase === 4) { a.phase = 5; ph.stopAction('hands_up'); ph.playAction('wrists_back'); ch.stopAction('cuff_reach'); ch.playAction('cuffing'); }
    if (u >= 1.9 && a.phase === 5) { a.phase = 6; ph.stopAction('wrists_back'); ph.playAction('handcuffed'); this.hooks?.cam.addShake(0.04); } // the click
    if (u >= 2.7 && !a.finished) { a.finished = true; const d = a.done; a.done = null; d?.(); }
    this.frame(player);
  }
  /** Called when the arrest scene is over (respawn). */
  endArrest(player?: Character) {
    if (player) { player.human.stopAction('tased'); player.human.stopAction('wrists_back'); player.human.stopAction('kneel'); player.human.stopAction('handcuffed'); player.human.stopAction('hands_up'); }
    if (this.arrest) { const ch = this.arrest.cop.char.human; ch.stopAction('cuff_reach'); ch.stopAction('cuffing'); this.arrest.cop.brain = 'idle'; this.arrest = null; }
    if (this.wire && this.spark) this.wire.visible = this.spark.visible = false;
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
