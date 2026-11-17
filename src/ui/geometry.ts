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

/** Full-map view: a non-rotated top-down view centred on (cx, cz) at `scale` pixels per metre. */
export interface MapView { cx: number; cz: number; scale: number; w: number; h: number }
export function mapWorldToScreen(v: MapView, x: number, z: number) {
  return { x: (x - v.cx) * v.scale + v.w / 2, y: (z - v.cz) * v.scale + v.h / 2 };
}
export function mapScreenToWorld(v: MapView, sx: number, sy: number) {
  return { x: (sx - v.w / 2) / v.scale + v.cx, z: (sy - v.h / 2) / v.scale + v.cz };
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
