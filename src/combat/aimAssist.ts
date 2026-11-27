/** Subtle ADS aim assist: look friction near a target, plus a very gentle pad-only pull toward its chest. Pure math, allocation-free. */
export const ASSIST_CONE = 3 * Math.PI / 180;
export const ASSIST_RANGE = 60;
export const ASSIST_MIN_RANGE = 1.5;
/** look-delta multiplier at the centre of the cone (1 at its edge) */
export const ASSIST_FRICTION = 0.65;
/** pad pull speed in rad/s at the centre of the cone */
export const ASSIST_PULL_RATE = 0.35;

export interface AssistOut { friction: number; dYaw: number; dPitch: number }
export const makeAssistOut = (): AssistOut => ({ friction: 1, dYaw: 0, dPitch: 0 });

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * Camera `yaw` / `pitch` (game convention: forward = (-sin yaw cos p, sin p, -cos yaw cos p)) aiming from (ox,oy,oz) at a target chest point.
 * Writes the look-friction multiplier and (pad only) the yaw / pitch nudge for this frame. Outside the cone, range, or with no target: friction 1, no pull.
 */
export function adsAssist(yaw: number, pitch: number, ox: number, oy: number, oz: number, tx: number, ty: number, tz: number, usePad: boolean, dt: number, out: AssistOut): AssistOut {
  out.friction = 1; out.dYaw = 0; out.dPitch = 0;
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < ASSIST_MIN_RANGE || dist > ASSIST_RANGE) return out;
  const eYaw = wrap(Math.atan2(-dx, -dz) - yaw);
  const ePitch = Math.asin(Math.max(-1, Math.min(1, dy / dist))) - pitch;
  const err = Math.hypot(eYaw * Math.cos(pitch), ePitch); // approx angular error, radians
  if (err >= ASSIST_CONE) return out;
  const w = 1 - err / ASSIST_CONE; // 0 at the edge, 1 dead centre: smooth, never a snap
  const s = w * w * (3 - 2 * w);
  out.friction = 1 - (1 - ASSIST_FRICTION) * s;
  if (usePad && dt > 0) {
    const step = ASSIST_PULL_RATE * s * dt;
    out.dYaw = Math.max(-Math.abs(eYaw), Math.min(Math.abs(eYaw), Math.sign(eYaw) * step));
    out.dPitch = Math.max(-Math.abs(ePitch), Math.min(Math.abs(ePitch), Math.sign(ePitch) * step));
  }
  return out;
}
