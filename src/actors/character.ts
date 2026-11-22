/** Shared body for every person: physics capsule, movement, health and the animated Human. */
import * as THREE from 'three';
import type { Ragdoll } from './ragdoll';
import { RAPIER, type Physics, G_STATIC, G_VEHICLE, G_CHAR, groups } from '../core/physics';
import { Human, type HumanTemplate, type Look } from './human';
import { damp, dampAngle, wrapAngle } from '../core/rng';
import { WATER_LEVEL } from '../world/citymap';

export type Team = 'player' | 'civilian' | 'gang' | 'police';
/** Melee move kinds: the fist combo (jab, cross, hook) and weapon swings. */
export type MeleeKind = 'jab' | 'cross' | 'hook' | 'stab' | 'swing';
const CAP_HALF = 0.55, CAP_R = 0.32, CENTER = CAP_HALF + CAP_R;
const MELEE_ACTION: Record<MeleeKind, string> = { jab: 'punch_jab', cross: 'punch_cross', hook: 'punch_hook', stab: 'stab', swing: 'swing_bat' };
/** How hard each blow hits for reactions: < 0.5 flinch, < 1 stagger, >= 1 knockdown. */
export const MELEE_POWER: Record<MeleeKind, number> = { jab: 0.35, cross: 0.65, hook: 1.05, stab: 0.5, swing: 1.2 };

/**
 * People a melee strike can connect with right now: alive, on foot, within `range` metres (centre to centre) and
 * inside a ~65 degree cone in front of the attacker, nearest first.
 */
export function meleeTargets(att: Character, cands: Iterable<Character>, range = 1.25, minDot = 0.55): Character[] {
  const fx = Math.sin(att.yaw), fz = Math.cos(att.yaw);
  const out: { c: Character; d: number }[] = [];
  for (const c of cands) {
    if (c === att || !c.alive || c.inVehicle) continue;
    const dx = c.pos.x - att.pos.x, dz = c.pos.z - att.pos.z, d = Math.hypot(dx, dz);
    if (d > range || Math.abs(c.pos.y - att.pos.y) > 1.1) continue;
    if (d > 0.25 && (dx * fx + dz * fz) / d < minDot) continue;
    out.push({ c, d });
  }
  return out.sort((a, b) => a.d - b.d).map(o => o.c);
}

export class Character {
  human: Human;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  swimming = false;
  health = 100; maxHealth = 100; armor = 0;
  alive = true;
  deadTime = 0;
  /** The blow that last hurt this character (set by combat): drives how they fall. dir = direction the blow travelled. */
  lastHit: { zone: string; dx: number; dz: number; power: number; blast: boolean } | null = null;
  /** Procedural settle of a dying body on top of the fall clip (ragdoll-like spring on pitch / roll / spin / hop). */
  deathStyle = ''; private dfx = { t: 0, delay: 0, pitchT: 0, rollT: 0, spinT: 0, spinDur: 0.7, lift: 0, liftDur: 0.45, p: 0, pv: 0, r: 0, rv: 0, spin: 0 };
  inVehicle: unknown = null;
  /** R6-X: physics ragdoll (hit by a car, run-over corpse) driving the skeleton while set */
  ragdoll: Ragdoll | null = null;
  get isDisposed() { return this.disposed; }
  /** R6-F: the person holding this character as a human shield (their own shots / punches never hit the shield) */
  heldBy: Character | null = null;
  physicsEnabled = true;
  lastDamageFrom: Character | null = null;
  lastHitTime = -10;
  knockT = 0;
  /** seconds left covering up in a fist fight: blows do a fraction of the damage and never knock the fighter down */
  blockT = 0;
  private capStart = -10; private capUsed = 0;
  private controller: RAPIER.KinematicCharacterController;
  twist = 0;
  private twistSmoothed = 0;
  /** Whole-body lean (radians) pivoting at the feet: roll > 0 tilts to the character's right, pitch > 0 leans forward. */
  leanRoll = 0; leanPitch = 0;
  private leanRollS = 0; private leanPitchS = 0;
  /** Vertical speed just before the most recent landing (m/s, positive = downwards); set by integrate(). */
  landingSpeed = 0;
  /** Visual-only vertical offset that smooths curb/step climbs (decays to 0). */
  stepOffset = 0;
  /** Seconds left on the ground after a knockdown (no control; includes getting up). */
  downT = 0;
  private getUpAt = 0;
  /** Called at the contact frame of a melee move (see startMelee). */
  onMeleeStrike: ((kind: MeleeKind) => void) | null = null;
  private meleeLock = 0; private meleeCombo = 0; private sinceMelee = 9; private queuedMelee: 'fists' | 'knife' | 'bat' | null = null;
  private lastYaw = 0; private turnRateS = 0;
  get sex() { return this.human.look.sex; }

  constructor(public physics: Physics, tpl: HumanTemplate, look: Look, public team: Team, x: number, z: number, y = 0.2) {
    this.human = new Human(tpl, look);
    this.pos.set(x, y, z);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + CENTER, z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(CAP_HALF, CAP_R).setCollisionGroups(groups(G_CHAR, G_STATIC | G_CHAR)), this.body);
    physics.tag(this.collider, { kind: 'character', ref: this });
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.25, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.controller.setMinSlopeSlideAngle(55 * Math.PI / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.human.root.position.copy(this.pos);
  }
  get isPlayer() { return this.team === 'player'; }
  /** True when the body is deep enough in water to swim. */
  get inDeepWater() { return this.pos.y < WATER_LEVEL - 0.9; }
  /** Moves with the character controller. desired is horizontal velocity (m/s). */
  move(desired: THREE.Vector3, dt: number, jump = false) {
    if (!this.physicsEnabled) return;
    const deep = this.inDeepWater;
    this.swimming = deep;
    if (this.swimming) {
      this.vel.x = damp(this.vel.x, desired.x * 0.8, 4, dt); this.vel.z = damp(this.vel.z, desired.z * 0.8, 4, dt);
      this.vel.y = damp(this.vel.y, (WATER_LEVEL - 1.25 - this.pos.y) * 3, 6, dt);
    } else {
      const acc = this.grounded ? 14 : 3;
      this.vel.x = damp(this.vel.x, desired.x, acc, dt); this.vel.z = damp(this.vel.z, desired.z, acc, dt);
      if (this.grounded) { this.vel.y = jump ? 6.4 : -2; }
      else this.vel.y = Math.max(-30, this.vel.y - 20 * dt);
    }
    this.sweep(dt);
  }
  /**
   * Moves by the current velocity as set by the caller (who owns acceleration, gravity and jumping; used by the player).
   * Collision, ground detection and blocked-velocity correction are the same as move().
   */
  integrate(dt: number) {
    if (!this.physicsEnabled) return;
    this.swimming = false;
    this.sweep(dt);
  }
  private sweep(dt: number) {
    const vyBefore = this.vel.y;
    const delta = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    // Step up curbs and low steps before the round capsule bottom starts riding up the edge (which stalls a run):
    // look for a low face just ahead at ankle height and, if there is a flat top within reach, rise onto it.
    const hs = Math.hypot(delta.x, delta.z);
    let stepped = false;
    if (this.grounded && this.vel.y <= 0.5 && hs > 0.003) {
      const ledge = this.findLedge(delta.x, delta.z, 0.42, 0.04, 0.1 + hs, [0.06, 0.14]);
      if (ledge && ledge.rise > 0.04) { delta.y = ledge.rise + 0.01; stepped = true; }
    }
    // Rising (a jump): the ground snap would pull a slow take-off straight back down, so it only applies when not going up.
    if (this.vel.y > 0.5) this.controller.disableSnapToGround(); else this.controller.enableSnapToGround(0.3);
    this.controller.computeColliderMovement(this.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G_STATIC | G_VEHICLE | G_CHAR));
    let cm = this.controller.computedMovement();
    // Standing inside another character (teleported onto the clerk, spawned on top of someone): the capsule solver would eject
    // us straight up onto their head. Resolve against the world only and walk apart horizontally instead.
    if (!stepped && (cm.y - delta.y > 0.45 || (cm.y - delta.y > 0.03 && hs < 0.004))) { // (standing still yet rising = ejected, not stepping)
      this.controller.computeColliderMovement(this.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G_STATIC | G_VEHICLE));
      cm = this.controller.computedMovement();
      const other = this.overlappingCharacter();
      if (other) {
        let sx = this.pos.x - other.x, sz = this.pos.z - other.z; const sl = Math.hypot(sx, sz);
        if (sl < 0.05) { sx = Math.sin(this.yaw + 2.4); sz = Math.cos(this.yaw + 2.4); } else { sx /= sl; sz /= sl; }
        cm = { x: cm.x + sx * 1.6 * dt, y: cm.y, z: cm.z + sz * 1.6 * dt };
      }
    }
    const m = { x: cm.x, y: cm.y, z: cm.z };
    const wasGrounded = this.grounded;
    let grounded = this.controller.computedGrounded();
    // Stay glued to the ground over small drops (curb edges, slopes) instead of flickering into the air.
    // (only on the way down: while the controller is lifting us up a kerb edge, gluing to the road below pulled us back every
    // frame and walkers stalled half way up the kerb, stuck in the gutter - Round 7)
    if (!grounded && wasGrounded && this.vel.y <= 0.5 && m.y <= 0.002) {
      const g = this.groundBelow(this.pos.x + m.x, this.pos.y + m.y, this.pos.z + m.z, 0.36);
      if (g !== null) { m.y = g - this.pos.y; grounded = true; }
    }
    if (stepped) grounded = true;
    // Step up curbs and small steps when the controller's autostep did not manage it.
    const want = Math.hypot(delta.x, delta.z), got = Math.hypot(m.x, m.z);
    if (!stepped && grounded && want > 0.004 && got < want * 0.55 && this.vel.y <= 0.5) {
      const ledge = this.findLedge(delta.x, delta.z, 0.42, 0.04, 0.12 + want);
      if (ledge && ledge.rise > 0.04) {
        const k = Math.min(1, (want - got) / want);
        m.y = ledge.rise + 0.01; m.x += delta.x * k * 0.5; m.z += delta.z * k * 0.5;
        grounded = true;
      } else {
        // Round 7: a kerb is lower than those face rays (0.25 m+): perched on its corner, walkers stalled in the gutter.
        // Look at the ground just past the front of the capsule instead and step onto it.
        const ux = delta.x / want, uz = delta.z / want, fx = this.pos.x + ux * (CAP_R + 0.1), fz = this.pos.z + uz * (CAP_R + 0.1);
        const g = this.groundBelow(fx, this.pos.y + 0.45, fz, 0.6), rise = g === null ? 0 : g - this.pos.y;
        // (rise ~0 too: feet level with the kerb top, the capsule just grazes its corner and stalls)
        if (g !== null && rise > -0.01 && rise < 0.4 && !this.physics.overlapsCapsule(fx, g + CENTER + 0.04, fz, CAP_HALF, CAP_R - 0.04, groups(0xffff, G_STATIC | G_VEHICLE | G_CHAR), this.body)) {
          m.y = Math.max(0, rise) + 0.03; m.x = ux * Math.max(want, 0.03); m.z = uz * Math.max(want, 0.03); grounded = true; this.kerbSteps++;
        }
      }
    }
    this.grounded = grounded;
    if (this.grounded && !wasGrounded) this.landingSpeed = Math.max(0, -vyBefore);
    if (!this.grounded && !wasGrounded && m.y > delta.y + 0.001 && this.vel.y < 0) this.vel.y = 0;
    if (!this.grounded && this.vel.y > 0 && m.y < delta.y - 0.001) this.vel.y = 0; // bonk
    // Visual smoothing of instant height changes while walking (steps up and down).
    if (wasGrounded && this.grounded && Math.abs(m.y) > 0.04 && Math.abs(m.y) < 0.6) this.stepOffset = Math.max(-0.5, Math.min(0.5, this.stepOffset - m.y));
    this.pos.x += m.x; this.pos.y += m.y; this.pos.z += m.z;
    // horizontal velocity follows actual movement so blocked characters do not run on the spot
    if (dt > 0) { const ax = m.x / dt, az = m.z / dt; if (Math.hypot(ax, az) < Math.hypot(this.vel.x, this.vel.z) - 0.5) { this.vel.x = damp(this.vel.x, ax, 20, dt); this.vel.z = damp(this.vel.z, az, 20, dt); } }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + CENTER, z: this.pos.z });
  }
  /** Position of another character whose capsule currently overlaps ours, or null. */
  private overlappingCharacter(): { x: number; z: number } | null {
    const w = this.physics.world, c = this.body.translation();
    let found: { x: number; z: number } | null = null;
    w.intersectionsWithShape({ x: c.x, y: c.y, z: c.z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(CAP_HALF, CAP_R), (o) => {
      if (o.handle === this.collider.handle) return true;
      const t = o.translation(); found = { x: t.x, z: t.z }; return false;
    }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G_CHAR), undefined, this.body);
    return found;
  }
  /** Height of walkable ground within `reach` metres below the feet at (x, y, z), or null. */
  groundBelow(x: number, y: number, z: number, reach: number): number | null {
    const hit = this.physics.ray(x, y + 0.3, z, 0, -1, 0, 0.3 + reach, groups(0xffff, G_STATIC | G_VEHICLE), this.collider);
    return hit ? y + 0.3 - hit.toi : null;
  }
  /** R6-X: hands the skeleton to a physics ragdoll (called by RagdollSystem.launch). */
  beginRagdoll(r: Ragdoll) {
    this.ragdoll = r; const h = this.human;
    h.stopAction(); h.setState('loco'); h.setUpperMode('none'); h.setSpeed(0);
    this.physicsEnabled = false; this.collider.setEnabled(false);
    this.downT = 99; this.knockT = 99; this.vel.set(0, 0, 0);
  }
  /** R6-X: ragdoll over; a living person stands back up here (get-up clip). */
  endRagdoll(x: number, y: number, z: number, yaw: number) {
    this.ragdoll = null; this.setCollision(true);
    if (!this.alive) { this.collider.setCollisionGroups(groups(0, 0)); return; }
    this.place(x, y, z, yaw);
    this.human.root.rotation.set(0, yaw, 0);
    this.human.playAction('get_up'); this.downT = 1.2; this.getUpAt = 0; this.knockT = 1.2;
  }
  /** Teleports the body (no collision). */
  place(x: number, y: number, z: number, yaw?: number) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.stepOffset = 0;
    this.body.setTranslation({ x, y: y + CENTER, z }, true); this.body.setNextKinematicTranslation({ x, y: y + CENTER, z });
    if (yaw !== undefined) this.yaw = yaw;
    this.human.root.position.copy(this.pos); this.human.root.rotation.y = this.yaw;
  }
  /** Moves the body to a point without collision or resetting velocity (scripted motion such as a ledge climb). */
  setPosition(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.body.setNextKinematicTranslation({ x, y: y + CENTER, z });
  }
  /**
   * Looks for a ledge the character can climb in direction (dx, dz): an obstacle face within `reach` metres of the
   * capsule and a flat, free top between `minRise` and `maxRise` above the feet. Returns where to stand, or null.
   */
  /** why the last findLedge failed (debug / tests) */
  ledgeWhy = '';
  /** kerb step-ups taken by the fallback (tests) */ kerbSteps = 0;
  findLedge(dx: number, dz: number, maxRise: number, minRise = 0.05, reach = 0.45, heights: number[] = [0.25, 0.65, 1.05]): { x: number; y: number; z: number; rise: number } | null {
    const w = this.physics.world, flt = groups(0xffff, G_STATIC | G_VEHICLE);
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const l = Math.hypot(dx, dz); if (l < 1e-4) return null; dx /= l; dz /= l;
    // 1) an obstacle face ahead (rays at shin, hip and chest height)
    let face = Infinity;
    for (const hgt of heights) {
      const hit = w.castRayAndGetNormal(new RAPIER.Ray({ x: this.pos.x, y: this.pos.y + hgt, z: this.pos.z }, { x: dx, y: 0, z: dz }), CAP_R + reach, true, flags, flt, this.collider);
      if (hit && Math.abs(hit.normal.y) < 0.5) face = Math.min(face, hit.timeOfImpact);
    }
    if (!Number.isFinite(face)) { this.ledgeWhy = 'noface'; return null; }
    // 2) a flat top just beyond the face
    const tx = this.pos.x + dx * (face + 0.42), tz = this.pos.z + dz * (face + 0.42);
    const fromY = this.pos.y + maxRise + 0.25;
    const down = w.castRayAndGetNormal(new RAPIER.Ray({ x: tx, y: fromY, z: tz }, { x: 0, y: -1, z: 0 }), maxRise + 0.25 - minRise, true, flags, flt, this.collider);
    if (!down || down.timeOfImpact < 0.02 || down.normal.y < 0.75) { this.ledgeWhy = down ? `top toi ${down.timeOfImpact.toFixed(2)} ny ${down.normal.y.toFixed(2)}` : 'notop'; return null; }
    const topY = fromY - down.timeOfImpact, rise = topY - this.pos.y;
    if (rise < minRise || rise > maxRise) { this.ledgeWhy = `rise ${rise.toFixed(2)}`; return null; }
    // 3) room to stand on top, and room to rise in place before stepping over
    const cflt = groups(0xffff, G_STATIC | G_VEHICLE | G_CHAR);
    if (this.physics.overlapsCapsule(tx, topY + CENTER + 0.04, tz, CAP_HALF, CAP_R - 0.02, cflt, this.body)) { this.ledgeWhy = 'blocked top'; return null; }
    if (this.physics.overlapsCapsule(this.pos.x, topY + CENTER + 0.04, this.pos.z, CAP_HALF, CAP_R - 0.06, cflt, this.body)) { this.ledgeWhy = 'blocked rise'; return null; }
    this.ledgeWhy = 'ok';
    return { x: tx, y: topY, z: tz, rise };
  }
  setCollision(enabled: boolean) { this.collider.setEnabled(enabled); this.physicsEnabled = enabled; }
  faceTowards(yaw: number, rate: number, dt: number) { this.yaw = dampAngle(this.yaw, yaw, rate, dt); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  /** Applies damage; returns true if this hit killed the character. */
  damage(amount: number, from: Character | null, time: number): boolean {
    if (!this.alive) return false;
    if (this.isPlayer) {
      // Fairness cap: incoming damage per rolling second is limited so death is never instantaneous.
      if (time - this.capStart > 1) { this.capStart = time; this.capUsed = 0; }
      amount = Math.max(0, Math.min(amount, 45 - this.capUsed)); this.capUsed += amount;
      if (amount <= 0) return false;
    }
    if (this.blockT > 0 && from) amount *= 0.2;
    if (this.armor > 0) { const absorbed = Math.min(this.armor, amount * 0.65); this.armor -= absorbed; amount -= absorbed; }
    this.health -= amount; this.lastDamageFrom = from; this.lastHitTime = time;
    this.human.flash();
    if (this.health <= 0) { this.health = 0; this.kill(); return true; }
    // a small flinch on every hit (never interrupts a move in progress)
    if (!this.inVehicle && this.downT <= 0 && !this.human.busy) this.human.playAction('hit_light', { soft: true, weight: 0.8 });
    return false;
  }
  kill() {
    if (!this.alive) return;
    if (this.ragdoll) { this.alive = false; this.deadTime = 0; this.downT = 0; this.ragdoll.o.getUp = false; this.human.setUpperMode('none'); return; } // already limp: the physics body carries on
    this.alive = false; this.deadTime = 0; this.downT = 0;
    const f = this.lastDamageFrom, hit = this.lastHit, h = this.human;
    h.setState('dead'); h.setUpperMode('none');
    this.collider.setCollisionGroups(groups(0, 0));
    this.pickFall(f, hit);
  }
  /** Chooses how this body falls from the hit zone, the blow direction and its strength (Death01 only falls backwards). */
  private pickFall(f: Character | null, hit: Character['lastHit']) {
    const h = this.human, fx = this.dfx;
    Object.assign(fx, { t: 0, delay: 0, pitchT: 0, rollT: 0, spinT: 0, spinDur: 0.7, lift: 0, liftDur: 0.45, p: 0, pv: 0, r: 0, rv: 0, spin: 0 });
    this.deathStyle = 'back';
    if (this.inVehicle) return;
    // blow direction (travelling away from the attacker); falls back to the attacker's position, else any
    let bx = hit?.dx ?? 0, bz = hit?.dz ?? 0;
    if (bx * bx + bz * bz < 1e-4 && f && f !== this) { bx = this.pos.x - f.pos.x; bz = this.pos.z - f.pos.z; }
    const bl = Math.hypot(bx, bz);
    const rnd = (a: number) => (Math.random() * 2 - 1) * a;
    const side = Math.random() < 0.5 ? 1 : -1;
    if (bl < 0.1) { // no direction (fire, fall...): crumple where standing
      this.deathStyle = 'buckle'; h.setDeathClip('Crouch_Idle_Loop', 1.3); Object.assign(fx, { delay: 0.25, pitchT: side > 0 ? 1.45 : -1.4, rollT: rnd(0.3) });
      return;
    }
    bx /= bl; bz /= bl;
    const rel = Math.sin(this.yaw) * bx + Math.cos(this.yaw) * bz; // +1: blow travelled the way they face (shot in the back)
    const zone = hit?.zone ?? 'torso', power = hit?.power ?? 0;
    const faceBlow = () => { this.yaw = Math.atan2(-bx, -bz) + rnd(0.45); }; // face the attacker, fall away from them
    const push = (k: number) => { this.vel.x += bx * k; this.vel.z += bz * k; this.knockT = Math.max(this.knockT, 0.7 + k * 0.1); };
    if (hit?.blast || power >= 3) { // thrown by an explosion / shotgun: airborne hop, hard landing, rolls
      this.deathStyle = 'blast'; faceBlow(); push(hit?.blast ? 5.5 : 4);
      h.setDeathClip('Death01', 1.5 + Math.random() * 0.3);
      Object.assign(fx, { lift: 0.5 + Math.random() * 0.4, liftDur: 0.5, rollT: rnd(0.7), spinT: rnd(1.2), spinDur: 0.6 });
    } else if (zone === 'leg') { // knees buckle, topple forward or sideways
      this.deathStyle = 'buckle'; this.yaw = Math.atan2(-bx, -bz) + rnd(1.2); push(0.6);
      h.setDeathClip('Crouch_Idle_Loop', 1.4);
      Object.assign(fx, { delay: 0.35, pitchT: 1.42, rollT: rnd(0.4), spinT: rnd(0.5), spinDur: 0.8 });
    } else if (rel > 0.35) { // shot in the back: stumble forward, fall on the face
      this.deathStyle = 'stumble'; this.yaw = Math.atan2(bx, bz) + rnd(0.3); push(2.2);
      h.setDeathClip('Crouch_Idle_Loop', 1.6);
      Object.assign(fx, { delay: 0.18, pitchT: 1.45, rollT: rnd(0.3), spinT: rnd(0.4), spinDur: 0.6 });
    } else if (zone === 'head' || zone === 'neck') { // headshot: lights out, drops straight down/back
      this.deathStyle = 'headdrop'; faceBlow(); push(0.5);
      h.setDeathClip('Death01', 1.45 + Math.random() * 0.2);
      Object.assign(fx, { rollT: rnd(0.2) });
    } else if (zone === 'arm' || Math.abs(rel) < 0.35) { // shoulder / side hit: spun round, drops
      this.deathStyle = 'spin'; faceBlow(); push(1.2);
      h.setDeathClip('Death01', 1.1 + Math.random() * 0.25);
      Object.assign(fx, { spinT: side * (1.6 + Math.random() * 1.6), spinDur: 0.75, rollT: rnd(0.5) });
    } else { // chest from the front
      faceBlow(); push(1.4 + power * 0.3);
      h.setDeathClip('Death01', 0.95 + Math.random() * 0.35);
      Object.assign(fx, { rollT: rnd(0.45), spinT: rnd(0.5), spinDur: 0.9 });
    }
  }
  /** Spring-damped body settle applied to the root each visual update. */
  private deathFx(dt: number): { pitch: number; roll: number; spin: number; lift: number } | null {
    if (this.alive || this.inVehicle) return null;
    const fx = this.dfx; let left = Math.min(dt, 0.1);
    while (left > 0) {
      const h = Math.min(left, 1 / 60); left -= h; fx.t += h;
      const go = fx.t >= fx.delay;
      const pT = go ? fx.pitchT : 0, rT = go ? fx.rollT : 0;
      fx.pv += (70 * (pT - fx.p) - 8 * fx.pv) * h; fx.p += fx.pv * h;
      fx.rv += (50 * (rT - fx.r) - 7 * fx.rv) * h; fx.r += fx.rv * h;
    }
    const u = Math.min(1, Math.max(0, fx.t / fx.spinDur));
    const spin = fx.spinT * (1 - (1 - u) * (1 - u));
    const lu = fx.t / fx.liftDur;
    const lift = fx.lift > 0 && lu < 1 ? fx.lift * 4 * lu * (1 - lu) : 0;
    return { pitch: fx.p, roll: fx.r, spin, lift };
  }
  /** Round 8: a round into a body on the ground: a ragdoll gets a real shove, a settled body twitches and slides a little. */
  corpseJolt(dx: number, dz: number, power: number) {
    if (this.alive || this.inVehicle) return;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const r = this.ragdoll;
    if (r && !r.frozen) { const m = power * 6; r.torso.applyImpulse({ x: dx * m, y: power * 2.5, z: dz * m }, true); return; }
    const fx = this.dfx; fx.pv += (Math.random() - 0.5) * 3 * power; fx.rv += (Math.random() - 0.5) * 4 * power;
    this.joltT = 0.18; this.joltX = dx * 0.07 * power; this.joltZ = dz * 0.07 * power;
  }
  /** corpse jolt: seconds left and the slide it adds */
  joltT = 0; private joltX = 0; private joltZ = 0;
  revive(health = 100) {
    this.alive = true; this.health = health; this.downT = 0; this.human.setState('loco'); this.human.stopAction(); this.deathStyle = ''; this.lastHit = null;
    this.collider.setCollisionGroups(groups(G_CHAR, G_STATIC | G_CHAR));
  }
  /**
   * Reaction to a blow coming from (dx, dz) (attacker towards this character). power < 0.5 flinches, < 1 staggers
   * back a step, >= 1 knocks the character down (they get up again after ~2 s).
   */
  hitReact(dx: number, dz: number, power: number) {
    if (!this.alive || this.inVehicle) return;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (this.blockT > 0 && power < 2) { this.vel.x += dx * 0.5; this.vel.z += dz * 0.5; return; } // guarded: the blow is soaked up
    // Round 8: already lying on the floor: another blow keeps them down longer (a standing stagger used to pull a
    // knocked-out clerk back onto their feet)
    if (this.downT > this.getUpAt) { this.downT = Math.min(6, this.downT + 1.2); this.knockT = Math.max(this.knockT, this.downT); return; }
    if (power >= 1 && !(this.isPlayer && power < 1.2)) {
      this.yaw = Math.atan2(-dx, -dz); // face the attacker, fall backwards
      this.human.playAction('knockdown');
      this.downT = 2.6; this.getUpAt = 1.25; this.knockT = Math.max(this.knockT, 2.6);
      this.vel.x = dx * 2.2; this.vel.z = dz * 2.2;
    } else if (power >= 0.5) {
      this.yaw = Math.atan2(-dx, -dz);
      this.human.playAction('stagger');
      this.vel.x += dx * 1.5 * power; this.vel.z += dz * 1.5 * power;
      this.knockT = Math.max(this.knockT, 0.55);
    } else this.human.playAction(Math.random() < 0.5 ? 'hit_head' : 'hit_light', { soft: true });
  }
  /**
   * Starts a melee move: wind-up, strike, recover. Fists chain jab -> cross -> hook when pressed within ~0.6 s of
   * the previous blow. `onMeleeStrike(kind)` fires at the contact frame; resolve hits there (see meleeTargets).
   * Returns the move started, or null while still recovering.
   */
  startMelee(weapon: 'fists' | 'knife' | 'bat' = 'fists'): MeleeKind | null {
    if (!this.alive || this.inVehicle || this.downT > 0) return null;
    if (this.meleeLock > 0) { if (this.meleeLock < 0.35) this.queuedMelee = weapon; return null; } // buffered follow-up
    let kind: MeleeKind;
    if (weapon === 'fists') { this.meleeCombo = this.sinceMelee < 0.65 ? (this.meleeCombo + 1) % 3 : 0; kind = (['jab', 'cross', 'hook'] as const)[this.meleeCombo]; }
    else kind = weapon === 'bat' ? 'swing' : 'stab';
    const dur = this.human.playAction(MELEE_ACTION[kind], { onEvent: e => { if (e === 'strike' && this.alive) this.onMeleeStrike?.(kind); } });
    this.meleeLock = dur * (kind === 'hook' || kind === 'swing' ? 0.85 : 0.62);
    this.sinceMelee = -dur * 0.5;
    return kind;
  }
  /** True while a melee move is winding up or striking. */
  get meleeActive() { return this.meleeLock > 0; }
  /** Updates visuals; twist rotates the upper body to aim while legs follow movement. */
  updateVisual(dt: number) {
    const h = this.human;
    this.meleeLock -= dt; this.sinceMelee += dt;
    if (this.meleeLock <= 0 && this.queuedMelee) { const w = this.queuedMelee; this.queuedMelee = null; this.startMelee(w); }
    if (this.downT > 0 && !this.ragdoll) {
      const before = this.downT; this.downT -= dt;
      if (this.alive && before > this.getUpAt && this.downT <= this.getUpAt) h.playAction('get_up');
      if (this.downT <= 0 && this.alive) h.stopAction('get_up');
    }
    this.stepOffset *= Math.exp(-dt * 11);
    if (dt > 0) {
      const yr = wrapAngle(this.yaw - this.lastYaw) / dt;
      this.turnRateS = damp(this.turnRateS, Math.abs(yr) > 30 ? 0 : yr, 10, dt);
      h.turnRate = this.turnRateS;
    }
    this.lastYaw = this.yaw;
    if (this.ragdoll) { this.ragdoll.syncRoot(h); h.update(dt); this.ragdoll.applyBend(h); return; }
    if (this.joltT > 0) { const k = Math.min(dt, this.joltT) / 0.18; this.pos.x += this.joltX * k; this.pos.z += this.joltZ * k; this.joltT -= dt; } // corpse hit: slides a few cm
    h.root.position.copy(this.pos);
    h.root.position.y += this.stepOffset;
    if (this.swimming) h.root.position.y += 0.15;
    const dfx = this.deathFx(dt);
    if (!this.alive && !this.inVehicle && !h.dead) h.setState('dead'); // a corpse never stays upright
    h.root.rotation.y = this.yaw + (dfx?.spin ?? 0);
    if (dfx) { h.root.position.y += dfx.lift + Math.min(0.16, Math.abs(dfx.pitch) * 0.12 + Math.abs(dfx.roll) * 0.08); h.root.rotation.order = 'YXZ'; h.root.rotation.x = dfx.pitch; h.root.rotation.z = dfx.roll; }
    this.leanRollS = damp(this.leanRollS, this.leanRoll, 9, dt);
    this.leanPitchS = damp(this.leanPitchS, this.leanPitch, 9, dt);
    if (!dfx && (Math.abs(this.leanRollS) + Math.abs(this.leanPitchS) > 1e-4 || h.root.rotation.x !== 0 || h.root.rotation.z !== 0)) {
      h.root.rotation.order = 'YXZ'; h.root.rotation.x = this.leanPitchS; h.root.rotation.z = this.leanRollS;
    }
    h.update(dt);
    this.twistSmoothed = damp(this.twistSmoothed, this.twist, 12, dt);
    if (Math.abs(this.twistSmoothed) > 0.001) {
      const t = wrapAngle(this.twistSmoothed);
      h.root.updateMatrixWorld(true);
      if (h.spine.parent) rotateBoneWorldY(h.spine.parent, t * 0.45);
      rotateBoneWorldY(h.spine, t * 0.55);
    }
  }
  /** Head height above ground in metres. */
  get headY() { return this.pos.y + 1.6 * this.human.look.height; }
  private disposed = false;
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.physics.untag(this.collider);
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
    this.human.dispose();
  }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _axis = new THREE.Vector3();
/** Rotates a bone about the world up axis (works under rotated parents). */
export function rotateBoneWorldY(bone: THREE.Object3D, angle: number) {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(_q);
  _axis.set(0, 1, 0).applyQuaternion(_q.invert());
  bone.quaternion.premultiply(_q2.setFromAxisAngle(_axis, angle));
  bone.updateMatrixWorld(true);
}
