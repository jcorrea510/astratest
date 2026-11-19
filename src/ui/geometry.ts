/** Pure maths shared by the minimap, the full map and the weapon wheel. */

/**
 * World (x, z) to minimap pixels relative to the minimap centre.
 * heading: radians, 0 = facing -z (north), positive = clockwise. The map rotates so the heading points up.
 */
export function worldToMinimap(px: number, pz: number, heading: number, scale: number, x: number, z: number, out = { x: 0, y: 0 }) {
  const dx = x - px, dz = z - pz;
  const c = Math.cos(heading), s = Math.sin(heading);
  out.x = (dx * c + dz * s) * scale;
  out.y = (-dx * s + dz * c) * scale;
  return out;
}

/** Clamps a point to a circle of radius r around the origin. Returns true if it was clamped. */
export function clampToRadius(p: { x: number; y: number }, r: number): boolean {
  const d = Math.hypot(p.x, p.y);
  if (d <= r) return false;
  p.x = (p.x / d) * r; p.y = (p.y / d) * r;
  return true;
}

/**
 * Pulls a point (relative to the origin) back along its ray from the origin until it lies inside the box
 * [minX, maxX] x [minY, maxY] (the box must contain the origin). Returns true if it was clamped.
 */
export function clampToBox(p: { x: number; y: number }, minX: number, maxX: number, minY: number, maxY: number): boolean {
  let k = 1;
  if (p.x > maxX) k = Math.min(k, maxX / p.x);
  if (p.x < minX) k = Math.min(k, minX / p.x);
  if (p.y > maxY) k = Math.min(k, maxY / p.y);
  if (p.y < minY) k = Math.min(k, minY / p.y);
  if (k >= 1) return false;
  p.x *= k; p.y *= k;
  return true;
}

/** The island's grid is drawn tilted like Manhattan's: grid north (-z) leans this many radians clockwise on the maps. */
export const MAP_TILT = 29 * Math.PI / 180;
/** World direction of true north (the direction that points straight up on the tilted maps). */
export const TRUE_NORTH = { x: -Math.sin(MAP_TILT), z: -Math.cos(MAP_TILT) };
/** Full-map view centred on (cx, cz) at `scale` pixels per metre; `tilt` (radians, clockwise) rotates the map presentation. */
export interface MapView { cx: number; cz: number; scale: number; w: number; h: number; tilt?: number; /** vertical squash of the ground plane (1 = top-down, <1 = pitched 3D view) */ pitch?: number }
export function mapWorldToScreen(v: MapView, x: number, z: number) {
  const t = v.tilt ?? 0, c = Math.cos(t), s = Math.sin(t), dx = x - v.cx, dz = z - v.cz, p = v.pitch ?? 1;
  return { x: (dx * c - dz * s) * v.scale + v.w / 2, y: (dx * s + dz * c) * v.scale * p + v.h / 2 };
}
export function mapScreenToWorld(v: MapView, sx: number, sy: number) {
  const t = v.tilt ?? 0, c = Math.cos(t), s = Math.sin(t), px = (sx - v.w / 2) / v.scale, py = (sy - v.h / 2) / v.scale / (v.pitch ?? 1);
  return { x: px * c + py * s + v.cx, z: -px * s + py * c + v.cz };
}
/** A screen-space delta (pixels / scale already applied) expressed in world metres. */
export function mapScreenDeltaToWorld(v: MapView, dx: number, dy: number) {
  const t = v.tilt ?? 0, c = Math.cos(t), s = Math.sin(t), py = dy / (v.pitch ?? 1);
  return { x: dx * c + py * s, z: -dx * s + py * c };
}

/** Wheel slot for a direction in screen space (dy positive = down). Slot 0 is at the top, then clockwise. */
export function slotFromDirection(dx: number, dy: number, n: number): number {
  if (n <= 0) return -1;
  const ang = Math.atan2(dx, -dy); // 0 = up, clockwise positive
  const step = (Math.PI * 2) / n;
  return ((Math.round(ang / step) % n) + n) % n;
}

/** Accumulates a pointer/stick delta into a vector clamped to `max` length. */
export function accumulateDirection(acc: { x: number; y: number }, dx: number, dy: number, max: number) {
  acc.x += dx; acc.y += dy;
  clampToRadius(acc, max);
  return acc;
}

/** Centre angle (radians, 0 = up, clockwise) of wheel slot i of n. */
export function slotAngle(i: number, n: number) { return (i / n) * Math.PI * 2; }

export function formatMoney(n: number): string {
  const v = Math.round(n);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US')}`;
}

export function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
