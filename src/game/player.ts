/**
 * Translates input into the player's on-foot movement and facing. Vehicle/weapon logic lives in their systems.
 *
 * Ground movement keeps velocity tied to facing (no ice-skating): the heading turns at a speed-dependent rate,
 * speed ramps up/down on separate curves (quick start, slower sprint build, short slide to a stop), hard turns
 * bleed speed and sharp reversals plant and pivot. Jumps have coyote time, buffering, variable height, an apex hang
 * and a faster fall; air control is limited; landings dip the camera and hard ones roll or stagger.
 */
import * as THREE from 'three';
import type { Character } from '../actors/character';
import type { Input } from '../core/input';
import type { CameraRig } from './camera';
import { clamp, wrapAngle } from '../core/rng';

export type PlayerSound = 'jump' | 'land' | 'whoosh' | 'footstep' | 'splash';

/** On-foot tuning in SI units (m, s, rad). */
export const MOVE = {
  walk: 1.8, jog: 4.5, sprint: 7.0, aim: 2.4, swim: 3.4,
  /** acceleration below / above jog speed (sprint builds momentum more slowly) */
  accelStart: 15, accelSprint: 5,
  /** deceleration: stopping from a jog, stopping from a sprint, easing from sprint back to a jog, slowing while still moving */
  decelStop: 20, decelSprintStop: 13, decelSprintRelease: 6.5, decelMoving: 12,
  /** heading turn: exponential rate, capped by an angular speed that falls with ground speed */
  turnK: 14, turnRateSlow: 15, turnRateJog: 10, turnRateSprint: 5.5, turnSpeedLoss: 0.45,
  /** sharp reversals: plant (hard brake) then a quick pivot */
  pivotAngle: 2.25, pivotMinSpeed: 3.2, pivotDecel: 30, pivotTurnRate: 22,
  /** jump arc: take-off speed, base gravity, apex hang band/scale, fall and early-release multipliers */
  jumpSpeed: 7.4, gravity: 25, hangBand: 1.5, hangScale: 0.55, fallScale: 1.38, cutScale: 2.6, minHold: 0.07, maxFall: 32,
  coyote: 0.12, buffer: 0.12,
  /** air control: acceleration, minimum steerable speed, drag with no input */
  airAccel: 7, airMinSpeed: 2.2, airDrag: 0.4,
  /** landing: speed kept after a jump landing, downward speed for a hard landing (~2.5 m drop) */
  landKeep: 0.88, hardLanding: 12.5,
  staminaDrain: 0.09, staminaRegen: 0.22, staminaJump: 0.04, regenDelay: 0.5, exhaustedUntil: 0.25,
};

const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class PlayerController {
  onSound: ((s: PlayerSound, volume: number) => void) | null = null;
  private wasSwimming = false;
  aiming = false;
  sprinting = false;
  rollT = 0;
  private rollDirX = 0; private rollDirZ = 1;
  stamina = 1;
  /** Public read-outs for HUD/tests. */
  jumping = false;
  airTime = 0;
  pivoting = false;
  private exhausted = false;
  private regenWait = 0;
  private coyoteT = 0;
  private jumpBuffer = 0;
  private rollBuffer = 0;
  private jumpLatch = false;
  private rollLatch = false;
  private jumpLock = 0;
  private sinceJump = 9;
  private landLag = 0;
  private recoverT = 0;
  private pivotT = 0;
  private fastTurn = false;
  private takeoffSpeed = 0;
  private lastSpeed = 0;
  private lastPhase = 0;
  private lastX = 0; private lastZ = 0;
  private blocked = false;
  private desired = new THREE.Vector3();
  private takeoffY = 0;
  /** Scripted climb onto a ledge (car, bench, low wall) reached during a jump. */
  private mantle: { t: number; dur: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; exit: number; yaw: number } | null = null;
  get climbing() { return !!this.mantle; }
  constructor(public char: Character, private input: Input, private cam: CameraRig) { }

  /** Fixed-step movement. canAim indicates a ranged weapon is equipped. */
  fixedUpdate(dt: number, opts: { canAim: boolean; blocked: boolean }) {
    const c = this.char, h = c.human;
    this.blocked = opts.blocked;
    if (!c.alive || c.inVehicle) { c.leanRoll = 0; c.leanPitch = 0; this.jumping = false; this.airTime = 0; this.pivoting = false; this.jumpBuffer = 0; this.rollT = 0; this.mantle = null; this.lastX = c.pos.x; this.lastZ = c.pos.z; return; }
    // Teleports (respawn, scripted placement) reset the air state.
    if (Math.hypot(c.pos.x - this.lastX, c.pos.z - this.lastZ) > 3) { this.jumping = false; this.airTime = 0; this.pivoting = false; this.rollT = 0; this.mantle = null; }
    // Latch presses so none are lost when a render frame runs zero or several fixed steps.
    const jp = !opts.blocked && this.input.justPressed('jump');
    if (jp && !this.jumpLatch) this.jumpBuffer = MOVE.buffer;
    this.jumpLatch = jp;
    const rp = !opts.blocked && this.input.justPressed('crouch');
    if (rp && !this.rollLatch) this.rollBuffer = 0.1;
    this.rollLatch = rp;

    const mv = opts.blocked ? { x: 0, y: 0 } : this.input.moveAxes();
    const camYaw = this.cam.yaw + Math.PI; // direction the camera looks
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -fz, rz = fx; // right of forward (x east, z south)
    let wishX = fx * mv.y + rx * mv.x, wishZ = fz * mv.y + rz * mv.x;
    const mag = Math.min(1, Math.hypot(mv.x, mv.y));
    if (mag > 1e-3) { const l = Math.hypot(wishX, wishZ) || 1; wishX /= l; wishZ /= l; }
    const moving = mag > 0.1;
    const wishYaw = Math.atan2(wishX, wishZ);
    this.aiming = !opts.blocked && opts.canAim && this.input.held('aim');

    // Stamina with exhaustion hysteresis (no sprint flicker at empty) and a short regen delay.
    const wantSprint = this.input.held('sprint') && !this.aiming && mag > 0.3 && !opts.blocked;
    if (this.stamina <= 0.001) this.exhausted = true;
    else if (this.stamina > MOVE.exhaustedUntil) this.exhausted = false;
    this.sprinting = wantSprint && !this.exhausted && !c.swimming;
    if (this.sprinting && c.speed > 2) { this.stamina -= dt * MOVE.staminaDrain; this.regenWait = MOVE.regenDelay; }
    else if (this.regenWait > 0) this.regenWait -= dt;
    else this.stamina += dt * MOVE.staminaRegen * (c.speed < 0.5 ? 1.3 : 1);
    this.stamina = clamp(this.stamina, 0, 1);

    this.jumpBuffer -= dt; this.rollBuffer -= dt; this.jumpLock -= dt; this.sinceJump += dt;
    this.landLag -= dt; this.recoverT -= dt;

    if (this.mantle) { this.stepMantle(dt); return; }
    // Knocked down: no control until back on the feet.
    if (c.downT > 0) {
      c.vel.x *= Math.exp(-dt * 4); c.vel.z *= Math.exp(-dt * 4);
      c.vel.y = c.grounded ? -2 : Math.max(-MOVE.maxFall, c.vel.y - MOVE.gravity * dt);
      c.integrate(dt); c.leanRoll = 0; c.leanPitch = 0; c.twist = 0; this.jumping = false;
      this.afterMove();
      return;
    }
    // Dodge roll (also used for hard landings while moving)
    if (this.rollT > 0) {
      this.rollT -= dt;
      const sp = 6.2 * Math.min(1, this.rollT / 0.25 + 0.3);
      c.vel.y = Math.min(c.vel.y, 0);
      c.move(this.desired.set(this.rollDirX * sp, 0, this.rollDirZ * sp), dt, false);
      this.afterMove();
      c.leanRoll = 0; c.leanPitch = 0;
      return;
    }
    if (this.rollBuffer > 0 && c.grounded && !c.swimming && !h.busy && this.recoverT <= 0 && !opts.blocked) {
      this.rollBuffer = 0;
      const yaw = moving ? wishYaw : c.yaw;
      this.startRoll(yaw, 0.72);
      h.playOnce('Roll', 'full', 0.08); this.onSound?.('whoosh', 0.6);
      return;
    }

    // Swimming keeps the character's own water model.
    if (c.inDeepWater) {
      const sp = MOVE.swim * mag;
      c.move(this.desired.set(wishX * sp, 0, wishZ * sp), dt, false);
      this.jumping = false; this.airTime = 0; this.pivoting = false; this.jumpBuffer = 0;
      if (moving) c.faceTowards(wishYaw, 4, dt);
      c.twist = 0; c.leanRoll = 0; c.leanPitch = 0;
      this.afterMove();
      return;
    }

    const grounded = c.grounded;
    const canJump = !opts.blocked && !this.aiming && this.jumpLock <= 0 && this.recoverT <= 0 && (grounded || this.coyoteT > 0);
    const jumpNow = this.jumpBuffer > 0 && canJump;
    const tier = this.aiming ? MOVE.aim : this.sprinting ? MOVE.sprint : this.analogSpeed(mag);
    let yawStep = 0, speedNow = 0;

    if (grounded && !jumpNow) {
      if (this.aiming) {
        // Strafing: velocity follows the stick directly; the body faces the aim.
        const tx = moving ? wishX * tier * mag : 0, tz = moving ? wishZ * tier * mag : 0;
        let dx = tx - c.vel.x, dz = tz - c.vel.z;
        const dl = Math.hypot(dx, dz), maxD = (Math.hypot(tx, tz) > c.speed ? 16 : 20) * dt;
        if (dl > maxD) { dx *= maxD / dl; dz *= maxD / dl; }
        c.vel.x += dx; c.vel.z += dz;
        this.pivoting = false; this.fastTurn = false;
        speedNow = c.speed;
      } else {
        let yaw = c.yaw;
        const hx = Math.sin(yaw), hz = Math.cos(yaw);
        const along = c.vel.x * hx + c.vel.z * hz;
        let latX = c.vel.x - hx * along, latZ = c.vel.z - hz * along;
        let speed = Math.max(0, along), target = 0;
        if (moving) {
          let diff = wrapAngle(wishYaw - yaw);
          if (!this.pivoting && speed > MOVE.pivotMinSpeed && Math.abs(diff) > MOVE.pivotAngle) { this.pivoting = true; this.pivotT = 0; }
          if (this.pivoting) {
            // Plant: brake hard along the old heading, then spin quickly into the new one.
            this.pivotT += dt;
            speed = Math.max(0, speed - MOVE.pivotDecel * dt);
            target = speed;
            if (speed < 1 || this.pivotT > 0.3) { this.pivoting = false; this.fastTurn = true; }
          } else {
            const s1 = smooth(1.5, MOVE.jog, speed), s2 = smooth(MOVE.jog, MOVE.sprint, speed);
            const cap = this.fastTurn ? MOVE.pivotTurnRate : lerp(lerp(MOVE.turnRateSlow, MOVE.turnRateJog, s1), MOVE.turnRateSprint, s2);
            yawStep = clamp(diff * (1 - Math.exp(-MOVE.turnK * dt)), -cap * dt, cap * dt);
            yaw += yawStep; diff -= yawStep;
            if (Math.abs(diff) < 0.25) this.fastTurn = false;
            const ad = Math.abs(diff);
            target = tier * (1 - MOVE.turnSpeedLoss * clamp((ad - 0.35) / 1.4, 0, 1));
            if (speed < 1.5 && ad > 1.2) target = Math.min(target, 0.6); // turn first, then go
          }
        } else { this.pivoting = false; this.fastTurn = false; }
        if (!this.pivoting) {
          if (target > speed) {
            let a = lerp(MOVE.accelStart, MOVE.accelSprint, smooth(MOVE.jog * 0.85, MOVE.jog * 1.05, speed));
            if (this.landLag > 0) a *= 0.4;
            speed = Math.min(target, speed + a * dt);
          } else {
            const a = speed > MOVE.jog + 0.2 ? (moving ? MOVE.decelSprintRelease : MOVE.decelSprintStop) : (moving ? MOVE.decelMoving : MOVE.decelStop);
            speed = Math.max(target, speed - a * dt);
          }
        }
        if (this.recoverT > 0) speed = Math.min(speed, 1.2);
        if (c.meleeActive) speed = Math.min(speed, 1.4); // plant the feet to throw a punch
        const lk = Math.exp(-14 * dt); latX *= lk; latZ *= lk;
        c.vel.x = Math.sin(yaw) * speed + latX; c.vel.z = Math.cos(yaw) * speed + latZ;
        c.yaw = wrapAngle(yaw);
        speedNow = speed;
      }
    } else {
      // Airborne (or taking off): limited steering, no speed gain beyond the take-off speed.
      this.pivoting = false; this.fastTurn = false;
      const vx = c.vel.x, vz = c.vel.z, sp = Math.hypot(vx, vz);
      if (!jumpNow) {
        if (moving) {
          const cap = Math.min(Math.max(tier, MOVE.airMinSpeed), Math.max(this.takeoffSpeed, MOVE.airMinSpeed));
          let dx = wishX * cap * mag - vx, dz = wishZ * cap * mag - vz;
          const dl = Math.hypot(dx, dz), maxD = MOVE.airAccel * dt;
          if (dl > maxD) { dx *= maxD / dl; dz *= maxD / dl; }
          // never let steering add speed above the take-off speed
          const nx = vx + dx, nz = vz + dz, ns = Math.hypot(nx, nz), lim = Math.max(sp, Math.min(cap, ns));
          const k = ns > lim ? lim / ns : 1;
          c.vel.x = nx * k; c.vel.z = nz * k;
        } else if (sp > 0) {
          const k = Math.max(0, sp - MOVE.airDrag * dt) / sp; c.vel.x *= k; c.vel.z *= k;
        }
      }
      speedNow = Math.hypot(c.vel.x, c.vel.z);
      // Reaching a ledge mid-jump (car roof, bench, low wall): climb onto it.
      if (!jumpNow && this.jumping && moving && !this.aiming && this.sinceJump > 0.04 && !opts.blocked) {
        const maxRise = Math.min(1.2, this.takeoffY + 1.8 - c.pos.y);
        const ledge = maxRise > 0.05 ? c.findLedge(wishX, wishZ, maxRise) : null;
        if (ledge) {
          this.mantle = { t: 0, dur: 0.2 + ledge.rise * 0.16, x0: c.pos.x, y0: c.pos.y, z0: c.pos.z, x1: ledge.x, y1: ledge.y, z1: ledge.z, exit: clamp(this.takeoffSpeed * 0.6, 1.5, 4), yaw: wishYaw };
          c.vel.set(0, 0, 0); c.grounded = false;
          h.playOnce('Jump_Start', 'full', 0.08, { from: 0.12, to: 0.62, rate: 1.3 });
          this.onSound?.('whoosh', 0.35);
          this.stepMantle(dt);
          return;
        }
      }
    }

    // Vertical
    if (jumpNow) {
      c.vel.y = MOVE.jumpSpeed;
      this.jumping = true; this.sinceJump = 0; this.coyoteT = 0; this.jumpLock = 0.2; this.jumpBuffer = 0;
      this.takeoffSpeed = Math.hypot(c.vel.x, c.vel.z); this.takeoffY = c.pos.y;
      this.stamina = Math.max(0, this.stamina - MOVE.staminaJump);
      // Standing jumps crouch and spring; running jumps leap straight out of the stride (no wind-up).
      if (this.takeoffSpeed < 2.5) h.playOnce('Jump_Start', 'full', 0.06, { from: 0.08, to: 0.55, rate: 1.3 });
      else if (h.oneShotName && !h.busy) h.stopOnce();
      this.onSound?.('jump', 0.7);
    } else if (grounded) c.vel.y = -2;
    else {
      let g = MOVE.gravity;
      const vy = c.vel.y;
      if (vy > 0) {
        if (this.jumping && !this.input.held('jump') && this.sinceJump > MOVE.minHold) g *= MOVE.cutScale; // released early: short hop
        else if (this.jumping && vy < MOVE.hangBand) g *= MOVE.hangScale;
      } else if (this.jumping && vy > -MOVE.hangBand) g *= MOVE.hangScale;
      else g *= MOVE.fallScale;
      c.vel.y = Math.max(-MOVE.maxFall, vy - g * dt);
    }

    c.integrate(dt);

    // Landing / leaving the ground
    if (c.grounded) {
      if (this.airTime > 0.05 && !jumpNow) this.land();
      this.airTime = 0; this.coyoteT = MOVE.coyote;
      if (this.sinceJump > 0.05) this.jumping = false;
      this.takeoffSpeed = c.speed; this.takeoffY = c.pos.y;
    } else {
      this.airTime += dt; this.coyoteT -= dt;
    }

    // Facing
    if (this.aiming) {
      let legYaw = camYaw;
      if (moving) {
        const rel = wrapAngle(Math.atan2(c.vel.x, c.vel.z) - camYaw);
        legYaw = c.speed < 0.3 ? camYaw : Math.abs(rel) < 1.9 ? camYaw + rel * 0.75 : camYaw + wrapAngle(rel + Math.PI) * 0.5;
      }
      c.faceTowards(legYaw, 16, dt);
      c.twist = wrapAngle(camYaw - c.yaw);
    } else {
      c.twist = 0;
      if (!c.grounded || jumpNow) {
        const sp = Math.hypot(c.vel.x, c.vel.z);
        if (sp > 1) c.faceTowards(Math.atan2(c.vel.x, c.vel.z), 5, dt);
        else if (moving) c.faceTowards(wishYaw, 5, dt);
      }
    }

    // Lean into turns (lateral acceleration) and with acceleration / braking.
    const latAcc = (yawStep / dt) * speedNow;
    const longAcc = (speedNow - this.lastSpeed) / dt;
    if (c.grounded && !this.aiming) {
      c.leanRoll = clamp(-latAcc * 0.0055, -0.17, 0.17);
      c.leanPitch = clamp(longAcc * 0.009, -0.15, 0.09) + 0.05 * smooth(MOVE.jog, MOVE.sprint, speedNow);
    } else { c.leanRoll = 0; c.leanPitch = this.aiming ? 0 : clamp(c.vel.y * -0.008, -0.03, 0.06); }
    this.lastSpeed = speedNow;
    this.afterMove();
  }

  private stepMantle(dt: number) {
    const c = this.char, m = this.mantle!;
    m.t += dt;
    const k = clamp(m.t / m.dur, 0, 1);
    const ky = 1 - (1 - Math.min(1, k / 0.6)) ** 2, kh = smooth(0.25, 1, k);
    c.setPosition(lerp(m.x0, m.x1, kh), lerp(m.y0, m.y1 + 0.03, ky), lerp(m.z0, m.z1, kh));
    c.faceTowards(m.yaw, 14, dt);
    c.grounded = false; c.leanRoll = 0; c.leanPitch = 0.12; c.twist = 0;
    this.airTime += dt; this.jumping = true;
    if (k >= 1) {
      this.mantle = null;
      c.vel.set(Math.sin(c.yaw) * m.exit, -2, Math.cos(c.yaw) * m.exit);
      c.grounded = true;
      c.integrate(dt);
      this.jumping = false; this.airTime = 0; this.coyoteT = MOVE.coyote; this.landLag = 0.1;
      this.takeoffSpeed = c.speed; this.takeoffY = c.pos.y;
      this.cam.landDip(0.06);
      this.onSound?.('land', 0.5);
      if (c.human.oneShotName === 'Jump_Start') c.human.stopOnce('Jump_Start');
    }
    this.afterMove();
  }

  /** Target ground speed for the stick magnitude (keyboard is always a full jog). */
  private analogSpeed(mag: number) {
    if (!this.input.pad.connected || mag > 0.95) return MOVE.jog;
    return mag < 0.55 ? lerp(0.9, MOVE.walk, smooth(0.1, 0.55, mag)) : lerp(MOVE.walk, MOVE.jog, (mag - 0.55) / 0.4);
  }

  private startRoll(yaw: number, t: number) {
    this.rollT = t;
    this.rollDirX = Math.sin(yaw); this.rollDirZ = Math.cos(yaw); this.char.yaw = yaw;
    this.pivoting = false; this.fastTurn = false;
  }

  /** Touchdown: camera dip by impact, landing animation, speed loss (no bunny-hop gains), hard landings roll or stagger. */
  private land() {
    const c = this.char, h = c.human;
    const impact = c.landingSpeed, sp = c.speed;
    const fromWater = this.wasSwimming;
    this.cam.landDip(clamp((impact - 3) * 0.03, 0, 0.4));
    if (this.jumping) { const k = MOVE.landKeep; c.vel.x *= k; c.vel.z *= k; }
    if (fromWater) return;
    if (impact > MOVE.hardLanding) {
      this.cam.addShake(clamp((impact - 10) * 0.03, 0.08, 0.35));
      if (sp > 3 && !this.aiming) {
        // Momentum carries into a forward roll.
        this.startRoll(Math.atan2(c.vel.x, c.vel.z), 0.6);
        h.playOnce('Roll', 'full', 0.06, { from: 0.4, rate: 1.2 });
        this.onSound?.('land', 1); this.onSound?.('whoosh', 0.5);
      } else {
        this.recoverT = 0.45; this.landLag = 0.6;
        c.vel.x *= 0.3; c.vel.z *= 0.3;
        h.playOnce('Jump_Land', 'full', 0.06, { to: 1.0, rate: 1.2 });
        this.onSound?.('land', 1);
      }
      return;
    }
    this.landLag = this.airTime > 0.3 && sp < 2 ? 0.12 : 0;
    if (h.oneShotName === 'Jump_Start') h.stopOnce('Jump_Start');
    if (this.airTime > 0.3) {
      if (sp < 2) h.playOnce('Jump_Land', 'full', 0.06, { to: 0.75, rate: 1.35, weight: clamp(0.35 + impact * 0.04, 0.4, 0.75), soft: true });
      else h.playOnce('Jump_Land', 'upper', 0.05, { to: 0.4, rate: 1.6, weight: 0.3, soft: true }); // absorb with the arms, legs keep running
    }
    if (impact > 3.5) this.onSound?.('land', clamp(0.35 + impact * 0.05, 0.4, 0.9));
  }

  private afterMove() {
    const c = this.char;
    if (c.swimming !== this.wasSwimming) { if (c.swimming) this.onSound?.('splash', 1); this.wasSwimming = c.swimming; }
    if (c.swimming) { this.airTime = 0; this.coyoteT = 0; }
    this.lastX = c.pos.x; this.lastZ = c.pos.z;
  }

  /** Per-frame animation state. */
  updateAnimation() {
    const c = this.char, h = c.human;
    // Presses in a frame that ran no fixed step are buffered here.
    if (!this.blocked && this.input.justPressed('jump') && !this.jumpLatch) this.jumpBuffer = MOVE.buffer;
    if (!this.blocked && this.input.justPressed('crouch') && !this.rollLatch) this.rollBuffer = 0.1;
    this.jumpLatch = false; this.rollLatch = false;
    if (!c.alive) return;
    if (c.inVehicle) return;
    if (h.currentState !== 'crouch') {
      if (c.swimming) h.setState('swim');
      else if (!c.grounded && !this.mantle && (this.jumping || this.airTime > 0.25) && this.rollT <= 0) h.setState('jump');
      else h.setState('loco');
    }
    // Never stay in a jump pose on the ground: a leftover take-off/landing one-shot is cut as soon as we run.
    if (c.grounded && h.currentState === 'loco' && c.speed > 2 && (h.oneShotName === 'Jump_Start' || h.oneShotName === 'Jump_Land') && this.rollT <= 0) h.stopOnce();
    h.airMove = clamp((Math.hypot(c.vel.x, c.vel.z) - 1.5) / 3.5, 0, 1);
    h.setSpeed(c.speed);
    h.aimPitch = -this.cam.pitch;
    // Footsteps on the animation's foot plants.
    const ph = h.locoPhase;
    if (c.grounded && !c.swimming && c.speed > 0.6 && this.rollT <= 0) {
      const crossed = (a: number) => (this.lastPhase < a && ph >= a) || (this.lastPhase > ph && (ph >= a || this.lastPhase < a));
      if (crossed(0.08) || crossed(0.58)) this.onSound?.('footstep', Math.min(1, 0.35 + c.speed * 0.1));
    }
    this.lastPhase = ph;
    const f = this.cam.foot;
    f.sprint = this.sprinting && c.grounded ? smooth(MOVE.jog + 0.3, MOVE.sprint, c.speed) : f.airborne ? f.sprint : 0;
    f.speed = c.swimming ? 0 : c.speed;
    f.stepPhase = ph - 0.08 + 0.25;
    f.airborne = !c.grounded && !c.swimming && (this.jumping || this.airTime > 0.15);
    f.falling = f.airborne && c.vel.y < -9;
  }
}
