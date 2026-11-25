/**
 * Colour-blind / reduce-motion styling for map blips. Pure and unit tested; mapdraw.drawBlip draws what this returns.
 * Every mode keeps police vs gang vs objective vs shop apart by SHAPE (triangle, square, ring, badge) and by fill pattern
 * (solid vs hollow), never by red/blue alone.
 */
import type { MinimapBlip } from './contracts';
import type { ColorblindMode } from '../core/settings';

type Kind = MinimapBlip['kind'];
export type BlipShape = 'disc' | 'triangle' | 'square';
export interface BlipStyle { color: string; alt: string; shape: BlipShape; /** alternate filled / hollow instead of colour swapping */ hollowFlash: boolean; flashing: boolean }

const BASE: Record<Kind, string> = {
  mission: '#ffc37e', target: '#ff6f5e', checkpoint: '#ffe08a', waypoint: '#ffb066', safehouse: '#e9edf2', shop: '#8fd0a8',
  arms: '#ee9a72', bank: '#e8c15a', barber: '#e3a9c8', clothing: '#b4a8ec', garage: '#8fbbdc', vehicle: '#dfe3e8', collectible: '#f3d9ad', enemy: '#ff5a4e', police: '#6fb6ff',
};
export const BLIP_BASE_COLORS = BASE;
/** Overrides per mode, picked to stay apart in that kind of colour vision (blue / orange / white axis for red-green types, red / cyan for blue-yellow). */
const OVERRIDES: Record<Exclude<ColorblindMode, 'off'>, Partial<Record<Kind, string>>> = {
  deuteranopia: { police: '#4aa8ff', enemy: '#ffb000', target: '#ffb000', shop: '#9fd8ff', mission: '#fff0a8' },
  protanopia: { police: '#58b0ff', enemy: '#ffc400', target: '#ffc400', shop: '#a8dcff', mission: '#fff0a8' },
  tritanopia: { police: '#5ff0ff', enemy: '#ff4d6a', target: '#ff4d6a', shop: '#f6f6f6', mission: '#ffd0e0', garage: '#d6e6ff' },
};

export function blipColor(kind: Kind, mode: ColorblindMode = 'off'): string {
  return (mode !== 'off' && OVERRIDES[mode]?.[kind]) || BASE[kind];
}

/** Style of one blip at time t (seconds). Police flash red/blue at 4 Hz by default; with Reduce Motion they are steady. */
export function blipStyle(kind: Kind, mode: ColorblindMode, reduceMotion: boolean, t: number): BlipStyle {
  const color = blipColor(kind, mode);
  const cb = mode !== 'off';
  if (kind === 'police') {
    const on = Math.floor(t * 4) % 2 === 0;
    if (reduceMotion) return { color, alt: color, shape: cb ? 'triangle' : 'disc', hollowFlash: false, flashing: false };
    return cb
      ? { color, alt: color, shape: 'triangle', hollowFlash: true, flashing: !on }
      : { color: on ? color : BASE.enemy, alt: BASE.enemy, shape: 'disc', hollowFlash: false, flashing: !on };
  }
  if (kind === 'enemy') return { color, alt: color, shape: cb ? 'square' : 'disc', hollowFlash: false, flashing: false };
  return { color, alt: color, shape: 'disc', hollowFlash: false, flashing: false };
}

/** The mode and motion preference the page applied to <html> (ui.ts applyDisplay); safe outside a browser. */
export function pageA11y(): { mode: ColorblindMode; reduceMotion: boolean } {
  try {
    const d = document.documentElement.dataset;
    const m = d.colorblind;
    return { mode: m === 'deuteranopia' || m === 'protanopia' || m === 'tritanopia' ? m : 'off', reduceMotion: d.reduceMotion === 'true' };
  } catch { return { mode: 'off', reduceMotion: false }; }
}
