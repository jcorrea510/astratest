/** Round 7 garages (pure pricing / palette, used by Activities and tests). */
export const RESPRAY = 150;
/** Paint colours a garage offers (hex, name). Original names. */
export const GARAGE_PAINTS: [string, string][] = [
  ['#1f2a44', 'Midnight Navy'], ['#e8e2d0', 'Bone White'], ['#3d3d42', 'Graphite'], ['#8a1c1c', 'Brick Red'],
  ['#2fa39a', 'Harbor Teal'], ['#f26b3a', 'Sunset Orange'], ['#ffcc4d', 'Taxi Yellow'], ['#7b2cbf', 'Neon Violet'],
  ['#15171a', 'Gloss Black'], ['#9aa3ab', 'Silver Fog'], ['#2f5d34', 'Racing Green'], ['#c9a227', 'Old Gold'],
];
export const GARAGE_NAMES = ['Glow Garage', 'Fuel Stop service bay'];
/** Repair price from the health fraction (1 = perfect): $0 when nothing to fix, else $60 + up to $440 by the damage. */
export function repairPrice(healthFrac: number, lightsBroken = false): number {
  const dmg = Math.max(0, Math.min(1, 1 - healthFrac));
  if (dmg < 0.01 && !lightsBroken) return 0;
  return Math.round(60 + dmg * 440 + (lightsBroken ? 40 : 0));
}
