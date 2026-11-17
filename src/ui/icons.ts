/** Hand-drawn SVG icons for weapons, items, heat flares and map legend. All original artwork. */
import type { MinimapBlip, WeaponIcon } from './contracts';

/** Rounded rectangle as an SVG path (corner radius r). */
function rr(x: number, y: number, w: number, hgt: number, r: number): string {
  return `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + hgt - r}Q${x + w} ${y + hgt} ${x + w - r} ${y + hgt}` +
    `H${x + r}Q${x} ${y + hgt} ${x} ${y + hgt - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}

/** Weapon/item silhouettes in a 64 x 32 box, filled with currentColor (evenodd for cut-outs). */
export const WEAPON_PATHS: Record<WeaponIcon, string> = {
  // A clenched fist seen from the front: four knuckles, a thumb across, the back of the hand below.
  fists:
    rr(20, 2.5, 6.2, 12, 3) + rr(26.9, 1.5, 6.2, 13, 3) + rr(33.8, 2, 6.2, 12.5, 3) + rr(40.7, 4, 5.8, 10.5, 2.9) +
    rr(19, 15.4, 19.5, 5.6, 2.8) +
    'M19 21.8H46.5V24.5Q46.5 29.5 41.5 29.5H24Q19 29.5 19 24.5Z' + rr(39.3, 15.4, 7.2, 5.6, 2.2),
  pistol:
    'M14 8H49L51.5 9.6V14H33.2L31.6 17.6Q30.2 19.6 27.6 19.2L26.1 18.9L23.6 28H13L17.2 14H14Z' +
    'M27.1 14.7H30.8L30 16.7Q29.4 17.8 28.1 17.6L26.6 17.3Z' +
    'M17.2 9.6h1.1v3h-1.1zM19.6 9.6h1.1v3h-1.1zM22 9.6h1.1v3h-1.1z',
  smg:
    'M14 9H48V10.6H58.5V13.6H48V16H36.2L35.2 28H30.2L31.1 16H27.4L25.6 25.5H19.8L21.6 16H14Z' +
    'M4 10H14V12.2H7.2V18H4Z' +
    'M18.5 7.4H31V9H18.5Z',
  shotgun:
    'M2 13.5L16 9H62V12H48V15.6H32V16.6H26.6L25 19.8H22L22.6 16.6H17.2L6.6 21.8H2Z' +
    'M34.2 13h1.1v1.6h-1.1zM37.2 13h1.1v1.6h-1.1zM40.2 13h1.1v1.6h-1.1zM43.2 13h1.1v1.6h-1.1z',
  rifle:
    'M3 9.6L18 8V6H31V8H34V9.6H46V11H62V13H46V15H34V16Q36 22 34.6 28H29.6Q31 22 29.4 16H25.6L23.6 25H18.6L20.4 16H18L3 17.6Z' +
    'M37 11.2h7v1.2h-7z',
  medkit:
    'M22.4 8H41.6Q44 8 44 10.4V24.6Q44 27 41.6 27H22.4Q20 27 20 24.6V10.4Q20 8 22.4 8Z' +
    'M29.8 11.5H34.2V15.3H38V19.7H34.2V23.5H29.8V19.7H26V15.3H29.8Z' +
    'M27 8V5.2Q27 3.6 28.6 3.6H35.4Q37 3.6 37 5.2V8H35V5.6H29V8Z',
  armor:
    'M24 4H29Q30.2 8.4 32 8.4Q33.8 8.4 35 4H40L45 9V26Q45 28.5 42.5 28.5H21.5Q19 28.5 19 26V9Z' +
    'M31.4 10h1.2v18.5h-1.2zM19 18h26v1.2H19z',
};

export function weaponSvg(icon: WeaponIcon, cls = 'ma-icon'): string {
  const d = WEAPON_PATHS[icon] ?? WEAPON_PATHS.fists;
  return `<svg class="${cls}" viewBox="0 0 64 32" aria-hidden="true"><path fill-rule="evenodd" fill="currentColor" d="${d}"/></svg>`;
}

/** Heat "flare": an original rank chevron with a spark above it (deliberately not a star). */
export const FLARE_SVG = '<svg class="ma-flare-svg" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path class="ma-flare-fill" d="M3 15.5L12 7.5L21 15.5V20.5L12 12.5L3 20.5Z"/>' +
  '<path class="ma-flare-fill" d="M12 0.8L14.2 3.6L12 6.4L9.8 3.6Z"/></svg>';

export const BLIP_KINDS: MinimapBlip['kind'][] = ['mission', 'target', 'checkpoint', 'waypoint', 'safehouse', 'shop', 'arms', 'garage', 'vehicle', 'collectible', 'enemy', 'police'];
export const BLIP_LABELS: Record<MinimapBlip['kind'], string> = {
  mission: 'Job', target: 'Target', checkpoint: 'Checkpoint', waypoint: 'Waypoint', safehouse: 'Safehouse', shop: 'Store',
  arms: 'Arms dealer', garage: 'Garage', vehicle: 'Vehicle', collectible: 'Postcard', enemy: 'Hostile', police: 'Patrol',
};
