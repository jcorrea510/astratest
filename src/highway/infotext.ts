/** Pure text helpers for the cockpit screens (clock, next-exit countdown, trip), kept free of canvas code so they are unit-testable. */
const METERS_PER_MILE = 1609.344;

/** 12-hour clock from a fractional 24 h hour: 14.2 -> "2:12 PM". */
export function clockText(hour24: number): string {
  const t = ((hour24 % 24) + 24) % 24, h = Math.floor(t), m = Math.min(59, Math.floor((t - h) * 60));
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
/** Exit spacing for the navigation card: a new exit every 8 km. */
export const EXIT_SPACING_M = 8000;
const ROADS = ['Harbor Rd', 'Pine Ridge Pkwy', 'Mill St', 'Sunset Blvd', 'Quarry Ln', 'Cedar Ave', 'Lakeview Dr', 'Foundry Way'];
export interface NextExit { exit: string; road: string; dist: string; frac: number }
/** Next exit after `meters` driven: exit number, road, distance text (miles, then feet when close) and 0..1 progress to it. */
export function nextExit(meters: number): NextExit {
  const idx = Math.floor(meters / EXIT_SPACING_M), left = EXIT_SPACING_M - (meters - idx * EXIT_SPACING_M), mi = left / METERS_PER_MILE;
  const dist = mi >= 0.2 ? `${mi.toFixed(1)} mi` : `${Math.max(50, Math.round((mi * 5280) / 50) * 50)} ft`;
  return { exit: `Exit ${47 + idx}${'AB'[idx % 2]}`, road: ROADS[idx % ROADS.length], dist, frac: 1 - left / EXIT_SPACING_M };
}
export const tripText = (meters: number): string => `${(meters / METERS_PER_MILE).toFixed(1)} mi`;
