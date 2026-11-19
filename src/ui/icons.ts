/** Hand-drawn SVG icons for weapons, items, heat flares and map legend. All original artwork. */
import * as THREE from 'three';
import type { MinimapBlip, WeaponIcon } from './contracts';
import type { WeaponId } from '../combat/weapons';
import { weaponMesh } from '../combat/weaponModels';

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
  knife:
    'M5 15.2L35 12H39.5V20H35L9 18.6Z' + rr(40, 11.2, 19, 9.6, 3) + 'M38.6 10H40V22H38.6Z',
  bat:
    rr(2, 12.6, 4.4, 7, 2) + 'M7 13.6L38 11.2Q57 9.4 61 11.6Q62.5 12.5 62.5 16Q62.5 19.5 61 20.4Q57 22.6 38 20.8L7 18.4Z',
  revolver:
    'M10 9.5H29V8.5H40V10H48.5V8.5H50.5V13.6H40V17H32.5L30.6 19Q29 20.2 27 19.8L24.8 28H15.4L20 16.6Q17.5 16.4 16.6 14.6H10Z',
  sniper:
    'M2 14.2L16 12.6V11.4H40V12.6H63V14.6H40V17H31Q32 22 30 27H25Q26 22 24.6 17H18L2 19.6Z' + 'M21 4.6H41V9.4H21Z' + 'M25.5 9.4h2.4v2h-2.4zM34.5 9.4h2.4v2h-2.4z',
  lmg:
    'M3 10.4L16 9H49V11.4H62V13.4H49V16H37V25H26V16H18L3 18Z' + 'M52 13.4H54L57.5 27H55.6Z' + 'M20 6.4H34V9H20Z',
  launcher:
    'M4 13.4L16 11.4H23V7.6H44V11.4H58V16.6H44V21.4H23V18H20.6L18.4 26H13.4L15.6 18L4 19.4Z',
  rpg:
    'M2 12.6H47V17.4H2Z' + 'M47 10L55 10.6Q63 13 63 15Q63 17 55 19.4L47 20Z' + 'M19.5 17.4H23.5L22 25H18Z' + 'M31 17.4H35L33.5 25H29.5Z' + 'M9 8.6H15V12.6H9Z',
  grenade:
    'M23 19A9 9 0 1 0 41 19A9 9 0 1 0 23 19Z' + 'M27 9.2L28.6 6.4H37.4L42 9.6L40.6 10.6L37 8.2H35V9.6Z' + 'M18 6A3 3 0 1 0 24 6A3 3 0 1 0 18 6ZM19.4 6A1.6 1.6 0 1 1 22.6 6A1.6 1.6 0 1 1 19.4 6Z',
  molotov:
    'M27 12.4H37V14.6Q41.4 16.6 41.4 21V28Q41.4 29.6 39.8 29.6H24.2Q22.6 29.6 22.6 28V21Q22.6 16.6 27 14.6Z' + 'M29.4 5H34.6V12.4H29.4Z' + 'M30 4.4Q29 2 31 0.4Q31 2.4 33 2.4Q32.4 0.8 34.6 0Q35.6 2.6 34 4.4Z',
  medkit:
    'M22.4 8H41.6Q44 8 44 10.4V24.6Q44 27 41.6 27H22.4Q20 27 20 24.6V10.4Q20 8 22.4 8Z' +
    'M29.8 11.5H34.2V15.3H38V19.7H34.2V23.5H29.8V19.7H26V15.3H29.8Z' +
    'M27 8V5.2Q27 3.6 28.6 3.6H35.4Q37 3.6 37 5.2V8H35V5.6H29V8Z',
  armor:
    'M24 4H29Q30.2 8.4 32 8.4Q33.8 8.4 35 4H40L45 9V26Q45 28.5 42.5 28.5H21.5Q19 28.5 19 26V9Z' +
    'M31.4 10h1.2v18.5h-1.2zM19 18h26v1.2H19z',
};

/** Pre-rendered shaded side profiles of the real 3D weapon models (data URLs), filled by renderWeaponIcons(). */
const RENDERED = new Map<WeaponIcon, string>();
export function weaponIconUrl(icon: WeaponIcon): string | null { return RENDERED.get(icon) ?? null; }
export function weaponSvg(icon: WeaponIcon, cls = 'ma-icon'): string {
  const url = RENDERED.get(icon);
  if (url) return `<img class="${cls} ma-wicon" src="${url}" alt="" draggable="false">`;
  const d = WEAPON_PATHS[icon] ?? WEAPON_PATHS.fists;
  return `<svg class="${cls}" viewBox="0 0 64 32" aria-hidden="true"><path fill-rule="evenodd" fill="currentColor" d="${d}"/></svg>`;
}

/** Heat emblem: an original rooftop beacon (dome light on a bar with three rays). Deliberately not a star. */
/** Wanted level star: a classic five-point star with a heavy outline (drawn here, original). */
export const STAR_SVG = '<svg class="ma-star-svg" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path class="ma-star-fill" d="M12 1.6l3.05 6.6 7.2.8-5.37 4.9 1.5 7.1L12 17.4 5.62 21l1.5-7.1L1.75 9l7.2-.8z"/></svg>';
export const FLARE_SVG = '<svg class="ma-flare-svg" viewBox="-2 -2 28 28" aria-hidden="true">' +
  '<path class="ma-flare-ray" d="M12 1.2V4.4M3.6 4.6L5.9 6.9M20.4 4.6L18.1 6.9"/>' +
  '<path class="ma-flare-fill" d="M5.6 15.6V13.2A6.4 6.4 0 0 1 18.4 13.2V15.6ZM3.2 17.4H20.8V21.6H3.2Z"/></svg>';

/** Small inline glyphs used across menus. */
export const CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M3 8.5L6.5 12L13 4.5"/></svg>';
export const LOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 0 0-4 0z"/></svg>';
export const WRENCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.8 2.6a5.4 5.4 0 0 0-5.3 7L3.4 17.7a2.1 2.1 0 0 0 3 3l8.1-8.1a5.4 5.4 0 0 0 7-5.3l-3.2 3.2-2.9-.6-.6-2.9z"/></svg>';

/** Guesses a weapon/item icon for a shop item id or label (falls back to null). */
export function guessIcon(text: string): WeaponIcon | null {
  const t = text.toLowerCase();
  for (const k of ['revolver', 'sniper', 'lmg', 'launcher', 'rpg', 'grenade', 'molotov', 'knife', 'bat', 'pistol', 'smg', 'shotgun', 'rifle', 'medkit', 'armor'] as WeaponIcon[]) if (t.includes(k)) return k;
  if (t.includes('vest') || t.includes('kevlar') || t.includes('armour')) return 'armor';
  if (t.includes('med') || t.includes('health') || t.includes('first aid')) return 'medkit';
  return null;
}

/** Map legend (sandbox: no mission, target or checkpoint markers). */
export const BLIP_KINDS: MinimapBlip['kind'][] = ['waypoint', 'safehouse', 'shop', 'arms', 'garage', 'vehicle', 'collectible', 'enemy', 'police'];
export const BLIP_LABELS: Record<MinimapBlip['kind'], string> = {
  mission: 'Job', target: 'Target', checkpoint: 'Checkpoint', waypoint: 'Waypoint', safehouse: 'Safehouse', shop: 'Store',
  arms: 'Arms dealer', garage: 'Garage', vehicle: 'Vehicle', collectible: 'Postcard', enemy: 'Hostile', police: 'Patrol',
};

/** Weapon whose model stands in for each icon (fists / medkit / armor keep their drawn glyphs). */
export const ICON_MODEL: Partial<Record<WeaponIcon, WeaponId>> = {
  pistol: 'pistol', revolver: 'revolver', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', sniper: 'sniper', lmg: 'lmg',
  launcher: 'grenadeLauncher', rpg: 'rpg', grenade: 'grenade', molotov: 'molotov', knife: 'knife', bat: 'bat',
};
/**
 * Renders each weapon's 3D model once, side-on, into a small transparent image. Call once at startup; HUD, wheel and shop
 * pick the images up through weaponSvg() / weaponIconUrl(). Returns the number of icons made (0 when WebGL is missing).
 */
export function renderWeaponIcons(w = 384, hgt = 160): number {
  if (RENDERED.size || typeof document === 'undefined') return RENDERED.size;
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w, hgt, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeef3fa, 0x5a554e, 1.9));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.6); key.position.set(-3, 4, -2); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.4); rim.position.set(3, 1, 3); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8); fill.position.set(-2, -1, 3); scene.add(fill);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
    const lifted = new Map<THREE.Material, { metalness: number; roughness: number; color: THREE.Color }>();
    const pale = new THREE.Color('#c9ced6');
    for (const [icon, id] of Object.entries(ICON_MODEL) as [WeaponIcon, WeaponId][]) {
      const m = weaponMesh(id);
      // Metals look black without an environment map: soften them so the lights read the form.
      m.traverse(o => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (mat && 'metalness' in mat && !lifted.has(mat)) { lifted.set(mat, { metalness: mat.metalness, roughness: mat.roughness, color: mat.color.clone() }); mat.metalness = Math.min(mat.metalness, 0.2); mat.roughness = Math.max(mat.roughness, 0.45); mat.color.lerp(pale, 0.5); }
      });
      scene.add(m);
      const box = new THREE.Box3().setFromObject(m);
      const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      const spanX = Math.max(sz.z, 0.001) * 1.06, spanY = Math.max(sz.y, 0.001) * 1.06;
      const aspect = w / hgt;
      let hw = spanX / 2, hh = hw / aspect;
      if (hh < spanY / 2) { hh = spanY / 2; hw = hh * aspect; }
      cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh; cam.updateProjectionMatrix();
      cam.position.set(c.x - 5, c.y, c.z); cam.up.set(0, 1, 0); cam.lookAt(c);
      renderer.render(scene, cam);
      RENDERED.set(icon, canvas.toDataURL('image/png'));
      scene.remove(m);
    }
    for (const [mat, v] of lifted) { (mat as THREE.MeshStandardMaterial).metalness = v.metalness; (mat as THREE.MeshStandardMaterial).roughness = v.roughness; (mat as THREE.MeshStandardMaterial).color.copy(v.color); }
  } catch { /* no WebGL: the drawn glyphs stay */ }
  finally { renderer?.dispose(); renderer?.forceContextLoss(); }
  return RENDERED.size;
}
