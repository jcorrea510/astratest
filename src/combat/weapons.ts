/**
 * Weapon definitions, inventory rules and wheel categories. Pure logic (unit tested); the procedural models live in
 * weaponModels.ts (re-exported here so existing imports keep working).
 *
 * Damage model: `damage` is what one round (or pellet) does to an unarmoured person's torso at close range; the hit
 * zone (combat/hitzones.ts) scales it: head = instant kill for every gun, neck x1.6, arms x0.6, legs x0.7. People have
 * 100 health, so pistols (~55-60) drop someone in two torso hits and one head hit. Police/army vests cut torso damage
 * unless the round is armour-piercing (`pierce`). `playerDamage` is what the same round does to the player (scaled down
 * so firefights are survivable but scary).
 */
import type { WeaponIcon } from '../ui/contracts';
import type { GunSound } from '../audio/gunsynth';

export type WeaponId =
  | 'fists' | 'knife' | 'bat'
  | 'compact' | 'pistol' | 'heavyPistol' | 'revolver' | 'machinePistol'
  | 'compactSmg' | 'smg'
  | 'sawnoff' | 'shotgun' | 'autoShotgun'
  | 'carbine' | 'rifle' | 'battleRifle' | 'marksman' | 'sniper'
  | 'lmg' | 'grenadeLauncher' | 'rpg'
  | 'grenade' | 'molotov';
/** Weapon wheel categories (one wheel slot each). */
export type WeaponCat = 'melee' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'heavy' | 'throw';
export const CATEGORY_ORDER: WeaponCat[] = ['melee', 'pistol', 'smg', 'shotgun', 'rifle', 'heavy', 'throw'];
export const CATEGORY_NAME: Record<WeaponCat, string> = { melee: 'Melee', pistol: 'Pistols', smg: 'SMGs', shotgun: 'Shotguns', rifle: 'Rifles', heavy: 'Heavy', throw: 'Throwables' };
/** semi: one round per click; auto: hold; burst: `burst` rounds per click; pump / bolt: semi with a manual cycle between shots. */
export type FireMode = 'semi' | 'auto' | 'burst' | 'pump' | 'bolt';
/** How the gun reloads (drives the animation and foley). */
export type ReloadKind = 'mag' | 'shell' | 'revolver' | 'break' | 'bolt' | 'belt' | 'single' | 'none';
/** What leaves the muzzle: hitscan rounds, or a physical projectile. */
export type Projectile = 'none' | 'grenade40' | 'rocket' | 'frag' | 'molotov';

/**
 * Weapon tuning. Angles are radians (a "spread" is the radius of the shot cone as an offset on a unit direction).
 * Shooting model (see PlayerCombat): cone = base x accuracy + bloom + movement, where base is `spread` from the hip or
 * `aimSpread` when aiming, and accuracy settles to `firstShot` after holding still on target for a moment. The cone is
 * always centred on the reticle's aim point.
 */
export interface WeaponDef {
  id: WeaponId; name: string; icon: WeaponIcon; cat: WeaponCat; melee: boolean;
  /** one-line shop / wheel description */ blurb: string;
  damage: number; playerDamage: number; pellets: number; interval: number; auto: boolean; mode: FireMode; burst: number;
  clip: number; reload: number; spread: number; aimSpread: number; recoil: number; range: number; price: number; ammoPrice: number; ammoPack: number;
  /** gunshot voice (audio/gunsynth.ts); melee weapons use 'punch' */ sound: GunSound | 'punch';
  /** base contract sound when the extended audio engine is not available */ baseSound: 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'punch';
  shake: number; knockback: number;
  /** armour-piercing: ignores vests */ pierce: boolean;
  /** scope: vertical FOV (degrees) when aiming, 0 = iron sights */ scope: number;
  /** suppressed: quieter, no muzzle flash light */ suppressed: boolean;
  projectile: Projectile; reloadKind: ReloadKind; twoHanded: boolean;
  /** extra seconds when reloading from empty (chambering a round) */ emptyReload: number;
  /** shotgun-style reload: seconds before the first shell and per shell (0 = magazine) */ reloadStart: number; shellReload: number;
  /** damage falloff: full until `falloff[0]` m, linearly down to `falloff[2]` x at `falloff[1]` m */ falloff: [number, number, number];
  /** settled accuracy multiplier on the base cone (first-shot accuracy) */ firstShot: number;
  /** spread bloom added per shot, its cap, the pause before it recovers and the recovery rate (1/s, exponential) */ bloom: number; bloomMax: number; bloomDelay: number; bloomRecover: number;
  /** cone added when moving at jog speed (scaled by speed) and while airborne */ movePenalty: number;
  /** camera kick per shot: pitch up, random yaw, consistent yaw drift; recovery delay/rate (1/s) and fraction returned */ kickPitch: number; kickYaw: number; kickDrift: number; recoverDelay: number; recoverRate: number; recoverFrac: number;
  /** visual: weapon slide-back (m), muzzle flip (rad), torso lean (rad), spring rate (1/s) */ kickBack: number; kickFlip: number; kickBody: number; kickRate: number;
  /** muzzle flash size and light intensity */ flash: number; light: number;
  /** seconds after the shot when the empty case is ejected (pump / bolt: on the cycle; < 0 = never, e.g. revolvers) */ eject: number;
  /** brass size class for casings */ casing: 'small' | 'rifle' | 'hull' | 'none';
  /** legacy alias kept for older callers: equals `damage` for guns */ headMul: number;
}

type Spec = Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'icon' | 'cat' | 'blurb' | 'damage' | 'clip' | 'price'>;
const BASE: Omit<WeaponDef, 'id' | 'name' | 'icon' | 'cat' | 'blurb' | 'damage' | 'clip' | 'price'> = {
  melee: false, playerDamage: 10, pellets: 1, interval: 0.17, auto: false, mode: 'semi', burst: 0, reload: 1.3, spread: 0.03, aimSpread: 0.009, recoil: 0.02, range: 120,
  ammoPrice: 60, ammoPack: 24, sound: 'pistol', baseSound: 'pistol', shake: 0.1, knockback: 0.6, pierce: false, scope: 0, suppressed: false, projectile: 'none', reloadKind: 'mag', twoHanded: false,
  emptyReload: 0.25, reloadStart: 0, shellReload: 0, falloff: [25, 70, 0.6], firstShot: 0.2, bloom: 0.014, bloomMax: 0.05, bloomDelay: 0.07, bloomRecover: 6, movePenalty: 0.02,
  kickPitch: 0.026, kickYaw: 0.006, kickDrift: 0, recoverDelay: 0.05, recoverRate: 9, recoverFrac: 0.9, kickBack: 0.06, kickFlip: 0.32, kickBody: 0.05, kickRate: 15, flash: 0.9, light: 32, eject: 0, casing: 'small', headMul: 1,
};
// Class presets (merged under each weapon's own numbers).
const PISTOL: Partial<WeaponDef> = {};
const SMG: Partial<WeaponDef> = { interval: 0.07, auto: true, mode: 'auto', reload: 1.6, spread: 0.05, aimSpread: 0.018, range: 90, ammoPrice: 90, ammoPack: 60, sound: 'smg', baseSound: 'smg', shake: 0.05, knockback: 0.4, twoHanded: true,
  emptyReload: 0.3, falloff: [15, 45, 0.55], firstShot: 0.5, bloom: 0.0045, bloomMax: 0.04, bloomDelay: 0.09, bloomRecover: 5, movePenalty: 0.012, kickPitch: 0.009, kickYaw: 0.008, kickDrift: 0.0015, recoverDelay: 0.07, recoverRate: 7, kickBack: 0.03, kickFlip: 0.09, kickBody: 0.02, kickRate: 24, flash: 0.75, light: 22, playerDamage: 7 };
const SHOTGUN: Partial<WeaponDef> = { pellets: 8, interval: 0.8, mode: 'pump', reload: 2.2, spread: 0.085, aimSpread: 0.06, recoil: 0.075, range: 45, ammoPrice: 80, ammoPack: 12, sound: 'shotgun', baseSound: 'shotgun', shake: 0.32, knockback: 4, twoHanded: true,
  reloadKind: 'shell', reloadStart: 0.3, shellReload: 0.42, emptyReload: 0, falloff: [7, 28, 0.2], firstShot: 0.85, bloom: 0.02, bloomMax: 0.03, bloomDelay: 0.3, bloomRecover: 4, movePenalty: 0.01, kickPitch: 0.075, kickYaw: 0.015, recoverDelay: 0.08, recoverRate: 5,
  kickBack: 0.11, kickFlip: 0.3, kickBody: 0.12, kickRate: 9, flash: 1.25, light: 55, eject: 0.42, casing: 'hull', playerDamage: 3.4 };
const RIFLE: Partial<WeaponDef> = { interval: 0.105, auto: true, mode: 'auto', reload: 1.9, spread: 0.045, aimSpread: 0.0055, range: 220, ammoPrice: 120, ammoPack: 60, sound: 'rifle', baseSound: 'rifle', shake: 0.12, knockback: 1, twoHanded: true, pierce: true,
  emptyReload: 0.35, falloff: [50, 150, 0.75], firstShot: 0.25, bloom: 0.0035, bloomMax: 0.03, bloomDelay: 0.1, bloomRecover: 5, movePenalty: 0.025, kickPitch: 0.013, kickYaw: 0.006, kickDrift: 0.002, recoverDelay: 0.09, recoverRate: 6, recoverFrac: 0.85,
  kickBack: 0.045, kickFlip: 0.1, kickBody: 0.035, kickRate: 18, flash: 1, light: 36, casing: 'rifle', playerDamage: 11 };
const SNIPER: Partial<WeaponDef> = { ...RIFLE, auto: false, mode: 'semi', interval: 0.35, spread: 0.11, aimSpread: 0.0012, range: 400, falloff: [400, 500, 1], firstShot: 0.1, bloom: 0.02, bloomMax: 0.04, bloomDelay: 0.25, bloomRecover: 4, movePenalty: 0.05,
  kickPitch: 0.05, kickYaw: 0.01, kickDrift: 0, recoverDelay: 0.12, recoverRate: 5, recoverFrac: 0.8, kickBack: 0.09, kickFlip: 0.16, kickBody: 0.09, kickRate: 9, flash: 1.3, light: 55, shake: 0.28, knockback: 2.5, scope: 18, playerDamage: 30 };
const THROW: Partial<WeaponDef> = { interval: 0.9, reload: 0.55, emptyReload: 0, spread: 0, aimSpread: 0, recoil: 0, range: 40, ammoPack: 3, ammoPrice: 0, sound: 'pistol', baseSound: 'punch', shake: 0, knockback: 0, reloadKind: 'none', casing: 'none', eject: -1, flash: 0, light: 0,
  firstShot: 1, bloom: 0, bloomMax: 0, movePenalty: 0, kickPitch: 0, kickYaw: 0, recoverFrac: 0, kickBack: 0, kickFlip: 0, kickBody: 0.08, kickRate: 8, falloff: [999, 1000, 1] };
const MELEE: Partial<WeaponDef> = { melee: true, interval: 0.4, reload: 0, spread: 0, aimSpread: 0, recoil: 0, range: 1.7, ammoPrice: 0, ammoPack: 0, sound: 'punch', baseSound: 'punch', shake: 0.08, knockback: 2, reloadKind: 'none', casing: 'none', eject: -1,
  emptyReload: 0, falloff: [999, 1000, 1], firstShot: 1, bloom: 0, bloomMax: 0, movePenalty: 0, kickPitch: 0, kickYaw: 0, recoverFrac: 0, kickBack: 0, kickFlip: 0, kickBody: 0.06, kickRate: 12, flash: 0, light: 0, playerDamage: 8 };

function def(preset: Partial<WeaponDef>, s: Spec): WeaponDef {
  const d = { ...BASE, ...preset, ...s } as WeaponDef;
  d.auto = d.mode === 'auto';
  d.headMul = 1;
  return d;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // ---------------- melee ----------------
  fists: def(MELEE, { id: 'fists', name: 'Fists', icon: 'fists', cat: 'melee', blurb: 'Bare knuckles.', damage: 18, clip: 0, price: 0 }),
  knife: def(MELEE, { id: 'knife', name: 'Tidewater Folder', icon: 'knife', cat: 'melee', blurb: 'Folding work knife. Fast, quiet, close.', damage: 55, clip: 0, price: 120, interval: 0.45, range: 1.6, knockback: 0.8, playerDamage: 14 }),
  bat: def(MELEE, { id: 'bat', name: 'Boardwalk Slugger', icon: 'bat', cat: 'melee', blurb: 'Ash baseball bat. Big swing, big knockback.', damage: 60, clip: 0, price: 160, interval: 0.75, range: 2.0, knockback: 6, shake: 0.14, playerDamage: 16 }),
  // ---------------- pistols ----------------
  compact: def(PISTOL, { id: 'compact', name: 'Wren .380', icon: 'pistol', cat: 'pistol', blurb: 'Pocket pistol. Light, snappy, two to the chest.', damage: 54, clip: 8, price: 350, interval: 0.15, reload: 1.1, aimSpread: 0.011, kickPitch: 0.02, kickFlip: 0.26, flash: 0.7, light: 24, ammoPack: 24, ammoPrice: 50, sound: 'compact', falloff: [18, 55, 0.6], playerDamage: 8 }),
  pistol: def(PISTOL, { id: 'pistol', name: 'Kestrel P9', icon: 'pistol', cat: 'pistol', blurb: 'Service 9 mm. Accurate, dependable.', damage: 58, clip: 15, price: 500, interval: 0.16, reload: 1.25, ammoPack: 30, sound: 'pistol', playerDamage: 9 }),
  heavyPistol: def(PISTOL, { id: 'heavyPistol', name: 'Bastion .45', icon: 'pistol', cat: 'pistol', blurb: 'Full-size .45. Heavy kick, heavy hits.', damage: 76, clip: 9, price: 950, interval: 0.24, reload: 1.4, kickPitch: 0.04, kickFlip: 0.42, kickBack: 0.08, shake: 0.16, flash: 1.05, light: 40, knockback: 1.2, sound: 'heavyPistol', falloff: [25, 75, 0.65], playerDamage: 12 }),
  revolver: def(PISTOL, { id: 'revolver', name: 'Ironside .357', icon: 'revolver', cat: 'pistol', blurb: 'Six-shot magnum revolver. One good hit is enough.', damage: 105, clip: 6, price: 1400, interval: 0.48, reload: 2.4, emptyReload: 0, reloadKind: 'revolver', aimSpread: 0.006, firstShot: 0.15,
    kickPitch: 0.07, kickYaw: 0.01, kickFlip: 0.6, kickBack: 0.1, kickBody: 0.08, kickRate: 10, shake: 0.24, flash: 1.35, light: 50, knockback: 2, sound: 'revolver', eject: -1, casing: 'none', pierce: true, falloff: [35, 90, 0.7], playerDamage: 18 }),
  machinePistol: def(PISTOL, { id: 'machinePistol', name: 'Hornet MP', icon: 'pistol', cat: 'pistol', blurb: 'Full-auto pistol. Sprays fast, empties faster.', damage: 36, clip: 20, price: 1700, mode: 'auto', interval: 0.06, reload: 1.35, spread: 0.055, aimSpread: 0.024,
    firstShot: 0.6, bloom: 0.006, bloomMax: 0.055, kickPitch: 0.011, kickYaw: 0.012, kickDrift: 0.002, kickFlip: 0.14, kickRate: 22, flash: 0.7, light: 20, ammoPack: 60, ammoPrice: 80, sound: 'machinePistol', falloff: [12, 40, 0.5], playerDamage: 6 }),
  // ---------------- SMGs ----------------
  compactSmg: def(SMG, { id: 'compactSmg', name: 'Mako Compact', icon: 'smg', cat: 'smg', blurb: 'Folding-stock micro SMG. Hip-fire friendly.', damage: 36, clip: 30, price: 1900, interval: 0.068, spread: 0.045, sound: 'compactSmg' }),
  smg: def(SMG, { id: 'smg', name: 'Vandal 9', icon: 'smg', cat: 'smg', blurb: 'Full-size 9 mm SMG with a red-dot. Steady and controllable.', damage: 40, clip: 30, price: 2600, interval: 0.075, aimSpread: 0.012, firstShot: 0.4, kickPitch: 0.008, kickYaw: 0.006, sound: 'smg', falloff: [20, 55, 0.6] }),
  // ---------------- shotguns ----------------
  sawnoff: def(SHOTGUN, { id: 'sawnoff', name: 'Stub Twin', icon: 'shotgun', cat: 'shotgun', blurb: 'Sawed-off double barrel. Two shells, point blank.', damage: 21, pellets: 10, clip: 2, price: 1200, mode: 'semi', interval: 0.28, reload: 1.9, reloadKind: 'break', reloadStart: 0, shellReload: 0,
    spread: 0.12, aimSpread: 0.095, falloff: [5, 20, 0.15], kickPitch: 0.1, kickBody: 0.16, flash: 1.5, light: 65, eject: -1, sound: 'sawnoff', range: 35, knockback: 5 }),
  shotgun: def(SHOTGUN, { id: 'shotgun', name: 'Breaker 12', icon: 'shotgun', cat: 'shotgun', blurb: 'Pump-action 12 gauge. Devastating up close.', damage: 22, clip: 6, price: 1800 }),
  autoShotgun: def(SHOTGUN, { id: 'autoShotgun', name: 'Tempest Drum', icon: 'shotgun', cat: 'shotgun', blurb: 'Drum-fed automatic shotgun. Clears rooms.', damage: 16, pellets: 8, clip: 12, price: 4800, mode: 'auto', interval: 0.22, reload: 2.6, reloadKind: 'mag', reloadStart: 0, shellReload: 0, emptyReload: 0.3,
    kickPitch: 0.045, kickBody: 0.07, eject: 0, sound: 'autoShotgun', ammoPack: 24, ammoPrice: 140, playerDamage: 2.8 }),
  // ---------------- rifles ----------------
  carbine: def(RIFLE, { id: 'carbine', name: 'Kite Carbine', icon: 'rifle', cat: 'rifle', blurb: 'Short-barrel carbine. Fast handling, 3-round bursts.', damage: 53, clip: 30, price: 3200, mode: 'burst', burst: 3, interval: 0.07, aimSpread: 0.0065, sound: 'carbine', falloff: [40, 120, 0.7] }),
  rifle: def(RIFLE, { id: 'rifle', name: 'Longline AR', icon: 'rifle', cat: 'rifle', blurb: 'Assault rifle. Hard-hitting and laser-accurate aimed.', damage: 55, clip: 30, price: 3900 }),
  battleRifle: def(RIFLE, { id: 'battleRifle', name: 'Granite 308', icon: 'rifle', cat: 'rifle', blurb: 'Full-power battle rifle. Slow, brutal, punches through vests.', damage: 82, clip: 20, price: 5200, interval: 0.15, kickPitch: 0.024, kickYaw: 0.009, kickDrift: 0.003, kickBody: 0.06, shake: 0.18,
    flash: 1.2, light: 44, knockback: 1.6, sound: 'battleRifle', falloff: [60, 200, 0.8], ammoPack: 40, ammoPrice: 150, playerDamage: 15 }),
  marksman: def(SNIPER, { id: 'marksman', name: 'Heron DMR', icon: 'sniper', cat: 'rifle', blurb: 'Semi-auto marksman rifle with a 4x scope.', damage: 110, clip: 10, price: 6500, interval: 0.3, scope: 22, kickPitch: 0.035, sound: 'marksman', ammoPack: 20, ammoPrice: 160, playerDamage: 22 }),
  sniper: def(SNIPER, { id: 'sniper', name: 'Longreach .338', icon: 'sniper', cat: 'rifle', blurb: 'Bolt-action sniper rifle. Variable scope, one shot, one drop.', damage: 260, clip: 5, price: 9000, mode: 'bolt', interval: 1.25, reload: 2.6, emptyReload: 0.5, reloadKind: 'mag', scope: 14,
    kickPitch: 0.08, kickBody: 0.12, kickFlip: 0.22, shake: 0.35, flash: 1.6, light: 70, knockback: 4, eject: 0.6, sound: 'sniper', ammoPack: 10, ammoPrice: 220, playerDamage: 40, recoverRate: 3.5 }),
  // ---------------- heavy ----------------
  lmg: def(RIFLE, { id: 'lmg', name: 'Anvil LMG', icon: 'lmg', cat: 'heavy', blurb: 'Belt-fed light machine gun. 100 rounds of suppression.', damage: 52, clip: 100, price: 8500, interval: 0.085, reload: 4.2, emptyReload: 0, reloadKind: 'belt', spread: 0.065, aimSpread: 0.012, firstShot: 0.5,
    bloom: 0.004, bloomMax: 0.045, movePenalty: 0.04, kickPitch: 0.011, kickYaw: 0.01, kickDrift: 0.003, shake: 0.15, flash: 1.15, light: 40, knockback: 1.4, sound: 'lmg', ammoPack: 100, ammoPrice: 300, playerDamage: 10 }),
  grenadeLauncher: def(RIFLE, { id: 'grenadeLauncher', name: 'Thumper 40', icon: 'launcher', cat: 'heavy', blurb: 'Six-shot 40 mm launcher. Lob it over cover.', damage: 160, clip: 6, price: 12000, mode: 'semi', interval: 0.6, reload: 3.4, emptyReload: 0, reloadKind: 'revolver', projectile: 'grenade40',
    spread: 0.02, aimSpread: 0.006, firstShot: 1, bloom: 0, bloomMax: 0, kickPitch: 0.06, kickBody: 0.1, kickFlip: 0.2, shake: 0.2, flash: 0.8, light: 25, eject: -1, casing: 'none', sound: 'launcher', range: 200, ammoPack: 6, ammoPrice: 400, playerDamage: 60, pierce: false }),
  rpg: def(RIFLE, { id: 'rpg', name: 'Comet RPG', icon: 'rpg', cat: 'heavy', blurb: 'Shoulder-fired rocket. Ends car chases.', damage: 400, clip: 1, price: 18000, mode: 'semi', interval: 1, reload: 2.8, emptyReload: 0, reloadKind: 'single', projectile: 'rocket',
    spread: 0.03, aimSpread: 0.004, firstShot: 1, bloom: 0, bloomMax: 0, kickPitch: 0.05, kickBody: 0.12, kickFlip: 0.08, kickBack: 0.12, shake: 0.4, flash: 1.8, light: 80, eject: -1, casing: 'none', sound: 'rpg', range: 300, ammoPack: 2, ammoPrice: 900, playerDamage: 90, pierce: false }),
  // ---------------- throwables ----------------
  grenade: def(THROW, { id: 'grenade', name: 'Frag Grenade', icon: 'grenade', cat: 'throw', blurb: 'Pull, throw, count to three. Hold to cook.', damage: 170, clip: 1, price: 300, ammoPrice: 260, projectile: 'frag', playerDamage: 60 }),
  molotov: def(THROW, { id: 'molotov', name: 'Molotov', icon: 'molotov', cat: 'throw', blurb: 'Bottle of trouble. Sets the ground on fire.', damage: 30, clip: 1, price: 180, ammoPrice: 150, projectile: 'molotov', playerDamage: 6 }),
};
/** Display order everywhere (wheel, shop, cycling): grouped by category. */
export const WEAPON_ORDER: WeaponId[] = ['fists', 'knife', 'bat', 'compact', 'pistol', 'heavyPistol', 'revolver', 'machinePistol', 'compactSmg', 'smg', 'sawnoff', 'shotgun', 'autoShotgun',
  'carbine', 'rifle', 'battleRifle', 'marksman', 'sniper', 'lmg', 'grenadeLauncher', 'rpg', 'grenade', 'molotov'];
export const isWeaponId = (s: unknown): s is WeaponId => typeof s === 'string' && s in WEAPONS;
export const isThrowable = (w: WeaponDef) => w.cat === 'throw';

/** Damage multiplier at distance d (metres). */
export function falloffAt(w: WeaponDef, d: number): number {
  const [a, b, m] = w.falloff;
  if (d <= a) return 1; if (d >= b) return m;
  return 1 + (m - 1) * (d - a) / (b - a);
}

export interface WeaponState { owned: boolean; clip: number; reserve: number }
const freshStates = () => Object.fromEntries(WEAPON_ORDER.map(id => [id, { owned: id === 'fists', clip: 0, reserve: 0 }])) as Record<WeaponId, WeaponState>;

export class Inventory {
  weapons: Record<WeaponId, WeaponState> = freshStates();
  current: WeaponId = 'fists';
  /** last weapon picked in each wheel category */
  pick: Partial<Record<WeaponCat, WeaponId>> = {};
  medkits = 0;
  cooldown = 0;
  reloadT = 0;
  /** total length of the reload in progress (or of the current shell for shell-by-shell reloads) */
  reloadDur = 0;
  /** increments each time a shell is loaded (shell-by-shell weapons) so callers can play a sound */
  shellsLoaded = 0;
  /** true while the reload in progress started from an empty clip */
  reloadFromEmpty = false;
  /** rounds still to fire in the current burst (burst weapons) */
  burstLeft = 0;
  give(id: WeaponId, ammo: number) {
    const w = this.weapons[id]; if (!w) return;
    const d = WEAPONS[id];
    if (d.melee) { w.owned = true; return; }
    if (!w.owned) { w.owned = true; w.clip = Math.min(d.clip, ammo); ammo -= w.clip; }
    w.reserve += Math.max(0, ammo);
    if (w.clip === 0 && w.reserve > 0 && this.current !== id) { const take = Math.min(d.clip, w.reserve); w.clip += take; w.reserve -= take; }
  }
  get def() { return WEAPONS[this.current]; }
  get state() { return this.weapons[this.current]; }
  /** Rounds left in total (clip + reserve); for throwables the count in the pocket. */
  total(id: WeaponId = this.current) { const w = this.weapons[id]; return w.clip + w.reserve; }
  select(id: WeaponId) {
    const w = this.weapons[id];
    if (w?.owned && this.current !== id && (WEAPONS[id].cat !== 'throw' || this.total(id) > 0)) {
      this.current = id; this.reloadT = 0; this.reloadDur = 0; this.burstLeft = 0; this.cooldown = Math.max(this.cooldown, 0.25);
      this.pick[WEAPONS[id].cat] = id;
      const d = WEAPONS[id]; if (w.clip === 0 && w.reserve > 0 && d.cat === 'throw') { w.clip = 1; w.reserve--; }
      return true;
    }
    return false;
  }
  /** Owned weapons in wheel order (throwables only while you have some). */
  owned(): WeaponId[] { return WEAPON_ORDER.filter(w => this.weapons[w].owned && (WEAPONS[w].cat !== 'throw' || this.total(w) > 0)); }
  cycle(dir: 1 | -1) {
    const owned = this.owned();
    const i = owned.indexOf(this.current);
    this.select(owned[(i + dir + owned.length) % owned.length]);
  }
  /** Owned weapons of one wheel category. */
  inCategory(cat: WeaponCat): WeaponId[] { return this.owned().filter(id => WEAPONS[id].cat === cat); }
  /** The weapon a category slot equips: the last one picked there, else the first owned. */
  categoryPick(cat: WeaponCat): WeaponId | null {
    const list = this.inCategory(cat); if (!list.length) return null;
    const p = this.pick[cat]; return p && list.includes(p) ? p : list[0];
  }
  /** Steps the category's pick to the next/previous owned weapon (wheel scrolling). */
  cycleCategory(cat: WeaponCat, dir: 1 | -1): WeaponId | null {
    const list = this.inCategory(cat); if (!list.length) return null;
    const cur = this.categoryPick(cat)!; const next = list[(list.indexOf(cur) + dir + list.length) % list.length];
    this.pick[cat] = next; return next;
  }
  /** Advances timers. Returns true when a reload just finished. */
  tick(dt: number): boolean {
    // automatic weapons keep up to one frame of overshoot so the cyclic rate doesn't snap to whole frames
    this.cooldown = Math.max(this.def.auto || this.burstLeft > 0 ? -0.034 : 0, this.cooldown - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const w = this.state, d = this.def;
        if (d.shellReload > 0) {
          // one shell in; keep going while there is room and ammo
          if (w.clip < d.clip && w.reserve > 0) { w.clip++; w.reserve--; this.shellsLoaded++; }
          if (w.clip < d.clip && w.reserve > 0) { this.reloadT += d.shellReload; this.reloadDur = d.shellReload; return false; }
          this.reloadT = 0; this.reloadDur = 0; return true;
        }
        this.reloadT = 0; this.reloadDur = 0; const take = Math.min(d.clip - w.clip, w.reserve); w.clip += take; w.reserve -= take; return true;
      }
    }
    return false;
  }
  /** Shell-by-shell reloads can be interrupted by firing once at least one shell is in. */
  private get interruptible() { return this.def.shellReload > 0 && this.reloadT > 0 && this.state.clip > 0; }
  canFire(): boolean { const d = this.def; return this.cooldown <= 0 && (this.reloadT <= 0 || this.interruptible) && (d.melee || this.state.clip > 0); }
  /** Starts a trigger pull for burst weapons (fire() then keeps firing while burstLeft > 0). */
  pull() { if (this.def.mode === 'burst' && this.burstLeft === 0) this.burstLeft = this.def.burst; }
  /** Consumes one shot; returns false if empty. Starts auto-reload when the clip runs out. */
  fire(): boolean {
    if (!this.canFire()) return false;
    const d = this.def;
    if (this.reloadT > 0) { this.reloadT = 0; this.reloadDur = 0; }
    const rapid = d.auto || this.burstLeft > 1;
    this.cooldown = (rapid ? Math.max(-0.034, Math.min(0, this.cooldown)) : 0) + d.interval;
    if (d.mode === 'burst') { this.burstLeft = Math.max(0, this.burstLeft - 1); if (this.burstLeft === 0) this.cooldown += 0.16; }
    if (!d.melee) { this.state.clip--; if (this.state.clip === 0) { this.burstLeft = 0; if (this.state.reserve > 0) this.startReload(); } }
    return true;
  }
  startReload(): boolean {
    const d = this.def, w = this.state;
    if (d.melee || this.reloadT > 0 || w.clip >= d.clip || w.reserve <= 0) return false;
    this.reloadFromEmpty = w.clip === 0; this.burstLeft = 0;
    this.reloadT = d.shellReload > 0 ? d.reloadStart + d.shellReload : d.reload + (w.clip === 0 ? d.emptyReload : 0);
    this.reloadDur = this.reloadT; return true;
  }
  get reloading() { return this.reloadT > 0; }
  /** 0..1 progress through the current reload (or current shell). */
  get reloadProgress() { return this.reloadDur > 0 ? 1 - this.reloadT / this.reloadDur : 0; }
  toJSON() { return { weapons: this.weapons, current: this.current, medkits: this.medkits }; }
  load(d: { weapons?: Partial<Record<string, WeaponState>>; current?: string; medkits?: number }) {
    this.weapons = freshStates();
    if (d.weapons) for (const id of WEAPON_ORDER) { const s = d.weapons[id]; if (s) this.weapons[id] = { owned: !!s.owned, clip: Math.max(0, s.clip | 0), reserve: Math.max(0, s.reserve | 0) }; }
    this.weapons.fists.owned = true;
    if (isWeaponId(d.current) && this.weapons[d.current].owned) this.current = d.current;
    this.medkits = d.medkits ?? 0;
  }
}

export { weaponMesh, MUZZLE, weaponParts, type WeaponParts } from './weaponModels';
