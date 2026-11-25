/** Controller rumble with a per-trigger cooldown, gated by the Vibration setting. */
import { runtime } from './runtime';

export interface RumbleState { until: number; strength: number }
export interface RumblePlan { weak: number; strong: number; ms: number }

/**
 * Decides whether a rumble request plays. A request inside the cooldown of an equal or stronger one is dropped;
 * a clearly stronger one (explosion during gunfire) overrides it. Pure: the caller supplies the clock.
 */
export function planRumble(strength: number, ms: number, now: number, st: RumbleState, enabled: boolean): RumblePlan | null {
  if (!enabled || !(strength > 0.02) || !(ms > 0)) return null;
  const s = Math.min(1, strength);
  if (now < st.until && s < st.strength * 1.3) return null;
  st.until = now + ms; st.strength = s;
  // heavy hits live in the low-frequency motor; light taps (gunfire) mostly in the high-frequency one
  return { strong: Math.min(1, s * 0.9 + 0.1 * s * s), weak: Math.min(1, 0.25 + s * 0.6), ms: Math.min(1200, ms) };
}

const state: RumbleState = { until: 0, strength: 0 };
type Actuator = { playEffect?: (t: string, p: Record<string, number>) => Promise<unknown> };
/** Plays a rumble on the first connected pad that supports it. Never throws. */
export function rumble(strength: number, ms = 120, now = performance.now()): boolean {
  const plan = planRumble(strength, ms, now, state, runtime.vibration);
  if (!plan) return false;
  try {
    const pads = navigator.getGamepads?.();
    if (!pads) return false;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      const a = p && p.connected ? (p as Gamepad & { vibrationActuator?: Actuator }).vibrationActuator : undefined;
      if (a?.playEffect) { void a.playEffect('dual-rumble', { startDelay: 0, duration: plan.ms, weakMagnitude: plan.weak, strongMagnitude: plan.strong })?.catch?.(() => { /* pad refused */ }); return true; }
    }
  } catch { /* blocked by permissions policy */ }
  return false;
}
export function resetRumble() { state.until = 0; state.strength = 0; }
