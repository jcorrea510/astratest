/**
 * Arcade vehicle physics on Rapier. The ray-cast controller only does suspension; tyre forces are our own
 * (load-sensitive grip with a peak and a softer sliding plateau, a friction circle per wheel, wheelspin for
 * cars without traction control), plus arcade assists: speed-sensitive steering with smooth return-to-centre,
 * countersteer help, a mild yaw-stability assist, a handbrake drift you can hold with throttle and
 * countersteer, downforce, limited air control and a self-righting roll when stuck on the roof.
 */
import { RAPIER, type Physics, G_VEHICLE, G_STATIC, G_PROP, G_PLAYER, G_VRAG, G_RAG, groups } from '../core/physics';
import type { VehicleSpec } from './specs';

export interface WheelDef { x: number; y: number; z: number; front: boolean; left: boolean }
export interface VehicleLayout { half: [number, number, number]; centerY: number; wheels: WheelDef[]; radius: number; zCenter?: number }
export interface DriveInput { throttle: number; steer: number; handbrake: boolean; brake?: number }

type V3 = { x: number; y: number; z: number };
const UP = { x: 0, y: 1, z: 0 };
/** World gravity magnitude (see core/physics). */
const G = 20;
/** Global grip multiplier (kept for tuning from the console). */
export let GRIP = 1;
export function setGripScale(g: number) { GRIP = g; }
/** Driving assists: arcade (default, forgiving ~1.5 g grip) or realistic (~0.9 g sedans, strong weight transfer). */
export let REALISTIC = false;
export const REALISTIC_GRIP = 0.58;
export function setRealisticDriving(on: boolean) { REALISTIC = on; GRIP = on ? REALISTIC_GRIP : 1; }
/** Front-axle load factor from longitudinal acceleration (braking loads the front, throttle the rear). */
export function loadTransfer(longAcc: number, front: boolean, comH = 0.55, wheelBase = 2.7): number {
  const k = (comH / wheelBase) * (longAcc / 9.81);
  return Math.max(0.55, Math.min(1.45, 1 + (front ? -k : k)));
}
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rotate(q: { x: number; y: number; z: number; w: number }, v: V3, out: V3): V3 {
  // v' = v + 2w(q×v) + 2q×(q×v)
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  out.x = v.x + q.w * tx + (q.y * tz - q.z * ty); out.y = v.y + q.w * ty + (q.z * tx - q.x * tz); out.z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  return out;
}

export class VehiclePhysics {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  ctrl: RAPIER.DynamicRayCastVehicleController;
  /** current road-wheel angle (rad, + = left) */
  steer = 0;
  /** smoothed steering input (-1..1) */
  steerIn = 0;
  /** seconds a slide has been left alone (hands off the wheel, no handbrake): the car then self-aligns instead of circling forever */
  driftLazy = 0;
  speed = 0; // forward speed m/s (signed)
  rpm = 0;
  airTime = 0;
  upsideTime = 0;
  /** sliding speed at each contact patch (m/s) for skid marks, smoke and squeal */
  slip: number[] = [];
  /** visual wheel spin angle per wheel (rad); includes wheelspin and locked wheels */
  wheelRot: number[] = [];
  lastVel = { x: 0, y: 0, z: 0 };
  impact = 0; // magnitude of the last sudden velocity change (m/s)
  impactDir = { x: 0, y: 0, z: 0 };
  grounded = true;
  /** >0 while a handbrake-initiated drift is being held */
  drift = 0;
  /** body sideslip angle (rad, + = sliding to the left) */
  beta = 0;
  /** 0..1 how much the driven wheels are spinning */
  wheelspin = 0;
  /** time since the wheels last touched the ground, reset on landing; landing impulse for camera/visual use */
  landing = 0;
  enginePower = 1;
  /** Body pose at the start of the latest fixed step, for render interpolation (see Vehicle.syncTransform). */
  prevPos = { x: 0, y: 0, z: 0 }; prevQuat = { x: 0, y: 0, z: 0, w: 1 };
  private wheelLocal: WheelDef[];
  private hb = 0; // smoothed handbrake 0..1
  private prevFwd = 0; private longAcc = 0;
  private hbRelease = 0; // grip recovery after letting go of the handbrake
  private righting = 0;
  private driftDir = 0; private prevBeta = 0;
  private wheelBase: number;
  private comLocalY: number;
  private v: V3 = { x: 0, y: 0, z: 0 }; private t1: V3 = { x: 0, y: 0, z: 0 }; private t2: V3 = { x: 0, y: 0, z: 0 };

  constructor(public physics: Physics, public spec: VehicleSpec, public layout: VehicleLayout, x: number, y: number, z: number, yaw: number) {
    const w = physics.world;
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(q).setLinearDamping(0.05).setAngularDamping(0.6).setCcdEnabled(true).setCanSleep(true));
    const [hx, hy, hz] = layout.half;
    // rounded edges: the bumper corners ride up a curb instead of snagging on its vertical face
    const rr = Math.min(0.16, hx * 0.3, hy * 0.5);
    const desc = RAPIER.ColliderDesc.roundCuboid(hx - rr, hy - rr, hz - rr, rr).setTranslation(0, layout.centerY, layout.zCenter ?? 0).setFriction(0.3).setRestitution(0.05)
      .setCollisionGroups(groups(G_VEHICLE, G_STATIC | G_VEHICLE | G_PROP | G_PLAYER))
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(spec.mass * 2);
    // Mass with a lowered centre of mass for stability; inertia from a box (a bit more yaw inertia = weightier).
    const m = spec.mass;
    const ix = (m / 12) * ((2 * hy) ** 2 + (2 * hz) ** 2), iy = (m / 12) * ((2 * hx) ** 2 + (2 * hz) ** 2) * 1.15, iz = (m / 12) * ((2 * hx) ** 2 + (2 * hy) ** 2) * 1.2;
    this.comLocalY = layout.centerY + spec.comY;
    desc.setMassProperties(m, { x: 0, y: this.comLocalY, z: 0 }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 });
    this.collider = w.createCollider(desc, this.body);
    this.prevPos = { x, y, z }; this.prevQuat = { ...q };
    this.ctrl = w.createVehicleController(this.body);
    this.ctrl.indexUpAxis = 1;
    this.ctrl.setIndexForwardAxis = 2;
    this.wheelLocal = layout.wheels;
    const zs = layout.wheels.map(wd => wd.z);
    this.wheelBase = Math.max(1.5, Math.max(...zs) - Math.min(...zs));
    layout.wheels.forEach((wd, i) => {
      this.ctrl.addWheel({ x: wd.x, y: wd.y + spec.suspRest * 0.8, z: wd.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspRest, layout.radius);
      this.ctrl.setWheelSuspensionStiffness(i, spec.stiffness * 1.8);
      this.ctrl.setWheelSuspensionCompression(i, spec.compression);
      this.ctrl.setWheelSuspensionRelaxation(i, spec.relaxation);
      this.ctrl.setWheelMaxSuspensionTravel(i, spec.suspTravel);
      this.ctrl.setWheelMaxSuspensionForce(i, spec.mass * 60);
      // Tyre forces are applied by fixedUpdate; the controller only provides suspension and contacts.
      this.ctrl.setWheelFrictionSlip(i, 0);
      this.ctrl.setWheelSideFrictionStiffness(i, 0);
      this.slip.push(0); this.wheelRot.push(0);
    });
  }
  get position() { return this.body.translation(); }
  get rotation() { return this.body.rotation(); }
  /** Forward unit vector in world space. */
  forward(out = { x: 0, y: 0, z: 0 }) {
    const q = this.body.rotation();
    out.x = 2 * (q.x * q.z + q.w * q.y); out.y = 2 * (q.y * q.z - q.w * q.x); out.z = 1 - 2 * (q.x * q.x + q.y * q.y);
    return out;
  }
  upVec(out = { x: 0, y: 0, z: 0 }) {
    const q = this.body.rotation();
    out.x = 2 * (q.x * q.y - q.w * q.z); out.y = 1 - 2 * (q.x * q.x + q.z * q.z); out.z = 2 * (q.y * q.z + q.w * q.x);
    return out;
  }
  /** Left unit vector (local +x) in world space. */
  leftVec(out = { x: 0, y: 0, z: 0 }) {
    const q = this.body.rotation();
    out.x = 1 - 2 * (q.y * q.y + q.z * q.z); out.y = 2 * (q.x * q.y + q.w * q.z); out.z = 2 * (q.x * q.z - q.w * q.y);
    return out;
  }
  get yaw() { const f = this.forward(); return Math.atan2(f.x, f.z); }
  /** Remember the pose before the physics step so the renderer can blend between fixed steps. */
  capturePrev() {
    const p = this.body.translation(), q = this.body.rotation();
    this.prevPos.x = p.x; this.prevPos.y = p.y; this.prevPos.z = p.z;
    this.prevQuat.x = q.x; this.prevQuat.y = q.y; this.prevQuat.z = q.z; this.prevQuat.w = q.w;
  }
  /** Maximum road-wheel angle at a given speed: generous when parking, calm on the highway. */
  steerLimit(absV: number) {
    const geo = this.spec.maxSteer + (this.spec.highSteer - this.spec.maxSteer) * smooth(9, 46, absV); // full-ish lock stays available through city speeds
    // never ask the front tyres for much more slip than their peak: full lock = best possible turn, not a plough
    const grip = Math.atan((this.wheelBase * this.spec.grip * GRIP * G) / Math.max(1, absV * absV)) + this.spec.peakSlip * (2.0 - 1.0 * smooth(10, 13, absV)) /* R6-D: above ~25 mph the fronts sit at their peak slip, no plough scrub */;
    return Math.min(geo, grip);
  }

  fixedUpdate(dt: number, input: DriveInput) {
    const spec = this.spec, c = this.ctrl, body = this.body;
    // R6-K: a car settled asleep (parked) never wakes on its own when a driver asks for power or steering
    if (body.isSleeping() && (Math.abs(input.throttle) > 0.05 || Math.abs(input.steer) > 0.05 || (input.brake ?? 0) > 0.05)) body.wakeUp();
    this.capturePrev();
    const lv = body.linvel(), av = body.angvel(), rot = body.rotation();
    const f = this.forward(), up = this.upVec(), left = this.leftVec();
    const fwdSpeed = lv.x * f.x + lv.y * f.y + lv.z * f.z;
    const latSpeed = lv.x * left.x + lv.y * left.y + lv.z * left.z;
    this.speed = fwdSpeed;
    const absV = Math.abs(fwdSpeed);
    const planar = Math.hypot(fwdSpeed, latSpeed);
    this.beta = planar > 3 ? Math.atan2(latSpeed, Math.max(0.1, Math.abs(fwdSpeed))) : 0;
    const yawRate = av.x * up.x + av.y * up.y + av.z * up.z;
    const thr = clamp(input.throttle, -1, 1);
    const sInRaw = clamp(input.steer, -1, 1);
    const dBeta = (this.beta - this.prevBeta) / dt; this.prevBeta = this.beta;

    // Handbrake: grip drops quickly, comes back progressively so a slide can be caught instead of snapping straight.
    this.hb = input.handbrake ? Math.min(1, this.hb + dt * 9) : Math.max(0, this.hb - dt * 5);
    if (input.handbrake) this.hbRelease = 1; else this.hbRelease = Math.max(0, this.hbRelease - dt * 3.2); // R6-D: rear grip is back ~0.3 s after letting go
    // Drift state: started by the handbrake at speed, held while the car stays sideways and moving.
    if (input.handbrake && absV > 7 && fwdSpeed > 0) { this.drift = 1; if (Math.abs(yawRate) > 0.3) this.driftDir = Math.sign(yawRate); else if (Math.abs(sInRaw) > 0.2) this.driftDir = Math.sign(sInRaw); }
    else if (this.drift > 0) {
      // R6-D: a slide is only kept alive on purpose (throttle or steering into it); hands off it dies in ~0.5 s
      const intent = thr > 0.3 || Math.abs(sInRaw) > 0.3;
      const holding = Math.abs(this.beta) > 0.1 && planar > 6 && thr > -0.3 && intent;
      this.drift = holding ? Math.min(1, this.drift + dt) : this.drift - dt * 2.5;
      if (this.drift < 0) this.drift = 0;
    }
    // power oversteer (no traction control): a spinning rear that steps out becomes a holdable drift too
    if (!spec.tc && this.wheelspin > 0.5 && thr > 0.5 && Math.abs(this.beta) > 0.3 && fwdSpeed > 6 && Math.abs(yawRate) > 0.3 && Math.abs(sInRaw) < 0.9 /* R6-D: full-lock cornering is not a drift */) {
      if (this.drift <= 0) this.driftDir = Math.sign(yawRate);
      this.drift = Math.max(this.drift, 0.6);
    }
    const drifting = this.drift > 0;
    if (drifting && Math.abs(sInRaw) < 0.12 && this.hb < 0.05) this.driftLazy += dt * 2; else this.driftLazy = Math.max(0, this.driftLazy - dt * 2);

    // Steering: rate-limited input with faster return-to-centre, speed-sensitive lock, countersteer help.
    const sIn = clamp(input.steer, -1, 1);
    const toward = Math.abs(sIn) > Math.abs(this.steerIn) && Math.sign(sIn) === Math.sign(this.steerIn || sIn);
    const rate = (toward ? 9.5 - 3.4 * smooth(8, 38, absV) : 9) * dt; // keyboard: full lock in ~0.1-0.15 s
    this.steerIn += clamp(sIn - this.steerIn, -rate, rate);
    let steerAngle = this.steerIn * (drifting ? spec.maxSteer * 0.9 : this.steerLimit(absV));
    if (fwdSpeed > 4) {
      const b = this.beta, dead = drifting ? 0.02 : 0.07;
      if (Math.abs(b) > dead) steerAngle += (b - Math.sign(b) * dead) * (drifting ? 0.55 : 0.7); // R6-D: stronger automatic countersteer outside a held drift
    }
    steerAngle = clamp(steerAngle, -spec.maxSteer, spec.maxSteer);
    this.steer = steerAngle;

    // Engine / brakes (total longitudinal force requests).
    let drive = 0, brakeForce = 0;
    const power = this.enginePower;
    if (thr > 0.05) {
      if (fwdSpeed < -0.8) brakeForce = spec.mass * spec.brake * thr;
      else drive = spec.engine * thr * power * Math.max(0, 1 - (Math.max(0, fwdSpeed) / spec.topSpeed) ** 2.4) * (1 + 0.25 * (1 - smooth(0, 12, absV)));
    } else if (thr < -0.05) {
      if (fwdSpeed > 0.8) brakeForce = spec.mass * spec.brake * -thr;
      else drive = spec.engine * 0.6 * thr * power * Math.max(0, 1 - (-fwdSpeed / spec.reverseSpeed) ** 2);
    }
    // R6-D stability control: when the tail steps out (sideslip > ~0.15 rad) outside a deliberate drift, trim the throttle
    if (!drifting && this.hb < 0.1 && drive > 0) drive *= 1 - 0.9 * smooth(0.15, 0.4, Math.abs(this.beta));
    if (input.brake) brakeForce = Math.max(brakeForce, spec.mass * spec.brake * input.brake);
    const coasting = Math.abs(thr) <= 0.05;
    if (dt > 0) { this.longAcc += ((fwdSpeed - this.prevFwd) / dt - this.longAcc) * Math.min(1, dt * 6); this.prevFwd = fwdSpeed; }
    const hold = coasting && absV < 1.2 && planar < 1.5; // parked / stopped: all wheels hold

    for (let i = 0; i < this.wheelLocal.length; i++) {
      c.setWheelSteering(i, this.wheelLocal[i].front ? steerAngle : 0);
      c.setWheelEngineForce(i, 0); c.setWheelBrake(i, 0);
    }
    c.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G_STATIC | G_PROP));

    let contacts = 0;
    for (let i = 0; i < this.wheelLocal.length; i++) if (c.wheelIsInContact(i)) contacts++;
    const wasGrounded = this.grounded;
    this.grounded = contacts >= 2;
    const com = body.worldCom();
    const nDrive = this.wheelLocal.filter(wd => spec.drive === 'all' || (spec.drive === 'front') === wd.front).length || 1;
    let spinSum = 0;
    if (contacts > 0 && !body.isSleeping()) {
      const mEff = spec.mass / Math.max(2, contacts);
      for (let i = 0; i < this.wheelLocal.length; i++) {
        const wd = this.wheelLocal[i];
        if (!c.wheelIsInContact(i)) { this.slip[i] = 0; continue; }
        const P = c.wheelContactPoint(i), N = c.wheelContactNormal(i);
        if (!P || !N) { this.slip[i] = 0; continue; }
        const Fz = Math.min(c.wheelSuspensionForce(i) ?? 0, spec.mass * G * 1.6);
        // wheel axes on the contact plane
        const a = wd.front ? steerAngle : 0;
        this.t1.x = Math.sin(a); this.t1.y = 0; this.t1.z = Math.cos(a);
        const fw = rotate(rot, this.t1, this.t2);
        const dn = fw.x * N.x + fw.y * N.y + fw.z * N.z;
        let fx = fw.x - N.x * dn, fy = fw.y - N.y * dn, fz = fw.z - N.z * dn;
        const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
        const sx = N.y * fz - N.z * fy, sy = N.z * fx - N.x * fz, sz = N.x * fy - N.y * fx; // N × fw = left
        // contact point velocity
        const rx = P.x - com.x, ry = P.y - com.y, rz = P.z - com.z;
        const vx = lv.x + av.y * rz - av.z * ry, vy = lv.y + av.z * rx - av.x * rz, vz = lv.z + av.x * ry - av.y * rx;
        const vLong = vx * fx + vy * fy + vz * fz, vLat = vx * sx + vy * sy + vz * sz;
        const rear = !wd.front;
        const driven = spec.drive === 'all' || (spec.drive === 'front') === wd.front;
        // grip budget
        const dfLoad = REALISTIC ? loadTransfer(this.longAcc, wd.front) : 1;
        let muLat = (wd.front ? spec.grip : spec.rearGrip) * GRIP * dfLoad;
        if (rear) {
          const hbK = Math.max(this.hb, this.hbRelease * 0.55);
          muLat *= 1 - (1 - spec.handbrakeGrip) * hbK;
          if (drifting) muLat *= spec.driftGrip;
        }
        const capLat = muLat * Fz, capLong = spec.traction * GRIP * Fz;
        // longitudinal request
        let Fx = 0, spinning = false, locked = false;
        if (driven && drive !== 0) {
          Fx = drive / nDrive;
          const cap = capLong * (drifting && rear ? 0.45 : 1);
          if (Math.abs(Fx) > cap) {
            if (spec.tc && !drifting) Fx = Math.sign(Fx) * cap;
            else { spinning = true; Fx = Math.sign(Fx) * cap * 0.85; spinSum += 1; }
          }
        }
        if (brakeForce > 0) {
          const share = brakeForce * (wd.front ? 0.6 : 0.4) / 2;
          Fx -= Math.sign(vLong) * Math.min(share, capLong * 1.05, (mEff * Math.abs(vLong)) / dt);
        }
        if (rear && this.hb > 0.05) {
          const lockF = Math.min(capLong * 0.8, (mEff * Math.abs(vLong)) / dt) * this.hb;
          Fx -= Math.sign(vLong) * lockF; locked = Math.abs(vLong) > 1;
        }
        if (hold && !driven) Fx -= Math.sign(vLong) * Math.min(capLong, (mEff * Math.abs(vLong)) / dt);
        if (hold && driven && drive === 0) Fx -= Math.sign(vLong) * Math.min(capLong, (mEff * Math.abs(vLong)) / dt);
        if (coasting && !hold) Fx -= Math.sign(vLong) * Math.min(spec.mass * (0.55 + 0.0011 * vLong * vLong) / this.wheelLocal.length, (mEff * Math.abs(vLong)) / dt);
        // lateral: slip-angle curve with a peak and a sliding plateau
        const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 3));
        const peak = spec.peakSlip, aa = Math.abs(alpha);
        const curve = aa < peak ? aa / peak : 1 - (1 - spec.slide) * smooth(peak, peak * 3.2, aa);
        let Fy = -Math.sign(alpha) * curve * capLat;
        // never push more than what would stop the lateral motion this step (low-speed stability)
        Fy = clamp(Fy, -(mEff * Math.abs(vLat)) / dt, (mEff * Math.abs(vLat)) / dt);
        // friction circle: driven-wheel spin eats lateral grip; otherwise lateral grip has priority (ABS-like)
        const total = Math.hypot(Fx, Fy), circle = Math.max(capLat, capLong);
        if (total > circle) {
          if (spinning || locked) { const latLeft = Math.sqrt(Math.max(0, circle * circle - Fx * Fx)) * (spinning ? 0.6 : 0.8); Fy = clamp(Fy, -latLeft, latLeft); }
          else { const longLeft = Math.sqrt(Math.max(0, circle * circle - Fy * Fy)); Fx = clamp(Fx, -longLeft, longLeft); }
        }
        // R6-D: cornering scrub. A steered front tyre's side force has a backwards component (Fy sin(steer)); give most of it back
        // while cornering at speed (not in a deliberate drift) so a lift-off corner loses ~20% speed, not 40%.
        if (wd.front && !drifting && absV > 6 && fwdSpeed > 0) Fx += Math.abs(Fy) * Math.abs(Math.sin(a)) * 0.8;
        // apply at the contact point raised towards the centre of mass (limits body roll / pitch)
        // (lever capped so tall vehicles do not trip over their own tyres)
        const px = P.x, py = Math.max(P.y + (com.y - P.y) * 0.55, com.y - 0.3), pz = P.z;
        const ix = (fx * Fx + sx * Fy) * dt, iy = (fy * Fx + sy * Fy) * dt, iz = (fz * Fx + sz * Fy) * dt;
        body.applyImpulseAtPoint({ x: ix, y: iy, z: iz }, { x: px, y: py, z: pz }, false);
        // slide speed for effects
        const latSlide = aa > peak * 1.4 ? Math.abs(vLat) : Math.abs(vLat) * 0.3;
        const longSlide = spinning ? 4 + Math.abs(drive) / spec.engine * 3 : locked ? Math.abs(vLong) * 0.6 : 0;
        this.slip[i] = Math.hypot(latSlide, longSlide);
        // wheel spin visual
        const spinV = locked ? 0 : vLong + (spinning ? Math.sign(Fx || 1) * 9 : 0);
        this.wheelRot[i] += (spinV / this.layout.radius) * dt;
      }
    } else for (let i = 0; i < this.slip.length; i++) this.slip[i] = 0;
    for (let i = 0; i < this.wheelLocal.length; i++) if (!c.wheelIsInContact(i)) this.wheelRot[i] += (Math.max(-30, Math.min(30, fwdSpeed)) / this.layout.radius) * dt * 0.8;
    this.curbAssist(dt, thr, lv);
    this.wheelspin += ((spinSum > 0 ? 1 : 0) - this.wheelspin) * Math.min(1, dt * 8);

    if (this.grounded) {
      if (!wasGrounded) this.landing = Math.min(1, this.airTime * 1.2);
      this.airTime = 0;
      const df = spec.downforce * absV * absV * spec.mass * 0.0012;
      body.applyImpulse({ x: -up.x * df * dt, y: -up.y * df * dt, z: -up.z * df * dt }, true);
      // Yaw assists (only with a driver's input; parked cars are left alone).
      if (planar > 4 && fwdSpeed > -1) {
        const I = spec.mass * (this.wheelBase * this.wheelBase) * 0.3;
        if (this.hb > 0.3 && absV > 6) {
          // handbrake flick: rotate in the steering direction
          // (fades out once the car is already well sideways so a flick is a drift, not a spin)
          body.applyTorqueImpulse({ x: 0, y: this.steerIn * spec.mass * 2.4 * (1 - smooth(0.3, 0.8, Math.abs(this.beta))) * dt, z: 0 }, true);
        } else if (drifting) {
          // hold the drift: keep the slide angle inside a fun window, throttle keeps the speed up
          // steering into the drift deepens it, countersteering straightens it out; the throttle keeps it alive
          const b = this.beta, dir = this.driftDir || -Math.sign(b) || 1;
          const want = -dir * clamp((0.42 + 0.3 * this.steerIn * dir) * (1 - 0.9 * smooth(0.25, 1.1, this.driftLazy)), 0.04, 0.78);
          const k = thr > 0.2 ? 1 : 0.35;
          const tau = I * (5.5 * (b - want) + 2.4 * dBeta) * k * this.drift;
          body.applyTorqueImpulse({ x: 0, y: clamp(tau, -I * 6, I * 6) * dt, z: 0 }, true);
          if (thr > 0.1) {
            const vx = lv.x / planar, vz = lv.z / planar, push = spec.mass * 3.2 * thr * Math.min(1, Math.abs(b) * 3) * dt;
            body.applyImpulse({ x: vx * push, y: 0, z: vz * push }, true);
          }
        } else if (this.hb < 0.1 && Math.abs(this.beta) > 0.12 && Math.abs(this.steerIn) < 0.25 && thr < 0.3 && fwdSpeed > 2) {
          // R6-D: sliding with hands off the wheel and the throttle: yaw damping + sideslip pull so the slide dies out in ~1 s
          const k = clamp(Math.abs(this.beta) / 0.3, 0.4, 1.5);
          body.applyTorqueImpulse({ x: 0, y: (-yawRate * 4.5 - this.beta * 6) * k * I * dt, z: 0 }, true);
        } else if (this.hb < 0.05 && Math.abs(this.steerIn) > 0.05 && fwdSpeed > 2) {
          // turn-in assist: an under-rotating car gets help up to the yaw rate its front wheels ask for
          // (fades out at speed, where stability matters more than agility)
          const rRef = fwdSpeed * Math.tan(steerAngle) / this.wheelBase;
          const rMax = (spec.grip * GRIP * G * 1.15) / Math.max(4, planar);
          const target = clamp(rRef, -rMax, rMax);
          const lack = target - yawRate;
          const fade = 1 - smooth(22, 40, absV); // R6-D: gain 3.2 -> 4 (quicker turn-in)
          const slid = 1 - smooth(0.1, 0.3, Math.abs(this.beta)); // R6-D: no extra rotation once the tail is stepping out
          if (Math.sign(lack) === Math.sign(target) && Math.abs(yawRate) < Math.abs(target)) body.applyTorqueImpulse({ x: 0, y: lack * I * 4 * fade * slid * dt, z: 0 }, true);
          else if (spec.stability > 0 && Math.abs(this.beta) > 0.05 && Math.sign(-lack) === Math.sign(yawRate)) body.applyTorqueImpulse({ x: 0, y: lack * I * spec.stability * 5 * dt, z: 0 }, true);
        } else if (spec.stability > 0) {
          // stability: damp yaw beyond what the steering asks for (only when the car is stepping out)
          const rRef = fwdSpeed * Math.tan(steerAngle) / this.wheelBase;
          const rMax = (spec.grip * G * 1.1) / Math.max(4, planar);
          const target = clamp(rRef, -rMax, rMax);
          const err = yawRate - target;
          if (Math.abs(this.beta) > 0.05 && Math.sign(err) === Math.sign(yawRate)) {
            body.applyTorqueImpulse({ x: 0, y: -err * I * spec.stability * 5 * dt, z: 0 }, true);
          }
        }
      }
    } else {
      this.airTime += dt;
      // Air control: limited pitch / yaw from the sticks, gentle levelling so landings are fair.
      const damp = 1 - dt * 0.9;
      const fwdA = this.forward(this.t1);
      const pitchTorque = 0, levelP = fwdA.y * 1.3, levelR = -left.y * 1.6;
      const I = spec.mass;
      body.setAngvel({ x: av.x * damp, y: av.y * (1 - dt * 0.3), z: av.z * damp }, true);
      // pitch around the left axis, roll around forward, yaw around up
      const tp = (pitchTorque + levelP) * I * 0.9 * dt, tr = levelR * I * 0.6 * dt, ty = sIn * I * 0.5 * dt;
      body.applyTorqueImpulse({ x: left.x * tp + f.x * tr + up.x * ty, y: left.y * tp + f.y * tr + up.y * ty, z: left.z * tp + f.z * tr + up.z * ty }, true);
    }
    this.landing = Math.max(0, this.landing - dt * 3);

    // Self-righting: stuck on the roof or side and nearly stopped -> roll back onto the wheels.
    if (up.y < 0.4 && planar < 2.5 && Math.hypot(av.x, av.z) < 2) {
      this.upsideTime += dt;
      if (this.upsideTime > 1.6) this.rollUpright(dt, f, up);
      if (this.upsideTime > 4.5) this.reset();
    } else if (this.righting > 0 && up.y < 0.85) {
      this.rollUpright(dt, f, up);
    } else { this.upsideTime = 0; this.righting = 0; }

    // RPM model with fake gears (wheelspin revs it up)
    const gearTop = [0, 9, 17, 26, 36, 48, 70];
    let g = 1; while (g < gearTop.length - 1 && absV > gearTop[g]) g++;
    const lo = gearTop[g - 1], hi = gearTop[g];
    const targetRpm = Math.min(1, 0.18 + ((absV - lo) / (hi - lo)) * 0.8 + Math.abs(thr) * 0.08 + this.wheelspin * 0.35 + (this.grounded ? 0 : Math.abs(thr) * 0.3));
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 8);
  }
  private curbCool: number[] = [];
  /**
   * Ray-cast wheels cannot see a vertical kerb face, so a slow car pushing into a ~15-25 cm step would stall against it.
   * Detect it with two short horizontal rays per wheel (low one blocked, high one free) and give that corner a lift.
   */
  private curbAssist(dt: number, thr: number, lv: V3) {
    const planar = Math.hypot(lv.x, lv.z);
    if (Math.abs(thr) < 0.05 || planar > 9 || !this.grounded && this.airTime > 0.3) return;
    const sgn = thr > 0 ? 1 : -1, f = this.forward(this.t1);
    // direction of travel: the velocity when rolling, else where the throttle pushes
    let dx = f.x * sgn, dz = f.z * sgn;
    if (planar > 0.6) { dx = lv.x / planar; dz = lv.z / planar; }
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const r = this.layout.radius, reach = r + 0.14, mask = groups(0xffff, G_STATIC);
    for (let i = 0; i < this.wheelLocal.length; i++) {
      this.curbCool[i] = Math.max(0, (this.curbCool[i] ?? 0) - dt);
      if (this.curbCool[i] > 0 || !this.ctrl.wheelIsInContact(i)) continue;
      const P = this.ctrl.wheelContactPoint(i); if (!P) continue;
      const lo = this.physics.ray(P.x, P.y + 0.06, P.z, dx, 0, dz, reach, mask);
      if (!lo) continue;
      const hi = this.physics.ray(P.x, P.y + 0.36, P.z, dx, 0, dz, reach, mask);
      if (hi) continue; // a wall, not a kerb
      const m = this.spec.mass / this.wheelLocal.length * 1.0;
      this.body.applyImpulseAtPoint({ x: dx * m * 0.5, y: m * 2.4, z: dz * m * 0.5 }, { x: P.x, y: P.y, z: P.z }, true);
      this.curbCool[i] = 0.22;
    }
  }
  /** Physically rolls the car back onto its wheels (used by the self-righting logic and by `flip()`). */
  private rollUpright(dt: number, f: V3, up: V3) {
    this.righting = Math.min(1, this.righting + dt);
    // axis = up × worldUp (rotate the car's up towards +y), around the car's long axis mostly
    let ax = up.y * 0 - up.z * 1, ay = 0, az = up.x * 1 - up.y * 0;
    let al = Math.hypot(ax, ay, az);
    if (al < 0.05) { ax = f.x; ay = f.y; az = f.z; al = Math.hypot(ax, ay, az) || 1; } // exactly upside down: roll around forward
    ax /= al; az /= al; ay /= al;
    const m = this.spec.mass;
    const av = this.body.angvel();
    const along = av.x * ax + av.y * ay + av.z * az;
    // rate proportional to the remaining angle so heavy, tall vehicles don't overshoot onto the other side
    const angle = Math.acos(clamp(up.y, -1, 1)), want = clamp(angle * 2.2, 0, 3);
    const tq = m * G * (0.8 + this.layout.half[1] * 1.1) * dt * Math.min(1, this.righting * 2);
    if (along < want) this.body.applyTorqueImpulse({ x: ax * tq, y: ay * tq, z: az * tq }, true);
    else if (along > want + 0.4) this.body.applyTorqueImpulse({ x: -ax * tq, y: -ay * tq, z: -az * tq }, true);
    if (up.y < 0.5) this.body.applyImpulse({ x: 0, y: m * G * (up.y < 0.2 ? 0.6 : 0.35) * dt, z: 0 }, true);
  }
  /** Manual flip request (e.g. bound to a key): only works when the car is not upright and nearly stopped. */
  flip(): boolean {
    const up = this.upVec(), v = this.body.linvel();
    if (up.y > 0.6 || Math.hypot(v.x, v.z) > 4) return false;
    this.upsideTime = Math.max(this.upsideTime, 1.6); this.righting = 0.01;
    return true;
  }
  /** Call after the world step: detects sudden velocity changes (crashes). */
  postStep() {
    const v = this.body.linvel();
    const dx = v.x - this.lastVel.x, dy = v.y - this.lastVel.y, dz = v.z - this.lastVel.z;
    const dv = Math.hypot(dx, dy * 0.5, dz);
    this.impact = dv > 2.2 ? dv : 0;
    if (this.impact) {
      this.impactDir.x = -dx / dv; this.impactDir.y = -dy / dv; this.impactDir.z = -dz / dv;
      // heavy crashes: kill most of the spin a glancing hit would add (cars shouldn't pirouette like tops)
      if (this.impact > 6) { const av = this.body.angvel(); const k = Math.max(0.45, 1 - this.impact * 0.04); this.body.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true); }
    }
    this.lastVel.x = v.x; this.lastVel.y = v.y; this.lastVel.z = v.z;
  }
  /** Body height at which the tyres just touch flat ground at `groundY` with the suspension at its static load (parked cars spawn settled, no drop). */
  static restBodyY(spec: VehicleSpec, layout: VehicleLayout, groundY: number): number {
    const wy = layout.wheels.reduce((a, w) => a + w.y, 0) / layout.wheels.length;
    const sag = G / (Math.max(1, layout.wheels.length) * spec.stiffness * 1.8);
    return groundY + layout.radius - wy + 0.2 * spec.suspRest - Math.min(sag, spec.suspTravel);
  }
  /** Places the car settled on the ground and puts it to sleep: it only wakes when something touches it. */
  settleAt(x: number, groundY: number, z: number, yaw: number) {
    this.teleport(x, VehiclePhysics.restBodyY(this.spec, this.layout, groundY), z, yaw);
    this.body.sleep();
  }
  reset() {
    const p = this.body.translation();
    const yaw = this.yaw;
    this.body.setTranslation({ x: p.x, y: p.y + 1.2, z: p.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.upsideTime = 0; this.righting = 0; this.drift = 0;
    this.capturePrev();
  }
  teleport(x: number, y: number, z: number, yaw: number) {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastVel = { x: 0, y: 0, z: 0 };
    this.drift = 0; this.hb = 0; this.hbRelease = 0; this.steerIn = 0; this.steer = 0;
    this.capturePrev();
  }
  /** Zero-mass convex proxies shaped like the hood / cabin that only ragdolls touch (the plain box would make people ride on the roof line). */
  addRagHulls(hulls: Float32Array[]) {
    for (const pts of hulls) {
      const d = RAPIER.ColliderDesc.convexHull(pts); if (!d) continue;
      d.setDensity(0).setFriction(0.9).setRestitution(0.02).setCollisionGroups(groups(G_VRAG, G_RAG));
      this.ragHullColliders.push(this.physics.world.createCollider(d, this.body));
    }
  }
  ragHullColliders: RAPIER.Collider[] = [];
  dispose() {
    this.physics.world.removeVehicleController(this.ctrl);
    this.physics.world.removeRigidBody(this.body);
  }
}
export { UP };
