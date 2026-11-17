/** Rapier physics world wrapper with collision groups shared by every system. */
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };
export const G_STATIC = 0x0001, G_VEHICLE = 0x0002, G_CHAR = 0x0004, G_PROP = 0x0008, G_PLAYER = 0x0010;
/** Rapier packs membership in the high 16 bits and the filter in the low 16 bits. */
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const ALL = 0xffff;

export interface ColliderTag { kind: 'static' | 'vehicle' | 'character' | 'prop' | 'water'; ref?: unknown }

export class Physics {
  world: RAPIER.World;
  tags = new Map<number, ColliderTag>();
  eventQueue: RAPIER.EventQueue;
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = 1 / 60;
    this.eventQueue = new RAPIER.EventQueue(true);
  }
  tag(c: RAPIER.Collider, t: ColliderTag) { this.tags.set(c.handle, t); return c; }
  tagOf(c: RAPIER.Collider | null | undefined) { return c ? this.tags.get(c.handle) : undefined; }
  untag(c: RAPIER.Collider | null | undefined) { if (c) this.tags.delete(c.handle); }
  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, friction = 0.7) {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(friction)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setCollisionGroups(groups(G_STATIC, ALL));
    return this.tag(this.world.createCollider(d), { kind: 'static' });
  }
  addStaticCylinder(cx: number, cy: number, cz: number, halfH: number, r: number) {
    const d = RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(cx, cy, cz).setCollisionGroups(groups(G_STATIC, ALL));
    return this.tag(this.world.createCollider(d), { kind: 'static' });
  }
  step(dt: number) {
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
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
