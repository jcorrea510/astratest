/** Pure helpers for the HUD heat (wanted level) row: 5 segments, filled left to right. */
export const HEAT_SEGMENTS = 5;
export type HeatMode = 'idle' | 'rising' | 'search';

/** How long (ms) the row keeps flashing after heat last went up. */
export const HEAT_RISE_MS = 2200;

/** Number of filled segments (0..5) for a heat value; tiny fractions don't light a segment. */
export function heatFilled(heat: number): number {
  if (!Number.isFinite(heat)) return 0;
  return Math.max(0, Math.min(HEAT_SEGMENTS, Math.ceil(heat - 0.05)));
}

/** Per-segment on/off states, index 0 = first (leftmost) segment. */
export function heatSegments(heat: number): boolean[] {
  const n = heatFilled(heat);
  return Array.from({ length: HEAT_SEGMENTS }, (_, i) => i < n);
}

/** Display mode: fast flash while heat is increasing, slow pulse while police search, otherwise steady. */
export function heatMode(filled: number, searching: boolean, msSinceRise: number): HeatMode {
  if (filled <= 0) return 'idle';
  if (msSinceRise >= 0 && msSinceRise < HEAT_RISE_MS) return 'rising';
  return searching ? 'search' : 'idle';
}
