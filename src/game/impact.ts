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
  let outcome: ImpactOutcome = sp < 4.5 ? 'brush' : sp < 7 || edge ? 'aside' : sp < 14.5 ? 'hood' : 'over';
  if (sp < 3) outcome = 'brush';
  const carry = outcome === 'brush' ? sp * 0.6 : outcome === 'aside' ? sp * 0.55 : outcome === 'hood' ? sp * 0.85 : sp * 0.95;
  const up = outcome === 'brush' ? 0 : outcome === 'aside' ? 1.5 : outcome === 'hood' ? 3.5 + sp * 0.1 : 5 + sp * 0.12;
  const side = outcome === 'aside' ? Math.sign(lateral || 1) * (2 + sp * 0.3) : lateral * 1.5;
  return { outcome, damage, carry, up, side, carDamage: 12 + sp * sp * 0.45 };
}

/** Head-on severe crash speed threshold (45 mph) and windscreen ejection speed threshold (70 mph). */
export const CRASH_SEVERE_SPEED = 45 * MPH;
export const CRASH_EJECT_SPEED = 70 * MPH;

/**
 * Vehicle collision damage scaled by impact speed normal to the contacted surface (D1).
 * Glancing scrapes (< 20 deg) deal minimal damage (<= 6% single hit, 0 during sustained scrape cooldown),
 * while square head-on hits at the same total speed still deal heavy damage.
 */
export function vehicleCrashDamage(normalSpeed: number, angleDeg: number, maxHealth: number, sustainedScrape = false): number {
  if (!Number.isFinite(normalSpeed) || normalSpeed <= 3.5) return 0;
  const base = Math.pow(normalSpeed - 3.0, 0.92) * 26;
  if (angleDeg < 20) {
    if (sustainedScrape) return 0;
    const glanceScale = 0.2 + 0.8 * Math.max(0, angleDeg) / 20;
    return Math.min(base * glanceScale, maxHealth * 0.06);
  }
  return base;
}

/**
 * Whether a sudden velocity change counts as a crash. Against a wall or barrier the normal component decides (> 3.5 m/s);
 * any other knock keeps the old 4 m/s total threshold. (The normal-impact rewrite let 3.5-4 m/s nudges count everywhere,
 * so a car given a small speed kick stopped with its hazards on as if it had crashed, and traffic behind it waited.)
 */
export function crashRegistered(impact: number, normalImpact: number, wallContact: boolean): boolean {
  return wallContact ? normalImpact > 3.5 : impact > 4;
}

export interface CrashEffects {
  /** >= 45 mph (~20.1 m/s) head-on into a solid obstacle */
  severe: boolean;
  /** Camera trauma impulse (caller scales by settings.cameraShake) */
  shake: number;
  /** Short slow camera pull-back distance in metres (caller scales by settings.cameraShake) */
  pullBack: number;
  /** Shatter windscreen and front glass */
  shatterFront: boolean;
  /** Lethal to NPC driver (leaves horn stuck on) */
  killNpcDriver: boolean;
  /** Launch unbelted driver through the windscreen via ragdoll (strictly gated by Blood & gore) */
  ejectDriver: boolean;
  /** Forward launch speed (m/s) when ejected */
  ejectSpeed: number;
}

/**
 * Classifies high-speed crash feedback (D5).
 * `normalImpact`: impact speed normal to the obstacle (m/s); `frontDot`: alignment with vehicle forward (-1..1).
 */
export function crashEffects(normalImpact: number, frontDot: number, isNpc: boolean, blood: boolean, preSpeed = normalImpact): CrashEffects {
  const effective = Math.max(normalImpact, preSpeed * Math.max(0, frontDot) * 0.95);
  const headOn = frontDot > 0.55;
  const severe = headOn && normalImpact >= CRASH_SEVERE_SPEED * 0.85 && effective >= CRASH_SEVERE_SPEED;
  if (!severe) {
    return {
      severe: false,
      shake: Math.min(0.75, Math.max(0, normalImpact / 20)),
      pullBack: 0,
      shatterFront: false,
      killNpcDriver: false,
      ejectDriver: false,
      ejectSpeed: 0,
    };
  }
  const over = Math.max(0, effective - CRASH_SEVERE_SPEED);
  const shake = Math.min(1.35, 0.88 + over * 0.032);
  const pullBack = Math.min(1.65, 0.85 + over * 0.048);
  const ejectThresh = isNpc ? CRASH_EJECT_SPEED * 0.9 : CRASH_EJECT_SPEED;
  const ejectDriver = blood && effective >= ejectThresh;
  const ejectSpeed = ejectDriver ? Math.min(26, Math.max(12, preSpeed * 0.62)) : 0;
  return {
    severe: true,
    shake,
    pullBack,
    shatterFront: true,
    killNpcDriver: isNpc,
    ejectDriver,
    ejectSpeed,
  };
}

