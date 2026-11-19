/**
 * Army air power at Fort Calder.
 *  - HeliArms: what the player's weapons do in an army attack helicopter (chin cannon = fire, rockets = aim / R).
 *  - ArmyAir: hostile gunships. They launch from the base pads when the player has five stars, trespasses inside the base
 *    or steals one of the base's helicopters, fly to the player, hover at a stand-off range and engage with gun bursts and
 *    lead-aimed missiles (cooldowns, spread: dangerous but dodgeable, never an instant kill). They can be shot down.
 * Combat does the damage (hit-scan through combat.shoot, projectiles through combat.launch), the helicopter class does the
 * smoke / crash chain, so everything a player can do to a police helicopter works on these too.
 */
import * as THREE from 'three';
import { groups, G_STATIC, G_VEHICLE, G_PROP, type Physics } from '../core/physics';
import type { Character } from '../actors/character';
import type { Combat } from '../combat/combat';
import { WEAPONS } from '../combat/weapons';
import { Helicopter } from '../vehicles/helicopter';
import { ARMY_MOUNTS } from '../vehicles/helicopterModel';
import type { Vehicle } from '../vehicles/vehicle';
import { ARMY_BASE } from '../world/citymap';
import { armyLayout } from '../world/armybase';

export const ROCKET_SPEED = 55;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** True when (x,z) is inside the Fort Calder fence (grown by `pad` metres). */
export function inArmyBase(x: number, z: number, pad = 0) {
  const B = ARMY_BASE; return x > B.x0 - pad && x < B.x1 + pad && z > B.z0 - pad && z < B.z1 + pad;
}
/** When army gunships are in the air: five stars, trespassing (after the warning), or a stolen army helicopter at 3+ stars. */
export function armyAirWanted(heat: number, trespassSeconds: number, inArmyHeli: boolean) {
  return heat >= 5 || trespassSeconds >= 6 || (inArmyHeli && heat >= 3);
}
/** Point to aim a projectile of `speed` at so it meets a target moving at `vel` (a couple of fixed-point passes). */
export function leadPoint(from: THREE.Vector3, target: THREE.Vector3, vel: THREE.Vector3, speed: number, out = new THREE.Vector3()) {
  out.copy(target);
  for (let i = 0; i < 3; i++) { const t = from.distanceTo(out) / speed; out.copy(target).addScaledVector(vel, t); }
  return out;
}

export interface ArmsInput { fire: boolean; missile: boolean }
export const MISSILE_MAGAZINE = 8;
export const GUN_RATE = 14; // rounds per second

/** The player's chin gun and missiles in an army attack helicopter. */
export class HeliArms {
  missiles = MISSILE_MAGAZINE;
  private gunAcc = 0; private missileCd = 0; private regen = 0; private side = 0;
  private aim = new THREE.Vector3(); private dir = new THREE.Vector3(); private from = new THREE.Vector3();
  constructor(private combat: Combat, private physics: Physics) { }
  /** Aim point of the camera's centre ray (first solid hit, skipping the helicopter), else 400 m out. */
  aimPoint(camPos: THREE.Vector3, camDir: THREE.Vector3, heli: Helicopter, out = this.aim) {
    const start = Math.max(0, heli.position.clone().sub(camPos).dot(camDir) + 2.5);
    const o = camPos.clone().addScaledVector(camDir, start);
    const hit = this.physics.ray(o.x, o.y, o.z, camDir.x, camDir.y, camDir.z, 400, groups(0xffff, G_STATIC | G_VEHICLE | G_PROP), null, heli.phys.body);
    return out.copy(o).addScaledVector(camDir, hit ? hit.toi : 400);
  }
  /** Fires one missile from `from` along `dir` (also used by tests). */
  launchMissile(shooter: Character, from: THREE.Vector3, dir: THREE.Vector3, spread = 0) { this.combat.launch(shooter, WEAPONS.rpg, from, dir, spread); }
  update(dt: number, heli: Helicopter, input: ArmsInput, camPos: THREE.Vector3, camDir: THREE.Vector3, shooter: Character): { gun: boolean; missile: boolean } {
    const ready = heli.armed && !heli.destroyed && heli.rotor > 0.9;
    const aim = this.aimPoint(camPos, camDir, heli);
    heli.gunMuzzle(this.from);
    this.dir.copy(aim).sub(this.from);
    const dist = this.dir.length(); this.dir.normalize();
    heli.gunAim.yaw = Math.atan2(this.dir.x, this.dir.z); heli.gunAim.pitch = Math.asin(THREE.MathUtils.clamp(this.dir.y, -1, 1));
    this.missileCd = Math.max(0, this.missileCd - dt);
    if (this.missiles < MISSILE_MAGAZINE) { this.regen += dt; if (this.regen > 2.6) { this.regen = 0; this.missiles++; } }
    const res = { gun: false, missile: false };
    if (!ready) return res;
    if (input.fire && dist > 3) {
      this.gunAcc += dt * GUN_RATE;
      while (this.gunAcc >= 1) {
        this.gunAcc -= 1;
        heli.gunMuzzle(this.from);
        this.combat.shoot(shooter, WEAPONS.lmg, this.from, this.dir, 0.012, heli as unknown as Vehicle);
        res.gun = true;
      }
    } else this.gunAcc = Math.min(this.gunAcc, 0.9);
    if (input.missile && this.missileCd <= 0 && this.missiles > 0) {
      this.missileCd = 0.7; this.missiles--; this.regen = 0;
      const mount = ARMY_MOUNTS.missiles[this.side++ % 2];
      heli.mountWorld(mount, this.from);
      const d = this.aim.clone().sub(this.from).normalize();
      this.combat.launch(shooter, WEAPONS.rpg, this.from, d, 0.004);
      res.missile = true;
    }
    return res;
  }
}

export interface ArmyAirHooks {
  combat: Combat; physics: Physics;
  /** an idle parked army helicopter on a base pad, if any */
  takeBaseHeli(): Helicopter | null;
  spawn(x: number, y: number, z: number, yaw: number): Helicopter;
  remove(h: Helicopter): void;
}
export interface ArmyTarget { pos: THREE.Vector3; vel: THREE.Vector3; vehicle: { damage(a: number, p?: THREE.Vector3, d?: THREE.Vector3, by?: unknown): boolean; maxHealth?: number; spec?: { health: number } } | null; onFoot: boolean }

interface Unit {
  heli: Helicopter; state: 'spool' | 'attack' | 'rtb'; t: number; burst: number; gunCd: number; missileCd: number; idx: number; shooter: Character; acc: number; leaveT: number;
}

/** Hostile army gunships (AI). Call update() every frame. */
export class ArmyAir {
  units: Unit[] = [];
  trespassT = 0; respawnT = 4;
  /** counters for tests / HUD */
  stats = { launched: 0, missiles: 0, bursts: 0, shot: 0 };
  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3(); private tmpC = new THREE.Vector3(); private tmpD = new THREE.Vector3();
  constructor(private hooks: ArmyAirHooks) { }

  get active() { return this.units.some(u => !u.heli.destroyed); }

  /** Wanted state is computed by the caller (armyAirWanted); this launches, steers and fires. */
  update(dt: number, wanted: boolean, target: ArmyTarget) {
    const maxUnits = wanted ? (this.wantedHeavy ? 2 : 1) : 0;
    // launch
    this.respawnT -= dt;
    const live = this.units.filter(u => !u.heli.destroyed && u.state !== 'rtb').length;
    if (wanted && live < maxUnits && this.respawnT <= 0) { this.launch(); this.respawnT = 14; }
    for (const u of [...this.units]) {
      if (u.heli.destroyed) { if ((u.t += dt) > 45) this.drop(u); continue; }
      if (!wanted && u.state !== 'rtb') { u.state = 'rtb'; u.leaveT = 0; }
      this.fly(dt, u, target);
    }
  }
  /** set by the caller: two ships at 5 stars */
  wantedHeavy = false;

  private launch() {
    const L = armyLayout();
    let heli = this.hooks.takeBaseHeli();
    const pad = L.pads[this.stats.launched % L.pads.length];
    if (!heli) heli = this.hooks.spawn(pad.x, 0.12, pad.z, Math.PI);
    heli.aiOwned = true; heli.engineOn = true; heli.persistent = true; heli.parked = false;
    const shooter = this.makePilot(heli);
    this.units.push({ heli, state: 'spool', t: 0, burst: 0, gunCd: 2, missileCd: 6, idx: this.units.length, shooter, acc: 0, leaveT: 0 });
    this.stats.launched++;
  }
  /** Minimal stand-in for the pilot so combat can attribute shots (team police, not the player). */
  private makePilot(h: Helicopter): Character {
    return { team: 'police', isPlayer: false, alive: true, inVehicle: h, pos: h.position, vel: new THREE.Vector3(), yaw: 0, collider: null, health: 100, armor: 0 } as unknown as Character;
  }
  private drop(u: Unit) { const i = this.units.indexOf(u); if (i >= 0) this.units.splice(i, 1); this.hooks.remove(u.heli); }
  dispose() { for (const u of [...this.units]) this.drop(u); }

  private solid = groups(0xffff, G_STATIC | G_VEHICLE | G_PROP);
  private los(from: THREE.Vector3, to: THREE.Vector3, body: Helicopter) {
    const d = this.tmpD.copy(to).sub(from); const len = d.length(); if (len < 1) return true; d.multiplyScalar(1 / len);
    const hit = this.hooks.physics.ray(from.x, from.y, from.z, d.x, d.y, d.z, len - 3, groups(0xffff, G_STATIC), null, body.phys.body);
    return !hit;
  }

  private fly(dt: number, u: Unit, tg: ArmyTarget) {
    const h = u.heli, pos = h.position, inp = h.input;
    const rtb = u.state === 'rtb';
    const B = ARMY_BASE, home = this.tmpA.set((B.x0 + B.x1) / 2, 0, (B.z0 + B.z1) / 2);
    const goal = rtb ? home : tg.pos;
    const dx = goal.x - pos.x, dz = goal.z - pos.z, d = Math.hypot(dx, dz);
    const err = wrap(Math.atan2(dx, dz) - h.yaw);
    if (u.state === 'spool') {
      u.t += dt; inp.lift = 0; inp.pitch = 0; inp.yaw = 0;
      if (h.rotor > 0.98 && u.t > 4.2) { u.state = 'attack'; u.t = 0; }
      return;
    }
    const stand = 55 + u.idx * 18;
    // heading: face the target; pitch forward to close, ease back when too close
    inp.yaw = THREE.MathUtils.clamp(err * 1.7, -1, 1);
    const closing = rtb ? d > 25 : d > stand + 12;
    inp.pitch = closing && Math.abs(err) < 1.0 ? THREE.MathUtils.clamp((d - stand) / 60, 0.25, 1) : (!rtb && d < stand - 18 ? -0.3 : 0);
    // altitude: above the target, well clear of the ground and of anything ahead
    const wantY = rtb ? 25 : tg.pos.y + 26 + u.idx * 9;
    let lift = THREE.MathUtils.clamp((wantY - pos.y) * 0.3, -1, 1);
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const hitA = this.hooks.physics.ray(pos.x, pos.y, pos.z, fx, 0, fz, 48, groups(0xffff, G_STATIC | G_VEHICLE), null, h.phys.body);
    const hitB = this.hooks.physics.ray(pos.x, pos.y, pos.z, fx * 0.96, -0.28, fz * 0.96, 55, groups(0xffff, G_STATIC | G_VEHICLE), null, h.phys.body);
    if (hitA || hitB || h.agl < 14) { lift = 1; if (hitA) inp.pitch = Math.min(inp.pitch, 0); }
    inp.lift = lift;
    if (rtb) {
      u.leaveT += dt;
      if (u.leaveT > 45 || d < 40) { this.drop(u); }
      return;
    }
    // ---- weapons
    const eye = h.gunMuzzle(this.tmpB);
    const dist = eye.distanceTo(tg.pos);
    const shooter = u.shooter;
    const seen = dist < 190 && this.los(eye, this.tmpC.copy(tg.pos).setY(tg.pos.y + 1), h);
    // turret tracks the lead point even while manoeuvring
    const lead = leadPoint(eye, tg.pos, tg.vel, 400, this.tmpC);
    h.gunAim.yaw = Math.atan2(lead.x - eye.x, lead.z - eye.z); h.gunAim.pitch = Math.asin(THREE.MathUtils.clamp((lead.y - eye.y) / Math.max(1, dist), -1, 1));
    u.gunCd -= dt; u.missileCd -= dt;
    if (seen && Math.abs(err) < 0.7) {
      if (u.burst <= 0 && u.gunCd <= 0 && dist < 130) { u.burst = 0.9 + Math.random() * 0.5; u.gunCd = 2.2 + Math.random() * 1.8; this.stats.bursts++; }
      if (u.burst > 0) {
        u.burst -= dt; u.acc += dt * 12; const shots = Math.floor(u.acc); u.acc -= shots;
        for (let n = 0; n < shots; n++) this.fireGun(u, eye, lead, dist, tg);
      }
      if (u.missileCd <= 0 && dist > 28 && dist < 175) {
        u.missileCd = 7 + Math.random() * 3;
        const mount = ARMY_MOUNTS.missiles[u.idx % 2 === 0 ? 0 : 1];
        const from = h.mountWorld(mount, this.tmpB);
        const aim = leadPoint(from, tg.pos, tg.vel, ROCKET_SPEED, this.tmpC); aim.y += 0.6;
        const dir = aim.sub(from).normalize();
        this.hooks.combat.launch(shooter, WEAPONS.rpg, from, dir, 0.012 + dist * 0.00008);
        this.stats.missiles++;
      }
    }
  }
  private fireGun(u: Unit, eye: THREE.Vector3, lead: THREE.Vector3, dist: number, tg: ArmyTarget) {
    const dir = this.tmpD.copy(lead).sub(eye).normalize();
    const spread = 0.03 + dist * 0.0004;
    this.hooks.combat.shoot(u.shooter, WEAPONS.lmg, eye, dir, spread, u.heli as unknown as Vehicle);
    this.stats.shot++;
    // tracers rarely connect with a vehicle that is moving: a share of rounds count as hits on whatever the player drives
    if (tg.vehicle && Math.random() < 0.22) {
      const hp = tg.vehicle.maxHealth ?? tg.vehicle.spec?.health ?? 1000;
      tg.vehicle.damage(Math.max(18, hp * 0.0045), tg.pos.clone(), dir.clone(), u.shooter);
    }
  }
}
