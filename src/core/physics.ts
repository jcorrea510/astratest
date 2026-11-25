/** Rapier physics world wrapper with collision groups shared by every system. */
import RAPIER from '@dimforge/rapier3d-compat';
import { StaticStream } from './staticStream';

export { RAPIER };
export const G_STATIC = 0x0001, G_VEHICLE = 0x0002, G_CHAR = 0x0004, G_PROP = 0x0008, G_PLAYER = 0x0010;
/** Ragdoll limbs, and the cars' ragdoll-only hull proxies (hood / cabin shaped; the plain car box ignores ragdolls). */
export const G_RAG = 0x0020, G_VRAG = 0x0040;
/** Rapier packs membership in the high 16 bits and the filter in the low 16 bits. */
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const ALL = 0xffff;

export interface ColliderTag { kind: 'static' | 'vehicle' | 'character' | 'prop' | 'water'; ref?: unknown }

/** collider -> the stream that may have switched it off (so game code calling setEnabled keeps its meaning) */
const streamOf = new WeakMap<RAPIER.Collider, StaticStream<RAPIER.Collider>>();
let origSetEnabled: ((on: boolean) => void) | null = null;
/**
 * Bumped whenever any body pose can have changed (every world step, setTranslation, setRotation). Per-body pose caches
 * (VehiclePhysics.pose) compare against it: reading translation()/rotation() allocates a wasm object each time and the
 * traffic AI alone made ~700 such calls a frame (Round 12 perf).
 */
export const poseEpoch = { n: 0 };
function patchSetEnabled() {
  if (origSetEnabled) return;
  const bump = <T extends object>(proto: T, name: string) => {
    const f = (proto as Record<string, (...a: unknown[]) => unknown>)[name];
    (proto as Record<string, unknown>)[name] = function (this: unknown, ...a: unknown[]) { poseEpoch.n++; return f.apply(this, a); };
  };
  bump(RAPIER.World.prototype, 'step'); bump(RAPIER.RigidBody.prototype, 'setTranslation'); bump(RAPIER.RigidBody.prototype, 'setRotation');
  const proto = RAPIER.Collider.prototype as unknown as { setEnabled(on: boolean): void };
  const orig = origSetEnabled = proto.setEnabled;
  proto.setEnabled = function (this: RAPIER.Collider, on: boolean) { const st = streamOf.get(this); orig.call(this, st ? st.intercept(this, on) : on); };
}
/** Static colliders at least this wide (m, half extent) are never streamed: ground slabs, world walls, bridges. */
const STREAM_MAX_HALF = 30;

export class Physics {
  world: RAPIER.World;
  /** small static colliders switched on/off by distance to the player (see staticStream.ts) */
  stream: StaticStream<RAPIER.Collider>;
  tags = new Map<number, ColliderTag>();
  eventQueue: RAPIER.EventQueue;
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = 1 / 60;
    this.eventQueue = new RAPIER.EventQueue(true);
    patchSetEnabled();
    this.stream = new StaticStream<RAPIER.Collider>((c, on) => origSetEnabled!.call(c, on), c => !!this.world.getCollider(c.handle));
  }
  private streamed(c: RAPIER.Collider, x: number, z: number, halfXZ: number) {
    if (halfXZ >= STREAM_MAX_HALF) return c;
    streamOf.set(c, this.stream); this.stream.add(c, x, z);
    return c;
  }
  /** Call every frame with the player position: only static props within ~330 m stay in the physics world. */
  streamStatics(x: number, z: number, force = false) { return this.stream.update(x, z, force); }
  tag(c: RAPIER.Collider, t: ColliderTag) { this.tags.set(c.handle, t); return c; }
  tagOf(c: RAPIER.Collider | null | undefined) { return c ? this.tags.get(c.handle) : undefined; }
  untag(c: RAPIER.Collider | null | undefined) { if (c) this.tags.delete(c.handle); }
  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, friction = 0.7) {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(friction)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setCollisionGroups(groups(G_STATIC, ALL));
    return this.tag(this.streamed(this.world.createCollider(d), cx, cz, Math.max(hx, hz)), { kind: 'static' });
  }
  addStaticCylinder(cx: number, cy: number, cz: number, halfH: number, r: number) {
    const d = RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(cx, cy, cz).setCollisionGroups(groups(G_STATIC, ALL));
    return this.tag(this.streamed(this.world.createCollider(d), cx, cz, r), { kind: 'static' });
  }
  step(dt: number) {
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
  }
  /** True when an upright capsule (centre, half height of the straight part, radius) overlaps anything in the filter. */
  overlapsCapsule(cx: number, cy: number, cz: number, halfH: number, r: number, filterGroups = groups(ALL, ALL), excludeRb?: RAPIER.RigidBody | null) {
    const shape = new RAPIER.Capsule(halfH, r);
    return !!this.world.intersectionWithShape({ x: cx, y: cy, z: cz }, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, filterGroups, undefined, excludeRb ?? undefined);
  }
  /** Ray cast returning hit distance, collider and normal. */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxToi: number, filterGroups = groups(ALL, ALL), exclude?: RAPIER.Collider | null, excludeRb?: RAPIER.RigidBody | null) {
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, undefined, filterGroups, exclude ?? undefined, excludeRb ?? undefined);
    if (!hit) return null;
    return { toi: hit.timeOfImpact, collider: hit.collider, normal: hit.normal };
  }
}
export async function initPhysics() {
  // rapier's wasm-bindgen glue logs a deprecation warning about its own init call; keep the console clean.
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].includes('deprecated parameters for the initialization function')) return; warn(...args); };
  try { await RAPIER.init(); } finally { console.warn = warn; }
}
