/** NPC brains: civilians wander and react, gang members and police fight intelligently. */
import { type Bench, nearestFreeBench } from '../world/benches';
import { holdOnHuman } from '../combat/gunRig';
import { sweepEvery } from './sweepLod';
import * as THREE from 'three';
import { Character } from './character';
import type { HumanTemplate, Look } from './human';
import { meleeTargets, MELEE_POWER } from './character';
import { RAPIER, type Physics, groups, G_STATIC, G_VEHICLE } from '../core/physics';
import { type CityMap, type PedNode, pedSignal, surfaceAt } from '../world/citymap';
import { KERB_WAIT_BACK, NODE_INSET } from '../world/pedsignals';
import { WEAPONS, weaponMesh, MUZZLE, type WeaponId } from '../combat/weapons';
import type { Combat } from '../combat/combat';
import { Rng, wrapAngle } from '../core/rng';
import { STORES, STORE_D } from '../game/places';

export type Role = 'civilian' | 'gang' | 'police';
export type Brain = 'inside' | 'wander' | 'idle' | 'flee' | 'cower' | 'surrender' | 'combat' | 'chase' | 'dead' | 'scripted' | 'passenger' | 'fight' | 'ordered' | 'hostage';
/** R6-F: what the player ordered this person to do (brain 'ordered'); 'board' = reached the car door, waiting to be seated */
export type OrderKind = '' | 'kneel' | 'hands' | 'come' | 'car' | 'board';

/** Street-life activities of civilians (stand still doing something, walk to a shop, board a cab). */
export type Activity = '' | 'phone' | 'smoke' | 'window' | 'film' | 'hail' | 'wait' | 'shop' | 'taxi' | 'sit' | 'sitting' | 'board' | 'queue';
/** A rider walking to a bus / taxi door: that door is on the carriageway, so the kerb guard must let them step onto it. */
export function walksToVehicle(n: { activity: Activity; destPt: unknown }): boolean { return !!n.destPt && (n.activity === 'board' || n.activity === 'taxi'); }
const ACT_ANIM: Partial<Record<Activity, string>> = { phone: 'phone', smoke: 'smoke', film: 'film', hail: 'hail', wait: 'talk', sitting: 'sit', queue: 'phone' };
/** Seated pose: how far behind the bench centre the hips sit, and the root height offset above the seat (tuned against the Sitting_Idle_Loop clip). */
const SIT_BACK = 0.12, SIT_DY = 0.02;
/** World clock for time-of-day behaviour (the game sets this each frame). */
export const streetClock = { hour: 17 };

const EYE = 1.55;
/** Officers fire the taser at a non-violent suspect from this far (metres). */
export const TASER_RANGE = 8;
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
  animAcc = Math.random() * 0.016; // random phase: people on the 30 Hz skeleton rate do not all land on the same frames
  /** Round 12 animation LOD: on screen last frame, frames since the last gun-hold solve, and the body position at that solve */
  inView = true; holdWasInView = true; /** the skeleton was re-posed this frame (set by Population.update) */ posed = true; holdPos = new THREE.Vector3(); holdValid = false;
  /** Makes the next updateModel solve the gun hold immediately (hit tests that need current arm bones call this, then updateModel). */
  forcePose() { this.holdValid = false; }
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
  buddy: Npc | null = null; disposed = false;
  /** courage 0..1: brave civilians fight back when punched, timid ones run or call the cops */
  nerve = Math.random();
  /** last time gunfire went off near this person (game time), and when their hands went up */
  shotAt = -100; handsAt = -100;
  /** the sidewalk edge chosen at the current corner (committed so the pedestrian can wait for the walk sign), and the crossing leg flag */
  pend: PedNode['edges'][number] | null = null; onCross = false;
  /** pedestrian avoidance (recomputed ~8 times a second): sideways push, slow-down, timer */
  avx = 0; avz = 0; avSlow = 1; avT = 0;
  /** fist fight: seconds since either side landed or threw a blow, dodge/step timers, strafing side, punches thrown */
  fightT = 0; dodgeT = 0; dodgeCool = 0; strafeT = 0; strafeDir = 1; playerSwung = false; dodgeDir = new THREE.Vector3(); callCops = false;
  destPt: THREE.Vector3 | null = null; destYaw = 0;
  /** R6-F orders: current order, seconds since it was given, seconds before the person relaxes and goes about their day */
  order: OrderKind = ''; orderT = 0; orderMax = 25;
  /** the bench this pedestrian is walking to / sitting on */
  bench: Bench | null = null;
  /** delayed reaction to danger: seconds until it registers, and where from */
  alertT = 0; alertFrom = new THREE.Vector3(); alertFar = false;
  /** tactical cover-peek cadence & big-firefight squad role for officers */
  peekT = 0; peeking = false;
  squadRole: 'flanker' | 'suppressor' | 'breacher' | 'default' = 'default';
  suppressedT = 0;
  fragCd = 8 + Math.random() * 6;
  /** organic pedestrian reactivity: cooldown between soft flinches/gestures, lateral yield step, personal-space crowd timer, and gaze target */
  reactCool = 0; yieldX = 0; yieldZ = 0; yieldT = 0; crowdT = 0;
  lookAtPos = new THREE.Vector3(); lookAtT = 0;
  /** reusable goal vector so combat repositioning avoids per-tick allocations */
  readonly goalBuf = new THREE.Vector3();
  setGoal(x: number, y: number, z: number): THREE.Vector3 { this.goalBuf.set(x, y, z); this.goal = this.goalBuf; return this.goalBuf; }
  constructor(physics: Physics, tpl: HumanTemplate, look: Look, public role: Role, x: number, z: number, y = 0.2) {
    this.char = new Character(physics, tpl, look, role === 'police' ? 'police' : role === 'gang' ? 'gang' : 'civilian', x, z, y);
    this.home.set(x, y, z);
    this.laneOffset = (Math.random() - 0.5) * 1.6;
    this.speedMul = role === 'civilian' ? 0.86 + Math.random() * 0.28 : 1;
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
  player: Character; playerHeat: () => number; /** Round 9: cars people should get out of the way of (sirens, a car coming fast) */ movers?: () => ReadonlyArray<{ x: number; z: number; fx: number; fz: number; speed: number; siren: boolean }>; copsLethal?: () => boolean; /** an arrest is in progress: every other officer holds fire */ copsHoldFire?: (by?: Npc) => boolean; /** the player is pointing a gun */ armedThreat?: () => boolean; others: () => Iterable<Character>;
  onArrest: (by: Npc) => void; onWitness: (npc: Npc, what: 'shot' | 'attack' | 'kill' | 'carjack') => void;
}

const UP = new THREE.Vector3(0, 1, 0);
const _qGunFix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tvDesired = new THREE.Vector3(), tvO = new THREE.Vector3(), tvA = new THREE.Vector3(), tvS = new THREE.Vector3(), tvCand = new THREE.Vector3(), tvBest = new THREE.Vector3();
export class NpcBrainRunner {
  private rng = new Rng(99);
  private ball = new RAPIER.Ball(0.35);
  private campPos = new THREE.Vector3();
  private campT = 0;
  private campLastT = -1;
  private squadFragCd = 6;
  constructor(private env: NpcEnv) { }

  /** Per-tick budgets shared by all fighters so a big firefight costs a bounded number of physics queries. */
  rays = 8; covers = 1;
  beginTick(maxRays = 8) {
    this.rays = maxRays; this.covers = 1;
    const now = this.env.time();
    if (this.campLastT >= 0) {
      const dt = Math.min(0.1, Math.max(0, now - this.campLastT));
      this.squadFragCd = Math.max(0, this.squadFragCd - dt);
      const p = this.env.player;
      if (p.alive && !p.inVehicle && this.env.playerHeat() >= 4) {
        if (this.campPos.distanceToSquared(p.pos) < 4.5 * 4.5) this.campT += dt;
        else { this.campPos.copy(p.pos); this.campT = 0; }
      } else { this.campT = 0; }
    } else {
      this.campPos.copy(this.env.player.pos);
    }
    this.campLastT = now;
  }
  private lethal() { return this.env.copsLethal ? this.env.copsLethal() : this.env.playerHeat() >= 2; }
  hasLOS(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z; const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = this.env.physics.ray(from.x, from.y, from.z, dx / d, dy / d, dz / d, d - 0.3, groups(0xffff, G_STATIC | G_VEHICLE));
    return !hit;
  }
  /** Full-length static/vehicle ray (no end margin): is the segment a -> b free? */
  clearPath(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz); if (d < 0.01) return true;
    return !this.env.physics.ray(a.x, a.y, a.z, dx / d, dy / d, dz / d, d + 0.05, groups(0xffff, G_STATIC));
  }
  private eye(c: Character, out: THREE.Vector3) { return out.set(c.pos.x, c.pos.y + EYE * c.human.look.height, c.pos.z); }
  private chest(c: Character, out: THREE.Vector3) { return out.set(c.pos.x, c.pos.y + 1.2 * c.human.look.height, c.pos.z); }
  private pointFree(p: THREE.Vector3): boolean {
    let blocked = false;
    this.env.physics.world.intersectionsWithShape({ x: p.x, y: p.y + 0.9, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, this.ball, () => { blocked = true; return false; }, undefined, groups(0xffff, G_STATIC | G_VEHICLE));
    return !blocked;
  }
  /** Finds a nearby point that breaks line of sight to the threat (role-aware scoring, zero loop allocations). */
  findCover(n: Npc, threat: THREE.Vector3): THREE.Vector3 | null {
    if (this.covers <= 0) return null;
    this.covers--;
    let found = false, bestScore = Infinity;
    const te = tv2.copy(threat).setY(threat.y + 1.2);
    const idealDist = n.squadRole === 'breacher' ? 11 : n.squadRole === 'suppressor' ? 21 : 16;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.rng.range(0, 0.4), r = this.rng.range(2.5, 9.5);
      tvCand.set(n.pos.x + Math.cos(a) * r, n.pos.y, n.pos.z + Math.sin(a) * r);
      if (!this.pointFree(tvCand)) continue;
      const chestP = tv.set(tvCand.x, tvCand.y + 1.1, tvCand.z);
      if (this.hasLOS(te, chestP)) continue;
      const toThreat = tvCand.distanceTo(threat);
      const score = r * 0.85 + Math.abs(toThreat - idealDist) * 0.45 + (toThreat < 6 ? 20 : 0);
      if (score < bestScore) { bestScore = score; tvBest.copy(tvCand); found = true; }
    }
    return found ? tvBest.clone() : null;
  }

  /** AI decision + movement for one NPC (fixed step). */
  update(n: Npc, dt: number) {
    const c = n.char, env = this.env, t = env.time();
    if (!c.alive) { n.brain = 'dead'; return; }
    n.think -= dt; n.cooldown -= dt; n.stateT += dt; n.actCool -= dt;
    if (n.reactCool > 0) n.reactCool -= dt;
    if (n.yieldT > 0) n.yieldT -= dt;
    if (n.lookAtT > 0) n.lookAtT -= dt;
    if (n.crowdT > 0) n.crowdT = Math.max(0, n.crowdT - dt * 0.55);
    if (n.activity && (n.brain === 'flee' || n.brain === 'cower' || n.brain === 'surrender' || n.brain === 'fight')) this.endAct(n);
    if (c.blockT > 0) c.blockT -= dt;
    // poses belong to their brain: hands go down when the person runs / cowers / is hit, the guard drops when the fight is over
    if (n.brain !== 'surrender' && n.brain !== 'scripted' && n.brain !== 'hostage' && !(n.brain === 'ordered' && n.order !== 'kneel') && c.human.actionName === 'hands_up') c.human.stopAction('hands_up');
    if (n.brain !== 'ordered' && c.human.actionName === 'kneel_head') c.human.stopAction('kneel_head');
    if (n.brain !== 'fight' && c.human.actionName === 'guard') c.human.stopAction('guard');
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
        else if (n.role === 'police' && !this.lethal() && n.brain === 'combat') n.brain = 'chase'; // Round 9: the suspect put the gun away
        if (n.brain !== 'combat' && n.brain !== 'chase' && d < 30) { n.brain = 'chase'; n.target = p; n.lastSeen.copy(p.pos); }
      } else if (n.brain === 'combat' || n.brain === 'chase') { n.brain = n.role === 'police' ? 'idle' : 'idle'; n.target = null; }
    }
    // Round 9 (owner: pedestrians should get out of the way of cops): a person in the path of a siren car (or of a car
    // coming fast at them) steps / runs clear, away from the car's line
    if (n.think <= 0 && n.role === 'civilian' && (n.brain === 'wander' || n.brain === 'idle') && env.movers) {
      for (const m of env.movers()) {
        const rx = c.pos.x - m.x, rz = c.pos.z - m.z, ahead = rx * m.fx + rz * m.fz;
        if (ahead < 1 || ahead > Math.max(14, m.speed * (m.siren ? 2.2 : 1.6))) continue;
        const lat = rx * m.fz - rz * m.fx; if (Math.abs(lat) > (m.siren ? 4.5 : 3)) continue;
        if (this.endAct) this.endAct(n);
        n.brain = 'flee'; n.stateT = 5.6; n.callCops = false; // a short dash (flee ends at 7 s)
        n.fleeFrom.set(c.pos.x - m.fz * Math.sign(lat || 1) * 3 - m.fx * 0.5, c.pos.y, c.pos.z + m.fx * Math.sign(lat || 1) * 3 - m.fz * 0.5);
        break;
      }
    }
    if (n.think <= 0 && !deferThink) n.think = 0.25 + Math.random() * 0.25;

    switch (n.brain) {
      case 'wander': {
        speed = this.wander(n, desired, dt) * n.speedMul;
        if (n.yieldT > 0) {
          const onFootpath = !n.onCross && !n.pend?.crossing && !walksToVehicle(n);
          const safe = !onFootpath || surfaceAt(env.city, c.pos.x + n.yieldX * 1.15, c.pos.z + n.yieldZ * 1.15) !== 'road';
          if (safe) {
            desired.x += n.yieldX * 1.35; desired.z += n.yieldZ * 1.35;
            if (desired.lengthSq() > 1e-4) desired.normalize();
            speed = Math.max(speed, 1.95 * n.speedMul);
          }
        }
        break;
      }
      case 'idle': {
        speed = 0;
        if (n.role !== 'civilian') break;
        if (n.idleFace !== null) faceYaw = n.idleFace;
        if (n.yieldT > 0 && n.activity !== 'sitting' && surfaceAt(env.city, c.pos.x + n.yieldX * 1.1, c.pos.z + n.yieldZ * 1.1) !== 'road') {
          desired.set(n.yieldX, 0, n.yieldZ);
          if (desired.lengthSq() > 1e-4) { desired.normalize(); speed = 1.65; }
        }
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
        // Round 8: run along the pavement, not out into the traffic: the escape heading closest to "away" that stays off the
        // road (a person already in the road takes the shortest way back to the kerb)
        { const a0 = Math.atan2(tv.x, tv.z), k = fleeHeading(a0, (a: number, r: number) => this.onRoad(c.pos.x + Math.sin(a) * r, c.pos.z + Math.cos(a) * r), this.onRoad(c.pos.x, c.pos.z));
          if (k !== null) desired.set(Math.sin(k), 0, Math.cos(k)); }
        if (n.callCops && n.stateT > 2.5 && c.pos.distanceTo(n.fleeFrom) > 9) { // a safe distance away: stop and phone it in
          n.callCops = false; env.onWitness(n, 'attack');
          this.startAct(n, 'phone', 6 + Math.random() * 4, Math.atan2(n.fleeFrom.x - c.pos.x, n.fleeFrom.z - c.pos.z)); break;
        }
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
      case 'fight': {
        const tgt = n.target ?? env.player;
        const dx = tgt.pos.x - c.pos.x, dz = tgt.pos.z - c.pos.z, d = Math.hypot(dx, dz) || 0.01;
        faceYaw = Math.atan2(dx, dz);
        n.fightT += dt; n.dodgeCool -= dt; n.strafeT -= dt;
        if (!tgt.alive || c.health < c.maxHealth * 0.3 || d > 20 || n.fightT > 12 || (tgt.inVehicle && d > 3) || tgt.inVehicle) { this.endFight(n, tgt); break; }
        // the opponent winds up a swing: slip it (step back), or cover up
        const sw = tgt.meleeActive;
        if (sw && !n.playerSwung && d < 2.1 && n.dodgeCool <= 0 && c.downT <= 0 && !c.meleeActive) {
          n.dodgeCool = 1.1 + Math.random() * 1.2;
          const r = Math.random();
          if (r < 0.38) { n.dodgeT = 0.3; const a = (Math.random() - 0.5) * 1.3; n.dodgeDir.set(-dx / d, 0, -dz / d).applyAxisAngle(UP, a); }
          else if (r < 0.75) { c.blockT = 0.6; c.human.playAction('block', { hold: false }); }
        }
        n.playerSwung = sw;
        if (n.dodgeT > 0) { n.dodgeT -= dt; desired.copy(n.dodgeDir); speed = 3.8; n.mdir.copy(desired); n.mspeed = speed; }
        else if (d > 1.5) { desired.set(dx / d, 0, dz / d); speed = d > 4 ? 4.4 : 2.6; }
        else if (d < 0.85) { desired.set(-dx / d, 0, -dz / d); speed = 1.5; }
        else {
          if (n.strafeT <= 0) { n.strafeT = 1 + Math.random() * 1.6; n.strafeDir = Math.random() < 0.5 ? 1 : -1; }
          desired.set(-dz / d * n.strafeDir, 0, dx / d * n.strafeDir); speed = 0.8;
        }
        if (d < 1.5 && n.cooldown <= 0 && n.dodgeT <= 0 && c.blockT <= 0 && !c.meleeActive && Math.abs(wrapAngle(faceYaw - c.yaw)) < 0.5) {
          this.meleeAttack(n, tgt);
          if (n.cooldown > 0) { n.cooldown += 0.35 + Math.random() * 0.8 + (1 - n.nerve) * 0.5; n.fightT = Math.min(n.fightT, 6); }
        }
        if (!c.meleeActive && !c.human.busy && !c.human.actionName) c.human.playAction('guard', { hold: true });
        break;
      }
      case 'chase': {
        const tgt = n.target ?? env.player;
        tv.copy(n.lastSeen).sub(c.pos); tv.y = 0; const d = tv.length();
        if (d > 1.2) { desired.copy(tv.normalize()); speed = n.role === 'police' ? (d > 25 ? 5.8 : d > 7 ? 4.4 : 2.2) : 5.2; }
        // non-violent suspect on foot: draw the taser from up to TASER_RANGE away (clear line, not just when touching), then arrest
        if (n.role === 'police' && !this.lethal() && !env.armedThreat?.() && tgt.alive && !tgt.inVehicle && !n.char.inVehicle) {
          const td = c.pos.distanceTo(tgt.pos);
          if (td < TASER_RANGE && (td < 2.5 || n.losT > 0)) {
            faceYaw = Math.atan2(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z); aiming = true;
            if (td > 2.5) speed = Math.min(speed, 1.2); // plant feet and aim
            n.arrestT += dt * (tgt.speed > 4 ? 0.7 : 1);
            if (n.arrestT > 1.0) { n.arrestT = 0; env.onArrest(n); }
          } else n.arrestT = Math.max(0, n.arrestT - dt);
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
        if (n.suppressedT > 0) n.suppressedT = Math.max(0, n.suppressedT - dt);
        if (n.fragCd > 0) n.fragCd = Math.max(0, n.fragCd - dt);
        const roleIdeal = n.squadRole === 'breacher' ? 10 : n.squadRole === 'suppressor' ? 21 : n.squadRole === 'flanker' ? 14 : 15;
        const ideal = w.melee ? 1.2 : w.id === 'shotgun' ? 9 : w.id === 'rifle' ? Math.max(roleIdeal, 18) : roleIdeal;
        if (seeing) n.aimT += dt; else n.aimT = Math.max(0, n.aimT - dt * 2);
        // Suppressive-fire reaction: incoming rounds near an officer force them to duck behind cover or sprint out of the open
        if (n.suppressedT > 0.3 && n.role === 'police' && !w.melee) {
          if (n.coverPoint && c.pos.distanceToSquared(n.coverPoint) < 4) {
            n.crouching = true; n.peeking = false; n.peekT = Math.max(n.peekT, 0.7);
          } else if (!n.goal) {
            const cov = this.findCover(n, tgt.pos);
            if (cov) { n.coverPoint = cov; n.goal = cov; n.holdCoverT = 2.2; }
            else { n.crouching = true; n.peeking = false; }
          }
        }
        // Tactical repositioning (role-aware flanking, cover bounding, and zero-alloc goal updates)
        n.holdCoverT = Math.max(0, n.holdCoverT - dt);
        if (n.holdCoverT <= 0 && (n.think <= 0.05 || !n.goal)) {
          const lowHealth = c.health < c.maxHealth * 0.32;
          if (w.melee) n.setGoal(tgt.pos.x, tgt.pos.y, tgt.pos.z);
          else if (lowHealth && !n.coverPoint) {
            n.coverPoint = this.findCover(n, tgt.pos);
            if (n.coverPoint) n.goal = n.coverPoint;
            else { tv.copy(c.pos).sub(tgt.pos).setY(0).normalize(); n.setGoal(c.pos.x + tv.x * 6, c.pos.y, c.pos.z + tv.z * 6); }
          } else if (!seeing) {
            // Flankers swing wide around last-seen instead of funneling straight into the player's sightline
            if (n.squadRole === 'flanker') {
              const side = (n.id % 2 === 0 ? 1 : -1);
              tv.copy(n.lastSeen).sub(c.pos).setY(0).normalize();
              n.setGoal(n.lastSeen.x - tv.z * side * 6.5, n.lastSeen.y, n.lastSeen.z + tv.x * side * 6.5);
            } else n.setGoal(n.lastSeen.x, n.lastSeen.y, n.lastSeen.z);
          } else if (d > ideal * 1.35) { // close to firing range, spread across wide flanking arcs by squad role
            const away = tv.copy(c.pos).sub(tgt.pos).setY(0).normalize();
            const flank = n.squadRole === 'flanker' ? ((n.id % 2 === 0 ? 1 : -1) * 1.05) : (((n.id % 5) - 2) * 0.48);
            const ca = Math.cos(flank), sa = Math.sin(flank);
            n.setGoal(tgt.pos.x + (away.x * ca - away.z * sa) * ideal, tgt.pos.y, tgt.pos.z + (away.x * sa + away.z * ca) * ideal);
          } else if (n.stateT > (n.squadRole === 'breacher' ? 1.8 : 2.5) && Math.random() < (n.role === 'police' ? 0.62 : 0.35)) { // bound between cover or lateral flank
            const cover = Math.random() < (n.squadRole === 'suppressor' ? 0.78 : 0.62) ? this.findCover(n, tgt.pos) : null;
            if (cover && cover.distanceTo(tgt.pos) < ideal * 2) { n.coverPoint = cover; n.goal = cover; }
            else {
              const side = tv.copy(tgt.pos).sub(c.pos).setY(0).normalize();
              const dirSign = n.squadRole === 'flanker' ? (n.id % 2 === 0 ? 1 : -1) : (Math.random() < 0.5 ? -1 : 1);
              const step = this.rng.range(2.4, n.squadRole === 'flanker' ? 6.5 : 5);
              n.setGoal(c.pos.x - side.z * dirSign * step, c.pos.y, c.pos.z + side.x * dirSign * step);
            }
            n.stateT = 0;
          } else if (d < ideal * 0.5 && !w.melee && n.squadRole !== 'breacher') {
            tv.copy(c.pos).sub(tgt.pos).setY(0).normalize();
            n.setGoal(c.pos.x + tv.x * 3.5, c.pos.y, c.pos.z + tv.z * 3.5);
          } else n.goal = null;
        }
        if (n.goal) {
          tv.copy(n.goal).sub(c.pos); tv.y = 0; const gd = tv.length();
          const sprintBound = n.suppressedT > 0.2 || n.squadRole === 'flanker' || n.squadRole === 'breacher';
          if (gd > 0.8) { desired.copy(tv.normalize()); speed = w.melee ? 5.5 : gd > 14 ? 5.4 : seeing ? (gd > 4 ? (sprintBound ? 4.4 : 3.6) : 2.2) : 4.5; }
          else { if (n.goal === n.coverPoint || (n.role === 'police' && seeing)) { n.crouching = true; n.peeking = false; n.peekT = 0.6 + Math.random() * 0.5; } n.goal = null; }
        }
        if (speed > 0) { n.crouching = false; n.peeking = false; }
        else if (n.role === 'police' && !w.melee) {
          // Tactical cover-peek & crouch-reload: officers duck when reloading or suppressed and cycle between cover and firing bursts
          if (n.reloadT > 0 || n.suppressedT > 0.4) { n.crouching = true; n.peeking = false; }
          else {
            n.peekT -= dt;
            if (n.peekT <= 0) {
              if (n.crouching && seeing) { n.crouching = false; n.peeking = true; n.peekT = (n.squadRole === 'suppressor' ? 2.1 : 1.5) + Math.random() * 1.0; }
              else if (n.peeking || n.coverPoint) { n.crouching = true; n.peeking = false; n.peekT = 0.75 + Math.random() * 0.65; }
            }
          }
        }
        if (w.melee) { if (d < 1.6) this.meleeAttack(n, tgt); faceYaw = Math.atan2(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z); break; }
        // 4-5 star SWAT / Army anti-camping frag grenade flush when the player digs into one spot
        if (n.role === 'police' && c.maxHealth >= 130 && env.playerHeat() >= 4 && seeing && !tgt.inVehicle && d > 11 && d < 27 && this.campT > 7.5 && this.squadFragCd <= 0 && n.fragCd <= 0 && !(env.copsHoldFire?.(n))) {
          const hand = tvO.set(c.pos.x, c.pos.y + 1.55, c.pos.z);
          const dir = tvA.set(tgt.pos.x - hand.x, (tgt.pos.y + 0.8 + d * 0.14) - hand.y, tgt.pos.z - hand.z).normalize();
          env.combat.launch(c, WEAPONS.grenade, hand, dir, 0.04, Math.min(1.2, 0.72 + d * 0.02));
          c.human.playOnce('Punch_Cross', 'upper', 0.06, { rate: 1.3 });
          this.squadFragCd = 15; n.fragCd = 20; this.campT = 0; n.cooldown = 1.2;
          break;
        }
        // Shooting (nobody fires while a colleague is arresting the suspect: the bullets would hit the officer)
        const tuckedInCover = n.role === 'police' && n.crouching && !!n.coverPoint && !n.peeking && d > 9;
        if (seeing && d < w.range && !tuckedInCover && !(n.role === 'police' && env.copsHoldFire?.(n))) {
          aiming = true;
          faceYaw = Math.atan2(tgt.pos.x - c.pos.x, tgt.pos.z - c.pos.z);
          const facingOk = Math.abs(wrapAngle(faceYaw - c.yaw)) < 0.35;
          if (n.clip <= 0 && n.reloadT <= 0) { n.reloadT = w.reload * 1.3; if (n.role === 'police') n.crouching = true; c.human.playOnce('Pistol_Reload', 'upper', 0.1); }
          else if (facingOk && n.cooldown <= 0 && n.reloadT <= 0 && n.aimT > (n.role === 'police' ? 0.42 : 0.8) && tgt.alive) {
            const tFire = npcFireTiming(n.role === 'police', w.auto, w.interval, n.burst, Math.random());
            if (n.burst <= 0) n.burst = tFire.burst + (n.squadRole === 'suppressor' && w.auto ? 2 : 0);
            this.fire(n, tgt, d);
            n.burst--;
            n.cooldown = n.burst > 0 ? tFire.between : tFire.pause;
          }
        }
        break;
      }
      case 'ordered': { // R6-F: the player gave an order and this person complied
        const pl = env.player, dx = pl.pos.x - c.pos.x, dz = pl.pos.z - c.pos.z, d = Math.hypot(dx, dz) || 0.01;
        n.orderT += dt; faceYaw = Math.atan2(dx, dz);
        if (!pl.alive || d > 32 || (n.order !== 'board' && n.orderT > n.orderMax)) { this.releaseOrder(n); break; }
        if (n.order === 'kneel') { speed = 0; if (c.human.actionName !== 'kneel_head' && !c.human.busy) c.human.playAction('kneel_head'); }
        else if (n.order === 'hands') { speed = 0; if (c.human.actionName !== 'hands_up' && !c.human.busy) c.human.playAction('hands_up'); }
        else if (n.order === 'come') {
          // Round 7: a brisk, nervous walk over with the hands kept up (they used to drop them and amble)
          if (d > 1.7) { desired.set(dx / d, 0, dz / d); speed = d > 5 ? 3.3 : 2.6; }
          else speed = 0;
          if (c.human.actionName !== 'hands_up' && !c.human.busy) c.human.playAction('hands_up');
        } else if (n.order === 'car' && n.destPt) {
          tv.copy(n.destPt).sub(c.pos); tv.y = 0; const gd = tv.length(); faceYaw = null;
          if (gd > 0.9) { desired.copy(tv.normalize()); speed = gd > 5 ? 3.6 : 2.4; } else { n.order = 'board'; speed = 0; }
        } else speed = 0; // 'board': the Orders manager seats this person next frame
        break;
      }
      case 'hostage': { // R6-F: human shield: stays just in front of the holder, facing the same way, hands up
        const pl = env.player; speed = 0; faceYaw = pl.yaw;
        const sx = pl.pos.x + Math.sin(pl.yaw) * 0.7, sz = pl.pos.z + Math.cos(pl.yaw) * 0.7, dx = sx - c.pos.x, dz = sz - c.pos.z, d = Math.hypot(dx, dz);
        if (d > 3.5) { c.place(sx, pl.pos.y, sz, pl.yaw); }
        else if (d > 0.04) { desired.set(dx / d, 0, dz / d); speed = Math.min(d / Math.max(dt, 0.016), 7.5); }
        if (c.human.actionName !== 'hands_up' && !c.human.busy) c.human.playAction('hands_up');
        break;
      }
      case 'scripted': case 'passenger': case 'dead': break;
    }
    // Smooth steering for both fighters and civilians so nobody snaps direction robotically
    if ((n.role !== 'civilian' && (n.brain === 'combat' || n.brain === 'chase')) || n.brain === 'fight') {
      const k = 1 - Math.exp(-dt * 5.5);
      if (speed > 0) { if (n.mspeed < 0.2) n.mdir.copy(desired); else n.mdir.lerp(desired, k).normalize(); }
      n.mspeed += (speed - n.mspeed) * (1 - Math.exp(-dt * 4.5));
      if (n.mspeed < 0.15) { n.mspeed = 0; speed = 0; } else { desired.copy(n.mdir); speed = n.mspeed; }
    } else if (n.brain === 'wander' || n.brain === 'idle' || n.brain === 'flee' || n.brain === 'ordered') {
      const turnRate = n.brain === 'flee' ? 11 : 7.5;
      const accelRate = n.brain === 'flee' ? 10 : 6.5;
      if (speed > 0 && desired.lengthSq() > 1e-4) {
        if (n.mspeed < 0.12 || n.mdir.lengthSq() < 1e-4) n.mdir.copy(desired);
        else n.mdir.lerp(desired, 1 - Math.exp(-dt * turnRate)).normalize();
      }
      n.mspeed += (speed - n.mspeed) * (1 - Math.exp(-dt * accelRate));
      if (n.mspeed < 0.08 && speed === 0) { n.mspeed = 0; speed = 0; }
      else if (n.mdir.lengthSq() > 1e-4) { desired.copy(n.mdir); speed = n.mspeed; }
    } else n.mspeed = speed;
    // Movement with simple stuck recovery
    if (speed > 0) {
      if (n.sideT > 0) {
        n.sideT -= dt;
        // A walker on the footpath never side-steps (stuck recovery) onto the carriageway: use the other side, else just wait it out
        if (n.brain === 'wander' && !n.onCross && !n.pend?.crossing && !walksToVehicle(n)) {
          const d0 = desired, k = 1.3, px = c.pos.x, pz = c.pos.z, city = this.env.city;
          if (surfaceAt(city, px - d0.z * n.sideDir * k, pz + d0.x * n.sideDir * k) === 'road' && surfaceAt(city, px, pz) !== 'road') {
            n.sideDir = -n.sideDir;
            if (surfaceAt(city, px - d0.z * n.sideDir * k, pz + d0.x * n.sideDir * k) === 'road') n.sideT = 0;
          }
        }
        if (n.sideT > 0) { const s = n.sideDir; desired.set(desired.x * 0.3 - desired.z * s, 0, desired.z * 0.3 + desired.x * s).normalize(); }
      }
      tv.copy(desired).multiplyScalar(speed);
    } else tv.set(0, 0, 0);
    if (n.far) { // cheap movement without collision when far from the player
      c.pos.addScaledVector(tv, dt); c.vel.copy(tv);
      { const nd = n.nextNode >= 0 ? this.env.city.pedNodes[n.nextNode] : undefined; if (nd && (nd.y !== undefined || c.pos.y > 0.6)) { const ty = (nd.y ?? 0) + 0.2; c.pos.y += THREE.MathUtils.clamp(ty - c.pos.y, -dt * 1.2, dt * 1.2); } } // bridge walkways: follow the deck height
      c.body.setNextKinematicTranslation({ x: c.pos.x, y: c.pos.y + 0.87, z: c.pos.z });
    } else {
      // Round 12 perf: officers / gang members far away or off screen batch their collision sweep (src/actors/sweepLod.ts)
      c.sweepEvery = n.role !== 'civilian' && c.knockT <= 0 && c.downT <= 0 ? sweepEvery(c.pos.distanceToSquared(env.player.pos), n.inView) : 1;
      c.move(tv, dt, false);
    }
    // Kerbs are not colliders: a calm walker shoved sideways (a jostling group, a stuck side-step, a buddy offset) must never end up
    // on the carriageway away from a crossing. Undo the step and re-anchor onto the footpath graph from there.
    if (n.brain === 'wander' && n.role === 'civilian' && !n.far && !n.onCross && !n.pend?.crossing && !walksToVehicle(n) && c.grounded) {
      const ddx = c.pos.x - n.lastPos.x, ddz = c.pos.z - n.lastPos.z, still = ddx * ddx + ddz * ddz <= 1e-6;
      if ((!still || n.stuckT > 0.3) && this.onRoad(c.pos.x, c.pos.z, 0.05)) {
        if (!still && !this.onRoad(n.lastPos.x, n.lastPos.z, 0.05)) { c.setPosition(n.lastPos.x, c.pos.y, n.lastPos.z); c.vel.x = 0; c.vel.z = 0; n.sideT = 0; n.pend = null; n.node = -1; n.nextNode = -1; }
        else if (still) { n.sideT = 0; n.pend = null; n.node = -1; n.nextNode = -1; n.stuckT = 0; } // stuck in the road: head for the nearest kerb
      }
    }
    if (speed > 0 && c.swept) {
      const moved = c.pos.distanceTo(n.lastPos);
      if (moved < speed * dt * 0.25) { n.stuckT += dt; if (n.stuckT > 0.6) { n.stuckT = 0; n.sideT = 0.8; n.sideDir = Math.random() < 0.5 ? 1 : -1; if (n.brain === 'combat') n.goal = null; } }
      else n.stuckT = Math.max(0, n.stuckT - dt);
    }
    if (c.swept) n.lastPos.copy(c.pos);
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
    h.setUpperMode(n.weapon !== 'fists' && (aiming || n.brain === 'combat') ? 'pistol' : n.weapon !== 'fists' && n.brain === 'chase' ? (WEAPONS[n.weapon].twoHanded ? 'carry' : 'loco') : 'loco'); // one-hand guns leave the free arm swinging
    // Organic head/neck gaze tracking: fighters lock eyes on their target, civilians glance at nearby movement or scan crosswalks
    if (!n.far) {
      let gx = 0, gy = 0, gz = 0, hasGaze = false;
      if ((n.brain === 'combat' || n.brain === 'chase' || n.brain === 'fight') && n.target?.alive) {
        gx = n.target.pos.x; gy = n.target.pos.y + 1.45; gz = n.target.pos.z; hasGaze = true;
      } else if (n.lookAtT > 0) {
        gx = n.lookAtPos.x; gy = n.lookAtPos.y; gz = n.lookAtPos.z; hasGaze = true;
      }
      if (hasGaze) {
        const dx = gx - c.pos.x, dz = gz - c.pos.z, hd = Math.hypot(dx, dz);
        const rel = wrapAngle(Math.atan2(dx, dz) - c.yaw);
        if (hd > 0.35 && Math.abs(rel) < 1.35) {
          h.lookYaw = THREE.MathUtils.clamp(rel, -0.88, 0.88);
          h.lookPitch = THREE.MathUtils.clamp(Math.atan2(gy - (c.pos.y + 1.55), Math.max(0.8, hd)), -0.35, 0.35);
        } else { h.lookYaw = 0; h.lookPitch = 0; }
      } else if (n.brain === 'wander' && n.pend?.crossing) {
        h.lookYaw = Math.sin(t * 1.35 + n.id * 1.7) * 0.42;
        h.lookPitch = -0.04;
      } else { h.lookYaw = 0; h.lookPitch = 0; }
    }
    h.aimPitch = 0;
  }
  /**
   * A civilian was just hit by `from`. A bare-fisted attacker starts a fist fight with healthy, brave-enough people (the rest run;
   * the timid ones phone the police once they are clear); anything armed or a gunshot sends everybody running.
   */
  provoke(n: Npc, from: Character, melee: boolean, killed: boolean) {
    if (!n.alive || killed || n.role !== 'civilian') return;
    if (n.brain === 'scripted' || n.brain === 'passenger' || n.brain === 'inside') { n.brain = 'flee'; n.fleeFrom.copy(from.pos); n.stateT = 0; return; }
    const c = n.char;
    if (n.brain === 'fight') { n.fightT = 0; return; }
    const healthy = c.health >= c.maxHealth * 0.5 && !from.inVehicle;
    if (melee && healthy && Math.random() < (n.nerve > 0.4 ? 0.9 : 0.12)) {
      if (n.activity || n.brain === 'idle') this.endAct(n);
      n.brain = 'fight'; n.target = from; n.fightT = 0; n.stateT = 0; n.cooldown = 0.3 + Math.random() * 0.4; n.dodgeCool = 0.4; n.playerSwung = false;
      if (c.human.currentState === 'cower' || c.human.currentState === 'crouch') c.human.setState('loco');
      if (c.human.actionName) c.human.stopAction(c.human.actionName);
      return;
    }
    n.brain = 'flee'; n.fleeFrom.copy(from.pos); n.stateT = 0;
    if (n.nerve < 0.25) n.callCops = true;
  }
  /** The order has run its course (or the player left): the person relaxes, stops posing and goes about their day. */
  releaseOrder(n: Npc) {
    const h = n.char.human;
    if (h.actionName === 'kneel_head' || h.actionName === 'hands_up') h.stopAction();
    n.order = ''; n.orderT = 0; n.node = -1; n.goal = null; n.destPt = null; n.brain = 'wander'; n.stateT = 0;
  }
  private endFight(n: Npc, tgt: Character) {
    if (n.char.human.actionName === 'guard') n.char.human.stopAction('guard');
    n.fightT = 0; n.stateT = 0; n.node = -1; n.pend = null;
    if (tgt.alive && n.char.health < n.char.maxHealth * 0.3) { n.brain = 'flee'; n.fleeFrom.copy(tgt.pos); if (n.nerve < 0.5) n.callCops = true; }
    else if (tgt.alive && tgt.inVehicle) { n.brain = 'flee'; n.fleeFrom.copy(tgt.pos); n.stateT = 3; }
    else n.brain = 'wander';
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
    let origin = this.muzzle(n, tvO);
    // Round 9 (owner: "cops are shooting through store walls"): an officer pressed against a wall holds the muzzle through it;
    // the round starts from the shooter's shoulder then, so the wall stops it
    { const sh = tvS.set(n.pos.x, n.pos.y + 1.35 * n.char.human.look.height, n.pos.z); if (!this.clearPath(sh, origin)) origin = tvO.copy(sh); }
    const aimAt = this.chest(tgt, tvA);
    const lead = copLeadAimOffset(tgt.vel.x, tgt.vel.z, dist, n.role === 'police' ? 0.65 : 0.25);
    aimAt.x += lead.dx; aimAt.z += lead.dz;
    // Accuracy: distance, target speed, own movement, time aiming; police/gang skill via n.accuracy
    const err = (0.045 + dist * 0.0016 + tgt.speed * 0.012 + n.char.speed * 0.01) * n.accuracy * (n.aimT > 2 ? 0.75 : 1.2) * (tgt.inVehicle ? 1.4 : 1);
    const dir = aimAt.sub(origin).normalize();
    dir.x += (Math.random() - 0.5) * err * 2; dir.y += (Math.random() - 0.5) * err; dir.z += (Math.random() - 0.5) * err * 2; dir.normalize();
    n.clip--;
    n.char.human.playOnce('Pistol_Shoot', 'upper', 0.04);
    n.char.human.kickRecoil(w.twoHanded ? 1.05 : 0.72);
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
      // Round 12 perf: the two-hand IK is the costliest per-person pose work. It only has to run when the skeleton was just
      // re-posed (the mixer overwrote the arms): the animation rate policy (src/actors/animLod.ts) already thins that by distance and
      // visibility. On a frame the skeleton kept its last pose (arms still solved), the gun is just carried along with the body.
      if (n.inView && !n.holdWasInView) n.holdValid = false; // just came on screen: re-solve the grip now
      n.holdWasInView = n.inView;
      if (n.holdValid && !n.posed) {
        n.model.position.x += c.pos.x - n.holdPos.x; n.model.position.y += c.pos.y - n.holdPos.y; n.model.position.z += c.pos.z - n.holdPos.z;
        n.holdPos.copy(c.pos); n.model.updateMatrixWorld(true); return;
      }
      n.holdPos.copy(c.pos); n.holdValid = true;
      if (holdOnHuman(c.human, n.model, c.yaw, fighting ? tvA : null, fighting ? 1 : 0)) return;
    }
    c.human.rightHand.getWorldPosition(n.model.position);
    if (n.brain === 'combat' && tgt) { n.model.lookAt(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z); }
    else { c.human.rightHand.getWorldQuaternion(n.model.quaternion); n.model.quaternion.multiply(_qGunFix); }
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
  private onRoad(x: number, z: number, margin = 0.3): boolean {
    for (const r of this.env.city.roads) {
      const along = r.axis === 'x' ? x : z, across = Math.abs((r.axis === 'x' ? z : x) - r.coord);
      if (across < r.half + margin && along > r.from && along < r.to) return true;
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
    if (n.node < 0 || n.nextNode < 0) { const b = this.nearestNode(n); n.node = b; n.nextNode = b; n.pend = null; n.onCross = false; }
    const target = nodes[n.nextNode];
    const from = nodes[n.node];
    // lateral offset to keep two-way foot traffic apart
    const ex = target.x - from.x, ez = target.z - from.z; const el = Math.hypot(ex, ez) || 1;
    const off = keepRight(n.laneOffset), ox = (-ez / el) * off, oz = (ex / el) * off; // Round 8: everyone keeps to their right, so the two directions pass
    tv.set(target.x + ox - n.pos.x, 0, target.z + oz - n.pos.z);
    const d = tv.length();
    // Re-anchored while standing in the carriageway (dodged a car, shoved, handed over from the far crowd): the nearest corner
    // node can be 30 m off, and a crossing picked from here walked a diagonal through the traffic to it. Step up onto the
    // nearest kerb first (and a step past it, not along the gutter); the walk to the node then follows the footpath. (Within 3 m
    // of the node is the kerb queue for a crossing, left alone.)
    if (n.node === n.nextNode && d > 3 && !n.onCross && kerbEscape(city.roads, n.pos.x, n.pos.z, dir, target.x, target.z)) return 1.35;
    if (d < 0.9 || (n.node === n.nextNode)) {
      const arrived = n.node !== n.nextNode;
      n.node = n.nextNode; n.onCross = false;
      if (arrived && this.maybeActivity(n)) return 0;
      // commit to the next leg once; a crossing leg waits at the kerb for the WALK sign (no jaywalking, no re-rolling every tick)
      if (!n.pend) {
        const opts = nodes[n.node].edges;
        let e = opts[Math.floor(Math.random() * opts.length)];
        if (e.crossing && opts.length > 1 && Math.random() < 0.55) { const alt = opts.filter(o => !o.crossing); if (alt.length) e = alt[Math.floor(Math.random() * alt.length)]; }
        n.pend = e; n.waitT = 0;
      }
      const e = n.pend;
      if (e.crossing) {
        const inter = city.intersections[e.crossing.intersection], here = nodes[n.node], there = nodes[e.to];
        const L = Math.hypot(there.x - here.x, there.z - here.z) || 1, k = (NODE_INSET - KERB_WAIT_BACK) / L;
        // wait at the kerb on the right-hand half of the crosswalk (not all on one spot, walking into the people coming over)
        const wo = keepRight(n.laneOffset) / L, wx = -(there.z - here.z) * wo, wz = (there.x - here.x) * wo;
        tv.set(here.x + (there.x - here.x) * k + wx - n.pos.x, 0, here.z + (there.z - here.z) * k + wz - n.pos.z);
        // step up to the kerb first. A crowded kerb (several people sharing the one waiting spot) never lets everyone get within 0.35 m
        // of it, so being at the kerb (within 1.6 m) and bumped into someone, or the sign already showing WALK, counts as arrived
        const dk = tv.length(), sig = pedSignal(inter, e.crossing.axis, this.env.time());
        if (dk > 0.35 && !(dk < 1.6 && (sig === 'walk' || n.stuckT > 0.15))) { dir.copy(tv.normalize()); return 1.3; }
        if (sig !== 'walk') { n.waitT += dt; n.idleFace = Math.atan2(there.x - here.x, there.z - here.z); this.faceIdle(n, dt); return 0; }
      }
      n.pend = null; n.waitT = 0; n.nextNode = e.to; n.onCross = !!e.crossing;
      return 0;
    }
    dir.copy(tv.normalize());
    // Round 7: follow the path line, not a beeline to the far node: someone off the line (dodged, spawned, handed over
    // from the far crowd) steps back onto it within a few metres instead of slanting across the roadway for 40 m
    if (from !== target && !n.onCross) {
      const ax = from.x + ox, az = from.z + oz, ux = ex / el, uz = ez / el;
      const along = (n.pos.x - ax) * ux + (n.pos.z - az) * uz, lat = (n.pos.x - ax) * -uz + (n.pos.z - az) * ux;
      // off the path line in the carriageway mid-block (shoved off the kerb): back up onto the footpath first. (On the line is
      // fine: a few links, like the bridge approach over Harbor Way, run across a road without a signalled crossing.)
      if (Math.abs(lat) > 0.6 && kerbEscape(city.roads, n.pos.x, n.pos.z, dir, target.x, target.z, 0)) return 1.35;
      if (Math.abs(lat) > 6 || along < -4 || along > el + 4) { n.node = -1; n.nextNode = -1; n.pend = null; return 0.6; } // lost the path: re-anchor from here (nearest kerb / own block)
      if (Math.abs(lat) > 0.6 && along > 0 && along < el) {
        const ahead = Math.min(el, along + 2.5); tv.set(ax + ux * ahead - n.pos.x, 0, az + uz * ahead - n.pos.z); dir.copy(tv.normalize());
      }
    }
    if (n.onCross) { // hurry along if the sign has started flashing
      const e = from.edges.find(q => q.to === n.nextNode);
      const sig = e?.crossing ? pedSignal(city.intersections[e.crossing.intersection], e.crossing.axis, this.env.time()) : 'walk';
      return sig === 'walk' ? 1.6 : 2.3;
    }
    return 1.35 * this.avoidPeds(n, dir, dt);
  }
  private faceIdle(n: Npc, dt: number) { if (n.idleFace !== null) n.char.faceTowards(n.idleFace, 6, dt); n.idleFace = null; }
  /** Nearest walkable node: prefers one reachable without cutting across a carriageway (a fleeing pedestrian must not jaywalk back). */
  private nearestNode(n: Npc): number {
    const city = this.env.city, nodes = city.pedNodes;
    const cand: { id: number; d: number }[] = [];
    for (const nd of nodes) {
      if (Math.abs((nd.y ?? 0) - n.pos.y) > 2.5) continue;
      const d = (nd.x - n.pos.x) ** 2 + (nd.z - n.pos.z) ** 2;
      if (cand.length < 6) { cand.push({ id: nd.id, d }); cand.sort((a, b) => a.d - b.d); } else if (d < cand[5].d) { cand[5] = { id: nd.id, d }; cand.sort((a, b) => a.d - b.d); }
    }
    if (!cand.length) return 0;
    if (surfaceAt(city, n.pos.x, n.pos.z) === 'road') return cand[0].id; // already in the street: nearest kerb
    for (const c of cand) {
      const nd = nodes[c.id]; let clear = true;
      for (let k = 1; k < 6 && clear; k++) if (surfaceAt(city, n.pos.x + (nd.x - n.pos.x) * k / 6, n.pos.z + (nd.z - n.pos.z) * k / 6) === 'road') clear = false;
      if (clear) return c.id;
    }
    return cand[0].id;
  }
  /** Steers round people ahead on the footpath (passes on the right) and slows when someone is right in front. Returns a speed factor. */
  private avoidPeds(n: Npc, dir: THREE.Vector3, dt: number): number {
    n.avT -= dt;
    if (n.avT <= 0) {
      n.avT = 0.1 + Math.random() * 0.06; n.avx = 0; n.avz = 0; n.avSlow = 1;
      const px = n.pos.x, pz = n.pos.z;
      for (const o of this.env.others()) {
        if (o === n.char || !o.alive || o.inVehicle) continue;
        const dx = o.pos.x - px, dz = o.pos.z - pz, d2 = dx * dx + dz * dz;
        if (d2 > 6.25 || d2 < 1e-4 || Math.abs(o.pos.y - n.pos.y) > 1.5) continue;
        const dd = Math.sqrt(d2), ahead = (dx * dir.x + dz * dir.z) / dd;
        if (ahead < 0.15) continue;
        const lat = -dx * dir.z + dz * dir.x; // >0: the other person is on my left
        const side = Math.abs(lat) < 0.05 ? (n.id & 1 ? 1 : -1) : -Math.sign(lat);
        const w = (1 - dd / 2.5) * Math.min(1, ahead * 1.4) * (1.4 - Math.min(1, Math.abs(lat)));
        n.avx += -dir.z * side * w * 1.6; n.avz += dir.x * side * w * 1.6;
        if (ahead > 0.7 && Math.abs(lat) < 0.75) n.avSlow = Math.min(n.avSlow, dd < 1.1 ? 0.3 : dd < 1.8 ? 0.6 : 0.85);
      }
      // R6-Z1: never sidestep off the footpath onto the carriageway (the kerb-side node line sits right at the kerb): try the other side, else queue behind
      if (n.avx !== 0 || n.avz !== 0) {
        const city = this.env.city, k = 1.1;
        if (surfaceAt(city, px + (dir.x + n.avx) * k, pz + (dir.z + n.avz) * k) === 'road') {
          n.avx = -n.avx; n.avz = -n.avz;
          if (surfaceAt(city, px + (dir.x + n.avx) * k, pz + (dir.z + n.avz) * k) === 'road') { n.avx = 0; n.avz = 0; n.avSlow = Math.min(n.avSlow, 0.6); }
        }
      }
    }
    if (n.avx !== 0 || n.avz !== 0) { dir.x += n.avx; dir.z += n.avz; dir.normalize(); }
    return n.avSlow;
  }
}

/**
 * Round 8: how an armed NPC paces its shots. Police fire controlled pairs/triples of aimed shots with short pauses (they
 * used to fire one pistol round every 1-2 s, far too slow); gangs and others keep the looser cadence. Pure (tests).
 */
export function npcFireTiming(police: boolean, auto: boolean, interval: number, burstLeft: number, r: number): { burst: number; between: number; pause: number } {
  if (police) return { burst: burstLeft > 0 ? burstLeft : auto ? 4 + Math.floor(r * 4) : 2 + Math.floor(r * 3), between: Math.max(interval * 1.3, auto ? 0.09 : 0.24), pause: 0.35 + r * 0.5 };
  return { burst: burstLeft > 0 ? burstLeft : auto ? 3 + Math.floor(r * 4) : 1, between: interval * 1.4, pause: interval + 0.8 + r * 1.2 };
}

/**
 * Round 12: a walker in a mid-block carriageway (or within `margin` m of its kerb) gets `dir` set towards its nearer kerb (leaning towards the
 * target point tx, tz along the road), and true. Off the road (or inside a junction, which the road segments leave out) it returns false. Pure (tests).
 */
export function kerbEscape(roads: readonly { axis: 'x' | 'z'; coord: number; half: number; from: number; to: number }[], x: number, z: number, dir: { x: number; z: number }, tx = x, tz = z, margin = 0.3): boolean {
  for (const r of roads) {
    const along = r.axis === 'x' ? x : z, off = (r.axis === 'x' ? z : x) - r.coord;
    if (Math.abs(off) >= r.half + margin || along <= r.from || along >= r.to) continue;
    // square to the kerb, leaning 40 degrees towards where they are headed: against a row of parked cars they slide along it to a gap
    // (within 1.5 m of the kerb: straight at it, since a walker meeting the kerb face at an angle slides along the gutter
    // instead of stepping up)
    const s = off >= 0 ? 1 : -1, ta = (r.axis === 'x' ? tx : tz) - along, a = Math.abs(ta) > 1 && Math.abs(off) < r.half - 1.5 ? Math.sign(ta) * 0.84 : 0;
    const k = 1 / Math.hypot(1, a);
    if (r.axis === 'x') { dir.x = a * k; dir.z = s * k; } else { dir.x = s * k; dir.z = a * k; }
    return true;
  }
  return false;
}

/** Round 8: sideways place on a footpath / crosswalk for a walker (negative = right of the walking direction): always on
 * the right half, spread 0.3-0.95 m from the centre line by the person's own random `laneOffset` (-0.8..0.8). Pure (tests). */
export function keepRight(laneOffset: number): number { return -(0.3 + Math.min(0.8, Math.abs(laneOffset)) * 0.8); }

/**
 * Round 8: heading for a fleeing pedestrian. Tries "straight away" first, then turns further and further (30 deg steps,
 * either side) until 2.5 m ahead is off the road. Standing in the road, it turns towards the nearest kerb instead (the
 * first heading whose point 2.5 m out is pavement). null = keep the plain away heading. Pure (tests).
 */
export function fleeHeading(away: number, roadAt: (a: number, r: number) => boolean, inRoad: boolean): number | null {
  const steps = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
  if (!inRoad) { if (!roadAt(away, 2.5)) return null; for (const k of steps) { const a = away + k * Math.PI / 6; if (!roadAt(a, 2.5) && !roadAt(a, 1.2)) return a; } return null; }
  for (const r of [2.5, 5, 9]) for (const k of steps) { const a = away + k * Math.PI / 6; if (!roadAt(a, r)) return a; }
  return null;
}

/**
 * Classifies how a calm civilian reacts to the player's proximity, speed, approach angle, gun aim, or fast vehicle pass.
 * Pure helper (used by Population.reactToPlayer and unit tests).
 */
export function playerProximityReaction(
  dist: number,
  playerSpeed: number,
  approachDot: number,
  aimingAt: boolean,
  inVehicle: boolean,
): 'none' | 'glance' | 'yield' | 'startle' | 'shove' | 'surrender' | 'dive' {
  if (aimingAt && dist < 28) return 'surrender';
  if (inVehicle) {
    if (playerSpeed > 8.5 && dist < 5.5 && approachDot > 0.25) return 'dive';
    if (playerSpeed > 5.5 && dist < 11) return 'glance';
    return 'none';
  }
  if (dist < 0.85 && playerSpeed > 3.6 && approachDot > 0.45) return 'shove';
  if (dist < 6.5 && playerSpeed > 4.2 && approachDot > 0.5) return 'startle';
  if ((dist < 3.6 && playerSpeed > 1.4 && approachDot > 0.35) || dist < 1.55) return 'yield';
  if (dist < 8.5) return 'glance';
  return 'none';
}

/**
 * Computes horizontal lead aim offset for an armed NPC shooting at a moving target.
 * Scales smoothly with distance and officer skill while clamping max lead to prevent overshoot on sudden jukes. Pure (tests).
 */
export function copLeadAimOffset(targetVx: number, targetVz: number, dist: number, skill: number): { dx: number; dz: number } {
  const s = Math.max(0, Math.min(1, skill));
  const flightT = Math.min(0.45, Math.max(0, dist) / 75);
  const k = flightT * s;
  const dx = Math.max(-2.2, Math.min(2.2, targetVx * k));
  const dz = Math.max(-2.2, Math.min(2.2, targetVz * k));
  return { dx, dz };
}
