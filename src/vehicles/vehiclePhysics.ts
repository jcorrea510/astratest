/** Ray-cast vehicle physics on Rapier with arcade assists (speed-sensitive steering, handbrake drifts, downforce). */
import { RAPIER, type Physics, G_VEHICLE, G_STATIC, G_PROP, G_PLAYER, groups } from '../core/physics';
import type { VehicleSpec } from './specs';

export interface WheelDef { x: number; y: number; z: number; front: boolean; left: boolean }
export interface VehicleLayout { half: [number, number, number]; centerY: number; wheels: WheelDef[]; radius: number }
export interface DriveInput { throttle: number; steer: number; handbrake: boolean; brake?: number }

const UP = { x: 0, y: 1, z: 0 };
export let GRIP = 0.38;
export function setGripScale(g: number) { GRIP = g; }
export class VehiclePhysics {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  ctrl: RAPIER.DynamicRayCastVehicleController;
  steer = 0;
  speed = 0; // forward speed m/s (signed)
  rpm = 0;
  airTime = 0;
  upsideTime = 0;
  slip: number[] = [];
  lastVel = { x: 0, y: 0, z: 0 };
  impact = 0; // magnitude of the last sudden velocity change (m/s)
  impactDir = { x: 0, y: 0, z: 0 };
  grounded = true;
  private wheelLocal: WheelDef[];
  enginePower = 1;

  constructor(public physics: Physics, public spec: VehicleSpec, public layout: VehicleLayout, x: number, y: number, z: number, yaw: number) {
    const w = physics.world;
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(q).setLinearDamping(0.08).setAngularDamping(0.9).setCcdEnabled(true).setCanSleep(true));
    const [hx, hy, hz] = layout.half;
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, layout.centerY, 0).setFriction(0.35).setRestitution(0.15)
      .setCollisionGroups(groups(G_VEHICLE, G_STATIC | G_VEHICLE | G_PROP | G_PLAYER))
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(spec.mass * 2);
    // Mass with a lowered centre of mass for stability; inertia from a box.
    const m = spec.mass;
    const ix = (m / 12) * ((2 * hy) ** 2 + (2 * hz) ** 2), iy = (m / 12) * ((2 * hx) ** 2 + (2 * hz) ** 2) * 1.1, iz = (m / 12) * ((2 * hx) ** 2 + (2 * hy) ** 2);
    desc.setMassProperties(m, { x: 0, y: layout.centerY + spec.comY, z: 0 }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 });
    this.collider = w.createCollider(desc, this.body);
    this.ctrl = w.createVehicleController(this.body);
    this.ctrl.indexUpAxis = 1;
    this.ctrl.setIndexForwardAxis = 2;
    this.wheelLocal = layout.wheels;
    layout.wheels.forEach((wd, i) => {
      this.ctrl.addWheel({ x: wd.x, y: wd.y + spec.suspRest * 0.8, z: wd.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspRest, layout.radius);
      this.ctrl.setWheelSuspensionStiffness(i, spec.stiffness * 1.8);
      this.ctrl.setWheelSuspensionCompression(i, spec.compression);
      this.ctrl.setWheelSuspensionRelaxation(i, spec.relaxation);
      this.ctrl.setWheelMaxSuspensionTravel(i, spec.suspTravel);
      this.ctrl.setWheelMaxSuspensionForce(i, spec.mass * 60);
      this.ctrl.setWheelFrictionSlip(i, (wd.front ? spec.grip : spec.rearGrip) * GRIP);
      this.ctrl.setWheelSideFrictionStiffness(i, spec.sideStiffness);
      this.slip.push(0);
    });
  }
  get position() { return this.body.translation(); }
  get rotation() { return this.body.rotation(); }
  /** Forward unit vector in world space. */
  forward(out = { x: 0, y: 0, z: 0 }) {
    const q = this.body.rotation();
    // rotate (0,0,1)
    out.x = 2 * (q.x * q.z + q.w * q.y); out.y = 2 * (q.y * q.z - q.w * q.x); out.z = 1 - 2 * (q.x * q.x + q.y * q.y);
    return out;
  }
  upVec(out = { x: 0, y: 0, z: 0 }) {
    const q = this.body.rotation();
    out.x = 2 * (q.x * q.y - q.w * q.z); out.y = 1 - 2 * (q.x * q.x + q.z * q.z); out.z = 2 * (q.y * q.z + q.w * q.x);
    return out;
  }
  get yaw() { const f = this.forward(); return Math.atan2(f.x, f.z); }

  fixedUpdate(dt: number, input: DriveInput) {
    const spec = this.spec, c = this.ctrl;
    const v = this.body.linvel();
    const f = this.forward();
    const fwdSpeed = v.x * f.x + v.y * f.y + v.z * f.z;
    this.speed = fwdSpeed;
    const absV = Math.abs(fwdSpeed);
    // Steering: smoothed, reduced at speed.
    const falloff = 1 - Math.min(1, absV / spec.topSpeed) * spec.steerSpeedFalloff;
    const target = input.steer * spec.maxSteer * falloff;
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 6 : 3.2) * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));
    let engine = 0, brake = 0;
    const thr = input.throttle;
    if (thr > 0.05) {
      if (fwdSpeed < -1) brake = spec.brake * 2.5 * thr;
      else { const k = Math.max(0, 1 - (Math.max(0, fwdSpeed) / spec.topSpeed) ** 2.2); engine = spec.engine * 1.4 * thr * k * this.enginePower; }
    } else if (thr < -0.05) {
      if (fwdSpeed > 1) brake = spec.brake * 2.5 * -thr;
      else { const k = Math.max(0, 1 - (-fwdSpeed / spec.reverseSpeed) ** 2); engine = spec.engine * 0.55 * thr * k * this.enginePower; }
    } else brake = 3; // rolling resistance / engine braking
    if (input.brake) brake = Math.max(brake, spec.brake * input.brake);
    const driveWheels = this.wheelLocal.map(wd => spec.drive === 'all' || (spec.drive === 'front') === wd.front);
    const nDrive = driveWheels.filter(Boolean).length || 1;
    this.wheelLocal.forEach((wd, i) => {
      c.setWheelSteering(i, wd.front ? this.steer : 0);
      c.setWheelEngineForce(i, driveWheels[i] ? engine / nDrive : 0);
      const hb = input.handbrake && !wd.front;
      c.setWheelBrake(i, hb ? spec.brake * 0.9 : brake / this.wheelLocal.length);
      c.setWheelFrictionSlip(i, (wd.front ? spec.grip : hb ? spec.handbrakeGrip : spec.rearGrip) * GRIP);
    });
    c.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G_STATIC | G_PROP));
    // Ground contact / downforce / air control
    let contacts = 0;
    for (let i = 0; i < this.wheelLocal.length; i++) if (c.wheelIsInContact(i)) contacts++;
    this.grounded = contacts >= 2;
    const up = this.upVec();
    if (this.grounded) {
      this.airTime = 0;
      const df = spec.downforce * absV * absV * spec.mass * 0.0012;
      this.body.applyImpulse({ x: -up.x * df * dt, y: -up.y * df * dt, z: -up.z * df * dt }, true);
      // Drift assist: when handbraking, add a little yaw torque in the steering direction.
      if (input.handbrake && absV > 6) this.body.applyTorqueImpulse({ x: 0, y: this.steer * spec.mass * 1.6 * dt * Math.sign(fwdSpeed), z: 0 }, true);
    } else {
      this.airTime += dt;
      const av = this.body.angvel();
      this.body.setAngvel({ x: av.x * (1 - dt * 0.8), y: av.y, z: av.z * (1 - dt * 0.8) }, true);
    }
    // Self-righting when stuck on the roof/side and slow.
    if (up.y < 0.35 && absV < 2) {
      this.upsideTime += dt;
      if (this.upsideTime > 2.5) this.reset();
    } else this.upsideTime = 0;
    // Wheel slip (lateral speed at each wheel) for skid marks/sound.
    const av = this.body.angvel();
    const right = { x: f.z * up.y - f.y * up.z, y: f.x * up.z - f.z * up.x, z: f.y * up.x - f.x * up.y }; // up x f? (approx; sign irrelevant)
    const latBody = v.x * right.x + v.y * right.y + v.z * right.z;
    this.wheelLocal.forEach((wd, i) => {
      const yawRate = av.y;
      const lat = latBody + yawRate * wd.z * (wd.front ? 1 : 1);
      const spin = Math.abs(c.wheelEngineForce(i) ?? 0) > spec.engine * 0.35 && absV < 6 ? 4 : 0;
      this.slip[i] = c.wheelIsInContact(i) ? Math.max(Math.abs(lat), spin, input.handbrake && !wd.front && absV > 4 ? absV * 0.5 : 0) : 0;
    });
    // RPM model with fake gears
    const gearTop = [0, 9, 17, 26, 36, 60];
    let g = 1; while (g < gearTop.length - 1 && absV > gearTop[g]) g++;
    const lo = gearTop[g - 1], hi = gearTop[g];
    const targetRpm = Math.min(1, 0.18 + ((absV - lo) / (hi - lo)) * 0.8 + Math.abs(thr) * 0.08);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 8);
  }
  /** Call after the world step: detects sudden velocity changes (crashes). */
  postStep() {
    const v = this.body.linvel();
    const dx = v.x - this.lastVel.x, dy = v.y - this.lastVel.y, dz = v.z - this.lastVel.z;
    const dv = Math.hypot(dx, dy * 0.5, dz);
    this.impact = dv > 2.2 ? dv : 0;
    if (this.impact) { this.impactDir.x = -dx / dv; this.impactDir.y = -dy / dv; this.impactDir.z = -dz / dv; }
    this.lastVel.x = v.x; this.lastVel.y = v.y; this.lastVel.z = v.z;
  }
  reset() {
    const p = this.body.translation();
    const yaw = this.yaw;
    this.body.setTranslation({ x: p.x, y: p.y + 1.2, z: p.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.upsideTime = 0;
  }
  teleport(x: number, y: number, z: number, yaw: number) {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lastVel = { x: 0, y: 0, z: 0 };
  }
  dispose() {
    this.physics.world.removeVehicleController(this.ctrl);
    this.physics.world.removeRigidBody(this.body);
  }
}
export { UP };
