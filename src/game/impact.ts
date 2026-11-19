/** Pedestrian vs vehicle impact model: damage and launch by speed (m/s), pure so it can be unit tested. */
export type ImpactOutcome = 'brush' | 'aside' | 'hood' | 'over';
export interface PedImpact {
  outcome: ImpactOutcome;
  damage: number;
  /** horizontal launch speed along the car's heading, and upward speed (m/s) */
  carry: number; up: number;
  /** sideways deflection speed (m/s, signed by which side of the car was hit) */
  side: number;
  /** damage to the vehicle (dents above 25) */
  carDamage: number;
}
export const MPH = 0.44704;
/**
 * `speed` m/s; `lateral` signed -1..1 position across the car's width (0 = dead centre); `roll` 0..1 randomness.
 * About 25 mph (11 m/s) and above is lethal for a 100 hp pedestrian; ~15 mph knocks them down and hurts.
 */
export function pedImpact(speed: number, lateral = 0, roll = 0.5): PedImpact {
  const sp = Math.max(0, speed);
  const damage = Math.round(sp * sp * (0.85 + 0.3 * roll));
  const edge = Math.abs(lateral) > 0.75;
  let outcome: ImpactOutcome = sp < 4.5 ? 'brush' : sp < 7 || edge ? 'aside' : sp < 13 ? 'hood' : 'over';
  if (sp < 3) outcome = 'brush';
  const carry = outcome === 'brush' ? sp * 0.6 : outcome === 'aside' ? sp * 0.55 : outcome === 'hood' ? sp * 0.85 : sp * 0.95;
  const up = outcome === 'brush' ? 0 : outcome === 'aside' ? 1.5 : outcome === 'hood' ? 3.5 + sp * 0.1 : 5 + sp * 0.12;
  const side = outcome === 'aside' ? Math.sign(lateral || 1) * (2 + sp * 0.3) : lateral * 1.5;
  return { outcome, damage, carry, up, side, carDamage: 12 + sp * sp * 0.45 };
}
