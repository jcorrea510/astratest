/**
 * Aim math (pure, unit tested). The reticle is the camera's centre ray; the bullet leaves the muzzle and must land
 * where the reticle points:
 *  1. aim point = first thing the camera ray hits (ignoring the shooter), searched from just in front of the shooter
 *     so nothing between the camera and the player's back can catch it;
 *  2. shot direction = muzzle -> aim point (so parallax between the shoulder camera and the gun never pulls shots off);
 *  3. spread is sampled in a cone around that direction, so even hip fire is centred on the dot.
 */
export interface V3 { x: number; y: number; z: number }

/** Distance along the camera ray at which the aim search starts: just past the shooter's position (never negative). */
export function aimSearchStart(camPos: V3, camDir: V3, shooterChest: V3, margin = 0.6): number {
  const t = (shooterChest.x - camPos.x) * camDir.x + (shooterChest.y - camPos.y) * camDir.y + (shooterChest.z - camPos.z) * camDir.z;
  return Math.max(0, t - margin);
}

/**
 * Direction from the muzzle to the aim point (unit), out param. If the aim point is too close to (or behind) the muzzle
 * the camera direction is used instead, which is where the player is looking anyway.
 */
export function shotDirection(muzzle: V3, aim: V3, camDir: V3, out: V3, minDist = 0.75): V3 {
  const dx = aim.x - muzzle.x, dy = aim.y - muzzle.y, dz = aim.z - muzzle.z;
  const along = dx * camDir.x + dy * camDir.y + dz * camDir.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < minDist || along < minDist * 0.5) { out.x = camDir.x; out.y = camDir.y; out.z = camDir.z; return out; }
  out.x = dx / len; out.y = dy / len; out.z = dz / len; return out;
}

/**
 * Samples a direction inside a cone of radius `cone` (tangent offset) around unit `dir`. `u`, `v` in [0, 1): `u` picks
 * the angle and `v` the radius (biased towards the centre with `bias` < 1 meaning more central). Result is unit length.
 */
export function coneSample(dir: V3, cone: number, u: number, v: number, out: V3, bias = 0.75): V3 {
  // orthonormal basis around dir
  let rx = dir.z, ry = 0, rz = -dir.x; let rl = Math.hypot(rx, rz);
  if (rl < 1e-6) { rx = 1; ry = 0; rz = 0; rl = 1; }
  rx /= rl; rz /= rl;
  const ux = ry * dir.z - rz * dir.y, uy = rz * dir.x - rx * dir.z, uz = rx * dir.y - ry * dir.x;
  const a = u * Math.PI * 2, r = cone * Math.pow(v, bias);
  const x = dir.x + rx * Math.cos(a) * r + ux * Math.sin(a) * r, y = dir.y + ry * Math.cos(a) * r + uy * Math.sin(a) * r, z = dir.z + rz * Math.cos(a) * r + uz * Math.sin(a) * r;
  const l = Math.hypot(x, y, z) || 1; out.x = x / l; out.y = y / l; out.z = z / l; return out;
}

/** Angle (radians) between two unit vectors. */
export function angleBetween(a: V3, b: V3): number { return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))); }

/** Ballistic launch for thrown / lobbed projectiles: velocity that leaves along `dir` at `speed`, with some loft. */
export function throwVelocity(dir: V3, speed: number, loft: number, out: V3): V3 {
  out.x = dir.x * speed; out.y = dir.y * speed + loft; out.z = dir.z * speed; return out;
}
