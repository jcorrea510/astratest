/** Helpers for saving the player's car: which palette entry a vehicle's paint came from (pure, linear-space colours). */
import { Color } from 'three';

export interface RgbLike { r: number; g: number; b: number }

/** Index of the palette hex (sRGB) closest to a linear paint colour; 0 when the palette is empty. */
export function paintIndexFor(paints: readonly string[], linear: RgbLike): number {
  let best = 0, bestD = Infinity;
  paints.forEach((hex, i) => {
    const c = new Color(hex).convertSRGBToLinear();
    const d = (c.r - linear.r) ** 2 + (c.g - linear.g) ** 2 + (c.b - linear.b) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
