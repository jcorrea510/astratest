/**
 * Live display / accessibility switches that renderer, camera and haptics read every frame without owning the Settings object.
 * Input.pollGamepad (called once per frame by the game loop) publishes the current Settings here, so a change in the menu
 * takes effect on the next frame with no extra wiring. All fields have the same defaults as Settings.
 */
import type { Settings } from './settings';

export interface RuntimeA11y { speedBlur: boolean; reduceMotion: boolean; vibration: boolean; resolutionScale: number; fpsCap: number }
export const runtime: RuntimeA11y = { speedBlur: true, reduceMotion: false, vibration: true, resolutionScale: 1, fpsCap: 0 };

export function publishRuntime(s: Partial<Settings>, out: RuntimeA11y = runtime): RuntimeA11y {
  out.speedBlur = s.speedBlur ?? true;
  out.reduceMotion = s.reduceMotion ?? false;
  out.vibration = s.vibration ?? true;
  out.resolutionScale = Math.min(1, Math.max(0.5, s.resolutionScale ?? 1));
  out.fpsCap = s.fpsCap === 30 || s.fpsCap === 60 ? s.fpsCap : 0;
  return out;
}

/** Strength of the radial speed blur (0 = off). Off with the Speed Blur setting or Reduce Motion. */
export function speedBlurAmount(fx: number, r: Pick<RuntimeA11y, 'speedBlur' | 'reduceMotion'> = runtime): number {
  return r.speedBlur && !r.reduceMotion ? fx : 0;
}
/** Multiplier for camera shake, FOV kick and head bob. */
export function motionScale(r: Pick<RuntimeA11y, 'reduceMotion'> = runtime): number { return r.reduceMotion ? 0.25 : 1; }

/** True when a frame should be drawn under a frame-rate cap (0 = uncapped). A 1 ms slack stops 60 on a 60 Hz screen skipping every other frame. */
export function frameDue(now: number, last: number, cap: number): boolean {
  return cap <= 0 || now - last >= 1000 / cap - 1;
}
