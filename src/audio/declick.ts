/**
 * Click-free parameter moves. Any abrupt gain step on an audible signal is heard as a pop, so every stop / steal /
 * release goes through here: a gain is never set to a new value in zero time, the shortest ramp is MIN_RAMP (5 ms).
 * `AudioParamLike` is the tiny subset of AudioParam used, so the schedules can be unit tested without Web Audio.
 */
export const MIN_RAMP = 0.005;
export interface AudioParamLike {
  value: number;
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  setTargetAtTime(v: number, t: number, tc: number): unknown;
}

/** Fades a gain to silence from wherever it currently is, over at least MIN_RAMP; returns the time silence is reached. */
export function fadeOutParam(p: AudioParamLike, now: number, dur = 0.03): number {
  const d = Math.max(MIN_RAMP, dur);
  p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(0, now + d);
  return now + d;
}

/** Smooth move toward `v` (exponential, time constant `tc` floored so the step is never faster than ~MIN_RAMP). */
export function glideParam(p: AudioParamLike, v: number, now: number, tc = 0.03): void {
  p.setTargetAtTime(v, now, Math.max(MIN_RAMP / 3, tc));
}

/** Worst instantaneous gain step in a recorded schedule (events sorted by time); used by the tests. */
export interface ParamEvent { type: 'set' | 'ramp' | 'target' | 'cancel'; v: number; t: number; tc?: number }
export function worstStep(events: ParamEvent[], start: number): { step: number; dt: number } {
  let cur = start, last = -Infinity, worst = { step: 0, dt: Infinity };
  for (const e of events) {
    if (e.type === 'cancel') continue;
    if (e.type === 'set') { const s = Math.abs(e.v - cur); if (s > worst.step) worst = { step: s, dt: 0 }; cur = e.v; last = e.t; }
    else if (e.type === 'ramp') { const dt = e.t - Math.max(last, -1e9); const s = Math.abs(e.v - cur); if (s > 0 && dt < MIN_RAMP - 1e-9 && s > worst.step) worst = { step: s, dt }; cur = e.v; last = e.t; }
    else { cur = e.v; }
  }
  return worst;
}
