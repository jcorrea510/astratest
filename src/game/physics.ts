import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
export type Box = { center: [number, number, number]; half: [number, number, number] };
export const VEHICLE_SPECS = {
  coupe: { mass: 1100, acceleration: 20, maxSpeed: 38, grip: 7, steering: 1.6 },
  sedan: { mass: 1500, acceleration: 15, maxSpeed: 31, grip: 9, steering: 1.35 },
  van: { mass: 2200, acceleration: 10, maxSpeed: 24, grip: 6, steering: 1.0 },
  patrol: { mass: 1600, acceleration: 18, maxSpeed: 35, grip: 10, steering: 1.45 },
};
export type VehicleKind = keyof typeof VEHICLE_SPECS;
export type CarPhysics = { body: RAPIER.RigidBody; collider: RAPIER.Collider; kind: VehicleKind; damage: number; speed: number; steer: number; lastSpeed: number };
export class Physics {
  world: RAPIER.World;
  player: RAPIER.RigidBody;
  playerCollider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  cars: CarPhysics[] = [];
  constructor(boxes: Box[], spawn: [number, number, number]) {
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(400, 1, 400).setTranslation(0, -1, 0).setFriction(0.8));
    for (const box of boxes) this.world.createCollider(RAPIER.ColliderDesc.cuboid(...box.half).setTranslation(...box.center));
    this.player = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn[0], 1, spawn[2]));
    this.playerCollider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.35), this.player);
    this.controller = this.world.createCharacterController(0.03);
    this.controller.enableAutostep(0.4, 0.2, true);
    this.controller.enableSnapToGround(0.5);
  }
  addCar(kind: VehicleKind, x: number, z: number, yaw = 0): CarPhysics {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.7, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setLinearDamping(0.2).setAngularDamping(3).enabledRotations(false, true, false).setCcdEnabled(true));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.92, 0.55, kind === 'van' ? 2.3 : 2).setMass(VEHICLE_SPECS[kind].mass).setFriction(0.15).setRestitution(0.1), body);
    const car = { body, collider, kind, damage: 0, speed: 0, steer: 0, lastSpeed: 0 };
    this.cars.push(car); return car;
  }
  drive(car: CarPhysics, throttle: number, steering: number, handbrake: boolean, dt: number) {
    const q = car.body.rotation();
    const forward = new Vector3(0, 0, -1).applyQuaternion(q);
    const right = new Vector3(1, 0, 0).applyQuaternion(q);
    const v = car.body.linvel();
    const velocity = new Vector3(v.x, 0, v.z);
    const speed = velocity.dot(forward), lateral = velocity.dot(right);
    const spec = VEHICLE_SPECS[car.kind];
    car.speed = speed; car.steer += (steering - car.steer) * Math.min(1, dt * 8);
    const accel = throttle * spec.acceleration * (1 - Math.min(0.9, car.damage * 0.005));
    const drag = speed * (handbrake ? 3.5 : 0.18);
    const thrust = Math.abs(speed) < spec.maxSpeed || Math.sign(throttle) !== Math.sign(speed) ? accel : 0;
    velocity.addScaledVector(forward, (thrust - drag) * dt);
    velocity.addScaledVector(right, -lateral * Math.min(1, dt * (handbrake ? 1.5 : spec.grip)));
    car.body.setLinvel({ x: velocity.x, y: v.y, z: velocity.z }, true);
    car.body.setAngvel({ x: 0, y: -car.steer * spec.steering * Math.min(1, Math.abs(speed) / 6) * Math.sign(speed), z: 0 }, true);
  }
  movePlayer(dx: number, dz: number, dt: number) {
    this.controller.computeColliderMovement(this.playerCollider, { x: dx * dt, y: -18 * dt, z: dz * dt });
    const m = this.controller.computedMovement(), p = this.player.translation();
    this.player.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });
  }
  step(dt: number) {
    this.world.timestep = Math.min(dt, 1 / 30); this.world.step();
    for (const car of this.cars) {
      const v = car.body.linvel(), speed = Math.hypot(v.x, v.z);
      const impact = Math.max(0, car.lastSpeed - speed - 1.5);
      if (impact > 2) car.damage = Math.min(100, car.damage + impact * 2);
      car.lastSpeed = speed;
    }
  }
  dispose() { this.world.free(); }
}
export async function initPhysics() { await RAPIER.init(); }
