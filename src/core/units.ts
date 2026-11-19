/** US customary units for everything the player reads: mph, feet / miles, 12-hour clock. World units are metres and m/s. */
export const MPS_TO_MPH = 2.236936;
export const M_TO_FT = 3.280840;
export const M_PER_MILE = 1609.344;

export const mph = (mps: number): number => mps * MPS_TO_MPH;
export const mpsFromMph = (v: number): number => v / MPS_TO_MPH;
export const miles = (m: number): number => m / M_PER_MILE;
export const feet = (m: number): number => m * M_TO_FT;

/** "320 ft" under a tenth of a mile (rounded to 10 ft), otherwise "0.4 mi" / "12 mi". */
export function fmtDistance(m: number): string {
  const mi = m / M_PER_MILE;
  if (mi < 0.1) return `${Math.round(m * M_TO_FT / 10) * 10} ft`;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}
/** 18.7 (hours) -> "6:42 PM". */
export function fmtClock12(hour: number): string {
  const total = Math.floor(((hour % 24) + 24) % 24 * 60);
  const h24 = Math.floor(total / 60), mi = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mi).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
