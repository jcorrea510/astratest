/** NPC brains: civilians wander and react, gang members and police fight intelligently. */
import { type Bench, nearestFreeBench } from '../world/benches';
import { holdOnHuman } from '../combat/gunRig';
import * as THREE from 'three';
import { Character } from './character';
import type { HumanTemplate, Look } from './human';
import { meleeTargets, MELEE_POWER } from './character';
import { RAPIER, type Physics, groups, G_STATIC, G_VEHICLE } from '../core/physics';
import { type CityMap, pedestrianMayCross } from '../world/citymap';
import { WEAPONS, weaponMesh, MUZZLE, type WeaponId } from '../combat/weapons';
import type { Combat } from '../combat/combat';
import { Rng, wrapAngle } from '../core/rng';
import { STORES, STORE_D } from '../game/places';

export type Role = 'civilian' | 'gang' | 'police';
export type Brain = 'inside' | 'wander' | 'idle' | 'flee' | 'cower' | 'surrender' | 'combat' | 'chase' | 'dead' | 'scripted' | 'passenger';

/** Street-life activities of civilians (stand still doing something, walk to a shop, board a cab). */
export type Activity = '' | 'phone' | 'smoke' | 'window' | 'film' | 'hail' | 'wait' | 'shop' | 'taxi' | 'sit' | 'sitting' | 'board' | 'queue';
const ACT_ANIM: Partial<Record<Activity, string>> = { phone: 'phone', smoke: 'smoke', film: 'film', hail: 'hail', wait: 'talk', sitting: 'sit', queue: 'phone' };
/** Seated pose: how far behind the bench centre the hips sit, and the root height offset above the seat (tuned against the Sitting_Idle_Loop clip). */
const SIT_BACK = 0.12, SIT_DY = 0.02;
/** World clock for time-of-day behaviour (the game sets this each frame). */
export const streetClock = { hour: 17 };

const EYE = 1.55;
let NPC_ID = 0;
export class Npc {
  id = NPC_ID++;
  char: Character;
  brain: Brain = 'wander';
  weapon: WeaponId = 'fists';
  clip = 0;
  cooldown = 0; reloadT = 0; burst = 0;
  target: Character | null = null;
  home = new THREE.Vector3();
  goal: THREE.Vector3 | null = null;
  node = -1; nextNode = -1; laneOffset = 0;
  waitT = 0; think = Math.random() * 0.3; stateT = 0; aimT = 0; losT = 0; lastSeen = new THREE.Vector3(); seenTime = -100;
  stuckT = 0; sideT = 0; sideDir = 1; lastPos = new THREE.Vector3();
  model: THREE.Group | null = null;
  hostile = false; // gang members attack the player on sight when hostile
  accuracy = 1; // lower = better aim
  speedMul = 1;
  persistent = false;
  tag = '';
  fleeFrom = new THREE.Vector3();
  coverPoint: THREE.Vector3 | null = null;
  /** seconds an officer keeps firing from the cover point they were ordered to (no flanking/strafing) */
  holdCoverT = 0;
  far = false;
  animAcc = 0;
  /** dt accumulated while this fighter's AI tick was skipped (distance LOD) */
  accDt = 0;
  arrestT = 0;
  /** smoothed steering for fighters (no jitter / instant direction flips) */
  mdir = new THREE.Vector3(); mspeed = 0;
  /** holding a covered position: kneels while waiting */
  crouching = false;
  dropMoney = 0;
  /** street life */
  activity: Activity = ''; actOn = false; actDur = 0; actCool = Math.random() * 12; idleFace: number | null = null;
  buddy: Npc | null = null; jay = Math.random() < 0.08; disposed = false;
  destPt: THREE.Vector3 | null = null; destYaw = 0;
  /** the bench this pedestrian is walking to / sitting on */
  bench: Bench | null = null;
  /** delayed reaction to danger: seconds until it registers, and where from */
  alertT = 0; alertFrom = new THREE.Vector3(); alertFar = false;
  constructor(physics: Physics, tpl: HumanTemplate, look: Look, public role: Role, x: number, z: number, y = 0.2) {
    this.char = new Character(physics, tpl, look, role === 'police' ? 'police' : role === 'gang' ? 'gang' : 'civilian', x, z, y);
    this.home.set(x, y, z);
    this.laneOffset = (Math.random() - 0.5) * 1.6;
    this.lastPos.set(x, y, z);
  }
  arm(id: WeaponId, scene: THREE.Scene) {
    this.weapon = id; this.clip = WEAPONS[id].clip;
    if (this.model) { this.model.removeFromParent(); this.model = null; }
    if (id !== 'fists') { this.model = weaponMesh(id); scene.add(this.model); }
  }
  get alive() { return this.char.alive; }
  get pos() { return this.char.pos; }
  dispose() { this.disposed = true; this.buddy = null; if (this.bench) { this.bench.occupied = false; this.bench = null; } if (this.model) { this.model.removeFromParent(); this.model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.geometry.userData.shared) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); /* COMBAT: weapon models share cached geometry/materials */ this.model = null; } this.target = null; this.char.dispose(); }
}

export interface NpcEnv {
  physics: Physics; city: CityMap; combat: Combat; scene: THREE.Scene; time: () => number;
  player: Character; playerHeat: () => number; copsLethal?: () => boolean; others: () => Iterable<Character>;
  onArrest: (by: Npc) => void; onWitness: (npc: Npc, what: 'shot' | 'attack' | 'kill' | 'carjack') => void;
}

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tvDesired = new THREE.Vector3(), tvO = new THREE.Vector3(), tvA = new THREE.Vector3();
export class NpcBrainRunner {
  private rng = new Rng(99);
  private ball = new RAPIER.Ball(0.35);
  constructor(private env: NpcEnv) { }

  /** Per-tick budgets shared by all fighters so a big firefight costs a bounded number of physics queries. */
  rays = 8; covers = 1;
  beginTick(maxRays = 8) { this.rays = maxRays; this.covers = 1; }
  private lethal() { return this.env.copsLethal ? this.env.copsLethal() : this.env.playerHeat() >= 2; }
  hasLOS(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z; const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = this.env.physics.ray(from.x, from.y, from.z, dx / d, dy / d, dz / d, d - 0.3, groups(0xffff, G_STATIC | G_VEHICLE));
    return !hit;
  }
  private eye(c: Character, out: THREE.Vector3) { return out.set(c.pos.x, c.pos.y + EYE * c.human.look.height, c.pos.z); }
  private chest(c: Character, out: THREE.Vector3) { return out.set(c.pos.x, c.pos.y + 1.2 * c.human.look.height, c.pos.z); }
  private pointFree(p: THREE.Vector3): boolean {
    let blocked = false;
    this.env.physics.world.intersectionsWithShape({ x: p.x, y: p.y + 0.9, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, this.ball, () => { blocked = true; return false; }, undefined, groups(0xffff, G_STATIC | G_VEHICLE));
    return !blocked;
  }
  /** Finds a nearby point that breaks line of sight to the threat. */
  findCover(n: Npc, threat: THREE.Vector3): THREE.Vector3 | null {
    if (this.covers <= 0) return null;
    this.covers--;
    let best: THREE.Vector3 | null = null, bestScore = Infinity;
    const te = tv2.copy(threat).setY(threat.y + 1.2);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.rng.range(0, 0.4), r = this.rng.range(2.5, 9);
      const p = new THREE.Vector3(n.pos.x + Math.cos(a) * r, n.pos.y, n.pos.z + Math.sin(a) * r);
      if (!this.pointFree(p)) continue;
      const chestP = tv.set(p.x, p.y + 1.1, p.z);
      if (this.hasLOS(te, chestP)) continue;
      const toThreat = p.distanceTo(threat);
      const score = r + Math.max(0, toThreat - 30) * 0.6 + (toThreat < 6 ? 20 : 0);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /** AI decision + movement for one NPC (fixed step). */
  update(n: Npc, dt: number) {
    const c = n.char, env = this.env, t = env.time();
    if (!c.alive) { n.brain = 'dead'; return; }
    n.think -= dt; n.cooldown -= dt; n.stateT += dt; n.actCool -= dt;
    if (n.activity && (n.brain === 'flee' || n.brain === 'cower' || n.brain === 'surrender')) this.endAct(n);
    if (n.reloadT > 0) { n.reloadT -= dt; if (n.reloadT <= 0) n.clip = WEAPONS[n.weapon].clip; }
    const desired = tvDesired.set(0, 0, 0);
    let deferThink = false;
    let speed = 0, faceYaw: number | null = null, aiming = false;
    // Perception for fighters
    if ((n.role === 'gang' || n.role === 'police') && n.brain !== 'scripted' && n.brain !== 'passenger') {
      const p = env.player;
      const want = n.role === 'police' ? env.playerHeat() > 0 : n.hostile;
      if (want && p.alive) {
        const d = c.pos.distanceTo(p.pos);
        const doRay = n.think <= 0 && d < 70 && this.rays > 0;
        if (doRay) this.rays--;
        const sees = d < 70 && (doRay ? this.hasLOS(this.eye(c, tv), this.chest(p, tv2)) : n.losT > 0);
        if (doRay || d >= 70) { n.losT = sees ? 1 : 0; } else if (n.think <= 0) deferThink = true; // out of ray budget: retry next tick
        if (sees) { n.seenTime = t; n.lastSeen.copy(p.pos); const want2 = n.role === 'police' && !this.lethal() ? 'chase' : 'combat'; if (n.brain !== want2) { n.brain = want2; n.stateT = 0; n.goal = null; } n.target = p; }
        else if (n.brain === 'combat' && t - n.seenTime > 12) { n.brain = 'chase'; }
        if (n.role === 'police' && this.lethal() && n.brain === 'chase') n.brain = 'combat';
        if (n.brain !== 'combat' && n.brain !== 'chase' && d < 30) { n.brain = 'chase'; n.target = p; n.lastSeen.copy(p.pos); }
      } else if (n.brain === 'combat' || n.brain === 'chase') { n.brain = n.role === 'police' ? 'idle' : 'idle'; n.target = null; }
    }
    if (n.think <= 0 && !deferThink) n.think = 0.25 + Math.random() * 0.25;

    switch (n.brain) {
      case 'wander': speed = this.wander(n, desired, dt) * n.speedMul; break;
      case 'idle': {
        speed = 0;
        if (n.role !== 'civilian') break;
        if (n.idleFace !== null) faceYaw = n.idleFace;
        if (n.activity && !n.actOn) { n.actOn = true; const a = ACT_ANIM[n.activity]; if (a && !c.human.busy) c.human.playAction(a); }
        const mate = n.buddy;
        const gone = n.activity === 'wait' && (!mate || (mate.brain !== 'idle' && mate.brain !== 'inside'));
        if (n.stateT > (n.actDur || 6) || gone) this.endAct(n);
        break;
      }
      case 'inside': { speed = 0; if (n.stateT > n.actDur) this.exitBuilding(n); break; }
      case 'flee': {
        tv.copy(c.pos).sub(n.fleeFrom); tv.y = 0; if (tv.lengthSq() < 0.01) tv.set(1, 0, 0);
        tv.normalize(); desired.copy(tv); speed = 6.2;
        if (n.stateT > 7) {
          n.node = -1; n.stateT = 0;
          // once things calm down some stop at a distance and film it
          if (n.role === 'civilian' && Math.random() < 0.35 && c.pos.distanceTo(n.fleeFrom) > 18) this.startAct(n, 'film', 9 + Math.random() * 14, Math.atan2(n.fleeFrom.x - c.pos.x, n.fleeFrom.z - c.pos.z));
          else n.brain = 'wander';
        }
        break;
      }
      case 'cower': { speed = 0; c.human.setState('cower'); if (n.stateT > 6) { n.brain = 'flee'; n.stateT = 0; c.human.setState('loco'); } break; }
      case 'surrender': { // hands up while a gun is pointed at them, then bolt
        speed = 0; faceYaw = Math.atan2(env.player.pos.x - c.pos.x, env.player.pos.z - c.pos.z);
        if (c.human.actionName !== 'hands_up' && n.stateT < 0.3) c.human.playAction('hands_up');
        if (n.stateT > n.waitT) { c.human.stopAction('hands_up'); n.brain = Math.random() < 0.3 ? 'cower' : 'flee'; n.fleeFrom.copy(env.player.pos); n.stateT = 0; }
        break;
      }
      case 'chase': {
        const tgt = n.target ?? env.player;
        tv.copy(n.lastSeen).sub(c.pos); tv.y = 0; const d = tv.length();
        if (d > 1.2) { desired.copy(tv.normalize()); speed = n.role === 'police' ? (d > 25 ? 5.8 : d > 7 ? 4.4 : 2.2) : 5.2; }
        if (n.role === 'police' && !this.lethal() && tgt.alive && !tgt.inVehicle && c.pos.distanceTo(tgt.pos) < 1.8) {
          faceYaw = Math.atan2(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z);
          if (tgt.speed < 2.5) { n.arrestT += dt; if (n.arrestT > 1.6) { n.arrestT = 0; env.onArrest(n); } } else n.arrestT = Math.max(0, n.arrestT - dt);
        } else n.arrestT = 0;
        if (n.role !== 'police' && WEAPONS[n.weapon].melee && c.pos.distanceTo(tgt.pos) < 1.6) this.meleeAttack(n, tgt);
        break;
      }
      case 'combat': {
        const tgt = n.target ?? env.player;
        const d = c.pos.distanceTo(tgt.pos);
        // officers use guns once force is lethal: nobody runs in to trade punches with an armed or shooting suspect
        if (n.role === 'police' && n.weapon === 'fists' && this.lethal()) n.arm('pistol', env.scene);
        const w = WEAPONS[n.weapon];
        const seeing = t - n.seenTime < 0.6;
        const ideal = w.melee ? 1.2 : w.id === 'shotgun' ? 9 : w.id === 'rifle' ? 22 : 15;
        if (seeing) n.aimT += dt; else n.aimT = Math.max(0, n.aimT - dt * 2);
        // Tactical repositioning
        n.holdCoverT = Math.max(0, n.holdCoverT - dt);
        if (n.holdCoverT <= 0 && (n.think <= 0.05 || !n.goal)) {
          const lowHealth = c.health < c.maxHealth * 0.3;
          if (w.melee) n.goal = tgt.pos.clone();
          else if (lowHealth && !n.coverPoint) { n.coverPoint = this.findCover(n, tgt.pos); n.goal = n.coverPoint ?? c.pos.clone().add(tv.copy(c.pos).sub(tgt.pos).setY(0).normalize().multiplyScalar(6)); }
          else if (!seeing) n.goal = n.lastSeen.clone(); // push to last known position (flank)
          else if (d > ideal * 1.4) { // close to firing range, each officer from a different angle (flanking)
            const away = tv.copy(c.pos).sub(tgt.pos).setY(0).normalize();
            const flank = ((n.id % 3) - 1) * 0.6;
            const ca = Math.cos(flank), sa = Math.sin(flank);
            n.goal = tgt.pos.clone().add(new THREE.Vector3(away.x * ca - away.z * sa, 0, away.x * sa + away.z * ca).multiplyScalar(ideal));
          }
          else if (n.stateT > 2.5 && Math.random() < (n.role === 'police' ? 0.5 : 0.35)) { // strafe or take cover between bursts
            const cover = Math.random() < 0.6 ? this.findCover(n, tgt.pos) : null;
            if (cover && cover.distanceTo(tgt.pos) < ideal * 2) n.goal = cover;
            else { const side = tv.copy(tgt.pos).sub(c.pos).setY(0).normalize(); n.goal = c.pos.clone().add(new THREE.Vector3(-side.z, 0, side.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * this.rng.range(2, 5))); }
            n.stateT = 0;
          } else if (d < ideal * 0.5 && !w.melee) n.goal = c.pos.clone().add(tv.copy(c.pos).sub(tgt.pos).setY(0).normalize().multiplyScalar(3));
          else n.goal = null;
        }
        if (n.goal) {
          tv.copy(n.goal).sub(c.pos); tv.y = 0; const gd = tv.length();
          if (gd > 0.8) { desired.copy(tv.normalize()); speed = w.melee ? 5.5 : gd > 14 ? 5 : seeing ? (gd > 4 ? 3.6 : 2) : 4.2; } else { if (n.goal === n.coverPoint || (n.role === 'police' && seeing)) n.crouching = true; n.goal = null; }
        }
        if (speed > 0) n.crouching = false;
        if (w.melee) { if (d < 1.6) this.meleeAttack(n, tgt); faceYaw = Math.atan2(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z); break; }
        // Shooting
        if (seeing && d < w.range) {
          aiming = true;
          faceYaw = Math.atan2(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z);
          const facingOk = Math.abs(wrapAngle(faceYaw - c.yaw)) < 0.35;
          if (n.clip <= 0 && n.reloadT <= 0) { n.reloadT = w.reload * 1.3; c.human.playOnce('Pistol_Reload', 'upper', 0.1); }
          else if (facingOk && n.cooldown <= 0 && n.reloadT <= 0 && n.aimT > 0.8 && tgt.alive) {
            if (n.burst <= 0) n.burst = w.auto ? 3 + Math.floor(Math.random() * 4) : 1;
            this.fire(n, tgt, d);
            n.burst--;
            n.cooldown = n.burst > 0 ? w.interval * 1.4 : w.interval + 0.8 + Math.random() * 1.2;
          }
        }
        break;
      }
      case 'scripted': case 'passenger': case 'dead': break;
    }
    // fighters ease their heading and speed (no jitter, no teleport-turns)
    if (n.role !== 'civilian' && (n.brain === 'combat' || n.brain === 'chase')) {
      const k = 1 - Math.exp(-dt * 5);
      if (speed > 0) { if (n.mspeed < 0.2) n.mdir.copy(desired); else n.mdir.lerp(desired, k).normalize(); }
      n.mspeed += (speed - n.mspeed) * (1 - Math.exp(-dt * 4));
      if (n.mspeed < 0.15) { n.mspeed = 0; speed = 0; } else { desired.copy(n.mdir); speed = n.mspeed; }
    } else n.mspeed = speed;
    // Movement with simple stuck recovery
    if (speed > 0) {
      if (n.sideT > 0) { n.sideT -= dt; const s = n.sideDir; desired.set(desired.x * 0.3 - desired.z * s, 0, desired.z * 0.3 + desired.x * s).normalize(); }
      tv.copy(desired).multiplyScalar(speed);
    } else tv.set(0, 0, 0);
    if (n.far) { // cheap movement without collision when far from the player
      c.pos.addScaledVector(tv, dt); c.vel.copy(tv);
      c.body.setNextKinematicTranslation({ x: c.pos.x, y: c.pos.y + 0.87, z: c.pos.z });
    } else c.move(tv, dt, false);
    if (speed > 0) {
      const moved = c.pos.distanceTo(n.lastPos);
      if (moved < speed * dt * 0.25) { n.stuckT += dt; if (n.stuckT > 0.6) { n.stuckT = 0; n.sideT = 0.8; n.sideDir = Math.random() < 0.5 ? 1 : -1; if (n.brain === 'combat') n.goal = null; } }
      else n.stuckT = Math.max(0, n.stuckT - dt);
    }
    n.lastPos.copy(c.pos);
    const yaw = faceYaw ?? (speed > 0.2 && c.speed > 0.3 ? Math.atan2(c.vel.x, c.vel.z) : null);
    if (yaw !== null) c.faceTowards(yaw, aiming ? 10 : 7, dt);
    c.twist = 0;
    const h = c.human;
    if (n.crouching && n.brain === 'combat' && speed === 0 && n.role === 'police') { if (h.currentState !== 'crouch') h.setState('crouch'); }
    else if (n.brain !== 'cower' && n.brain !== 'scripted' && (h.currentState === 'crouch' || h.currentState === 'cower')) h.setState('loco');
    // panicked running: arms up for the first seconds of a flight
    if (n.role === 'civilian') {
      const panicking = n.brain === 'flee' && n.stateT < 3.5 && c.speed > 2.5;
      if (panicking && !h.actionName && !h.busy) h.playAction('panic', { weight: 0.75 });
      else if (!panicking && h.actionName === 'panic') h.stopAction('panic');
    }
    h.setUpperMode(n.weapon !== 'fists' && (aiming || n.brain === 'combat') ? 'pistol' : n.weapon !== 'fists' && n.brain === 'chase' ? 'carry' : 'loco');
    h.aimPitch = 0;
  }
  /** Throws a real punch: wind-up, strike; damage only lands if the target is still within reach in front. */
  private meleeAttack(n: Npc, tgt: Character) {
    if (n.cooldown > 0 || !tgt.alive || n.char.downT > 0) return;
    const c = n.char;
    c.yaw = Math.atan2(tgt.pos.x - n.pos.x, tgt.pos.z - n.pos.z);
    c.onMeleeStrike = kind => {
      const hit = meleeTargets(c, [tgt], 1.3);
      if (!hit.length) return;
      this.env.combat.melee(c, WEAPONS.fists, hit, []);
      tgt.vel.x = 0; tgt.vel.z = 0;
      if (tgt.alive) tgt.hitReact(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z, MELEE_POWER[kind] * 0.8);
    };
    if (c.startMelee('fists')) n.cooldown = 0.75 + Math.random() * 0.6;
  }
  private fire(n: Npc, tgt: Character, dist: number) {
    const w = WEAPONS[n.weapon];
    const origin = this.muzzle(n, tvO);
    const aimAt = this.chest(tgt, tvA);
    // Accuracy: distance, target speed, own movement, time aiming; police/gang skill via n.accuracy
    const err = (0.045 + dist * 0.0016 + tgt.speed * 0.012 + n.char.speed * 0.01) * n.accuracy * (n.aimT > 2 ? 0.75 : 1.2) * (tgt.inVehicle ? 1.4 : 1);
    const dir = aimAt.sub(origin).normalize();
    dir.x += (Math.random() - 0.5) * err * 2; dir.y += (Math.random() - 0.5) * err; dir.z += (Math.random() - 0.5) * err * 2; dir.normalize();
    n.clip--;
    n.char.human.playOnce('Pistol_Shoot', 'upper', 0.04);
    this.env.combat.shoot(n.char, w, origin, dir, w.aimSpread);
  }
  muzzle(n: Npc, out: THREE.Vector3) {
    if (n.model) return out.set(0, 0.07, MUZZLE[n.weapon]).applyMatrix4(n.model.matrixWorld);
    return out.set(n.pos.x + Math.sin(n.char.yaw) * 0.5, n.pos.y + 1.35, n.pos.z + Math.cos(n.char.yaw) * 0.5);
  }
  /** Places held weapon models after animation. */
  updateModel(n: Npc) {
    if (!n.model) return;
    const c = n.char;
    n.model.visible = c.alive && !c.inVehicle && !n.far;
    if (!n.model.visible) return;
    const tgt = n.target ?? this.env.player;
    const near = n.pos.distanceToSquared(this.env.player.pos) < 45 * 45; // only close people pay for the shoulder / two-hand IK
    if (near) {
      const fighting = n.brain === 'combat' && !!tgt;
      if (fighting) tvA.set(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z);
      c.human.trigger = fighting && n.cooldown > 0 ? 1 : 0;
      if (holdOnHuman(c.human, n.model, c.yaw, fighting ? tvA : null, fighting ? 1 : 0)) return;
    }
    c.human.rightHand.getWorldPosition(n.model.position);
    if (n.brain === 'combat' && tgt) { n.model.lookAt(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z); }
    else { c.human.rightHand.getWorldQuaternion(n.model.quaternion); n.model.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)); }
    n.model.updateMatrixWorld(true);
  }
  /** Starts a standing activity (phone, smoke, filming...). */
  startAct(n: Npc, a: Activity, dur: number, face: number | null) {
    n.brain = 'idle'; n.activity = a; n.actOn = false; n.actDur = dur; n.idleFace = face; n.stateT = 0;
    n.actCool = 18 + Math.random() * 25;
  }
  /** Sits on the bench the pedestrian walked up to: hidden collision, seated clip, for a while. */
  private sitDown(n: Npc) {
    const b = n.bench; if (!b) { n.activity = ''; n.destPt = null; return; }
    const c = n.char, sx = Math.sin(b.yaw), cz = Math.cos(b.yaw);
    c.setCollision(false); c.place(b.x - sx * SIT_BACK, b.y + SIT_DY, b.z - cz * SIT_BACK, b.yaw);
    n.brain = 'idle'; n.activity = 'sitting'; n.actOn = false; n.actDur = 25 + Math.random() * 70; n.idleFace = b.yaw; n.stateT = 0; n.destPt = null;
  }
  private freeBench(n: Npc) { if (n.bench) { n.bench.occupied = false; n.bench = null; } }
  endAct(n: Npc) {
    const a = ACT_ANIM[n.activity];
    if (n.activity === 'sitting' && n.bench) { // get up in front of the bench and walk on
      const b = n.bench; n.char.human.stopAction('sit'); n.char.place(b.x + Math.sin(b.yaw) * 0.9, b.y, b.z + Math.cos(b.yaw) * 0.9, b.yaw); n.char.setCollision(true); n.node = -1; this.freeBench(n);
    } else if (a && n.char.human.actionName === a) n.char.human.stopAction(a);
    n.activity = ''; n.actOn = false; n.idleFace = null; n.actDur = 0; n.destPt = null;
    if (n.brain === 'idle') { n.brain = 'wander'; n.stateT = 0; }
  }
  /** Walks into a building: hidden and non-solid until it is time to come back out. */
  private enterBuilding(n: Npc, dur: number) {
    if (n.char.human.actionName) n.char.human.stopAction(n.char.human.actionName);
    n.char.setCollision(false); n.brain = 'inside'; n.stateT = 0; n.actDur = dur;
    n.char.body.setNextKinematicTranslation({ x: n.pos.x, y: n.pos.y + 0.87, z: n.pos.z });
  }
  private exitBuilding(n: Npc) {
    const p = n.destPt ?? n.pos;
    n.char.place(p.x, n.pos.y, p.z, n.destYaw); n.char.setCollision(true);
    n.activity = ''; n.actOn = false; n.destPt = null; n.brain = 'wander'; n.node = -1; n.stateT = 0;
  }
  private onRoad(x: number, z: number): boolean {
    for (const r of this.env.city.roads) {
      const along = r.axis === 'x' ? x : z, across = Math.abs((r.axis === 'x' ? z : x) - r.coord);
      if (across < r.half + 0.3 && along > r.from && along < r.to) return true;
    }
    return false;
  }
  /** Direction (yaw) pointing away from the nearest road, i.e. towards the shop fronts. */
  private awayFromRoad(x: number, z: number): number | null {
    let best: { axis: string; off: number } | null = null, bd = 16;
    for (const r of this.env.city.roads) {
      const off = (r.axis === 'x' ? z : x) - r.coord; const a = Math.abs(off) - r.half;
      if (a < bd) { bd = a; best = { axis: r.axis, off }; }
    }
    if (!best) return null;
    const sg = best.off >= 0 ? 1 : -1;
    return best.axis === 'x' ? (sg > 0 ? 0 : Math.PI) : sg > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  /** Rolled when a pedestrian reaches a corner: stop for a call / smoke / shop window, hail a cab, or pop into a shop. */
  private maybeActivity(n: Npc): boolean {
    if (n.role !== 'civilian' || n.actCool > 0 || n.buddy || Math.random() > 0.16) return false;
    const away = this.awayFromRoad(n.pos.x, n.pos.z), hr = streetClock.hour, night = hr >= 22 || hr < 5;
    if (!night && Math.random() < 0.35) { // sit down on a nearby bench
      const b = nearestFreeBench(n.pos.x, n.pos.z, n.pos.y, 26);
      if (b) { b.occupied = true; n.bench = b; n.activity = 'sit'; n.destPt = new THREE.Vector3(b.x + Math.sin(b.yaw) * 0.9, n.pos.y, b.z + Math.cos(b.yaw) * 0.9); n.stateT = 0; n.actCool = 40; return false; }
    }
    const r = Math.random();
    if (r < (night ? 0.12 : 0.34)) { // pop into a shop
      let best: { x: number; z: number; yaw: number } | null = null, bd = 34 * 34;
      for (const s of STORES) {
        if (night && s.kind !== 'convenience' && s.kind !== 'liquor' && s.kind !== 'gas' && s.kind !== 'diner') continue;
        if (s.standalone) continue;
        // the sliding door sits 3.1 m to the side of the shop's centreline, on the front face (local +z)
        const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw), fz = STORE_D / 2 + 1.2;
        const px = s.x + 3.1 * cy + fz * sy, pz = s.z - 3.1 * sy + fz * cy;
        const d = (px - n.pos.x) ** 2 + (pz - n.pos.z) ** 2; if (d > bd) continue;
        let clear = true; for (let k = 1; k < 8 && clear; k++) if (this.onRoad(n.pos.x + (px - n.pos.x) * k / 8, n.pos.z + (pz - n.pos.z) * k / 8)) clear = false;
        if (clear) { bd = d; best = { x: px, z: pz, yaw: s.yaw + Math.PI }; }
      }
      if (best) { n.activity = 'shop'; n.destPt = new THREE.Vector3(best.x, n.pos.y, best.z); n.destYaw = best.yaw; n.stateT = 0; n.actCool = 30; return false; }
    }
    if (r < 0.5) this.startAct(n, 'phone', 7 + Math.random() * 14, null);
    else if (r < 0.62) this.startAct(n, 'smoke', 8 + Math.random() * 12, away);
    else if (r < 0.8) this.startAct(n, 'window', 5 + Math.random() * 10, away);
    else if (r < 0.9 && away !== null) this.startAct(n, 'hail', 14 + Math.random() * 14, away + Math.PI);
    else return false;
    return true;
  }
  /** Sidewalk wandering on the pedestrian graph; obeys crossing signals. Returns walking speed. */
  private wander(n: Npc, dir: THREE.Vector3, dt: number): number {
    const city = this.env.city, nodes = city.pedNodes;
    // errand: walk straight to the shop door / the cab and go inside
    if ((n.activity === 'shop' || n.activity === 'taxi' || n.activity === 'sit' || n.activity === 'board') && n.destPt) {
      tv.set(n.destPt.x - n.pos.x, 0, n.destPt.z - n.pos.z); const dd = tv.length();
      if (dd < (n.activity === 'sit' ? 0.5 : 1.1)) { if (n.activity === 'sit') this.sitDown(n); else this.enterBuilding(n, n.activity === 'taxi' ? 30 : n.activity === 'board' ? 9999 : 10 + Math.random() * 28); return 0; }
      if (n.stateT > 45 || (n.stuckT > 0.5 && dd < 4 && n.stateT > 5)) { this.freeBench(n); n.activity = ''; n.destPt = null; n.node = -1; }
      else { dir.copy(tv.normalize()); return 1.5; }
    }
    // walking with a friend
    const mate = n.buddy;
    if (mate) {
      if (mate.disposed || !mate.alive || mate.brain === 'flee' || mate.brain === 'cower' || mate.brain === 'surrender' || mate.brain === 'scripted' || mate.char.inVehicle) { n.buddy = null; n.node = -1; }
      else if (mate.brain === 'idle' || mate.brain === 'inside') { this.startAct(n, 'wait', 90, Math.atan2(mate.pos.x - n.pos.x, mate.pos.z - n.pos.z)); return 0; }
      else {
        const fx = Math.sin(mate.char.yaw), fz = Math.cos(mate.char.yaw);
        tv.set(mate.pos.x + fz * 0.85 - fx * 0.5 - n.pos.x, 0, mate.pos.z - fx * 0.85 - fz * 0.5 - n.pos.z);
        const dd = tv.length(), ms = mate.char.speed;
        if (ms < 0.3) return dd > 2.2 ? (dir.copy(tv.normalize()), 1.4) : 0;
        dir.copy(tv.normalize());
        return THREE.MathUtils.clamp(ms + (dd - 0.4) * 1.6, 0.4, 2.8);
      }
    }
    if (n.node < 0 || n.nextNode < 0) {
      let best = 0, bd = Infinity;
      for (const nd of nodes) { if (Math.abs((nd.y ?? 0) - n.pos.y) > 2.5) continue; const d = (nd.x - n.pos.x) ** 2 + (nd.z - n.pos.z) ** 2; if (d < bd) { bd = d; best = nd.id; } }
      n.node = best; n.nextNode = best;
    }
    const target = nodes[n.nextNode];
    const from = nodes[n.node];
    // lateral offset to keep two-way foot traffic apart
    const ex = target.x - from.x, ez = target.z - from.z; const el = Math.hypot(ex, ez) || 1;
    const ox = (-ez / el) * n.laneOffset, oz = (ex / el) * n.laneOffset;
    tv.set(target.x + ox - n.pos.x, 0, target.z + oz - n.pos.z);
    const d = tv.length();
    if (d < 0.9 || (n.node === n.nextNode)) {
      const arrived = n.node !== n.nextNode;
      n.node = n.nextNode;
      if (arrived && this.maybeActivity(n)) return 0;
      const opts = nodes[n.node].edges;
      const e = opts[Math.floor(Math.random() * opts.length)];
      if (e.crossing) {
        const inter = city.intersections[e.crossing.intersection];
        if (!pedestrianMayCross(inter, e.crossing.axis, this.env.time()) && !(n.jay && n.waitT > 1.2 + n.laneOffset)) { n.waitT += dt; return 0; }
      }
      n.waitT = 0; n.nextNode = e.to;
      return 0;
    }
    dir.copy(tv.normalize());
    return 1.35;
  }
}
