/** Gamepad (standard mapping): state reading, button -> action map and on-screen glyph labels. Pure apart from the getter. */
import type { Action } from './settings';

export interface PadState { lx: number; ly: number; rx: number; ry: number; lt: number; rt: number; buttons: boolean[]; connected: boolean }
export const EMPTY_PAD: PadState = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: [], connected: false };

/** Standard-mapping button indices: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3, 12-15 D-pad. Fire / aim are the triggers. */
export const PAD_MAP: Partial<Record<Action, number[]>> = {
  jump: [1], enter: [3], reload: [2], sprint: [0], crouch: [10], wheel: [4], handbrake: [0], horn: [10], lookBehind: [11], map: [8], pause: [9], interact: [2], nextWeapon: [5], prevWeapon: [], headlights: [13], radio: [12], camera: [15],
};
const GLYPHS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→'];
/** Short label for the controller button that triggers an action, or null when it is not on the pad. */
export function padGlyph(a: Action): string | null {
  if (a === 'fire') return 'RT';
  if (a === 'aim') return 'LT';
  if (a === 'forward') return 'RT';
  if (a === 'back') return 'LT';
  if (a === 'left' || a === 'right') return 'L-Stick';
  const b = PAD_MAP[a]?.[0];
  return b === undefined ? null : GLYPHS[b] ?? null;
}

/** Radial-ish deadzone with rescale so the stick starts from 0 at the edge of the dead area. */
export function deadzone(v: number, dz = 0.12): number {
  const a = Math.abs(v);
  return a < dz ? 0 : Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

type PadSource = () => ArrayLike<Gamepad | null> | null | undefined;
/** Reads the first connected pad. Safari on iPad exposes the same Gamepad API once a controller is paired. */
export function readPad(getPads: PadSource = () => navigator.getGamepads?.()): PadState {
  let gp: Gamepad | null = null;
  try { const pads = getPads(); if (pads) for (let i = 0; i < pads.length; i++) { const p = pads[i]; if (p && p.connected) { gp = p; break; } } } catch { /* blocked by permissions policy */ }
  if (!gp) return { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: [], connected: false };
  const ax = (i: number) => { const v = gp.axes[i]; return Number.isFinite(v) ? v : 0; };
  return {
    connected: true,
    lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3),
    buttons: gp.buttons.map(b => b.pressed),
    lt: gp.buttons[6]?.value ?? 0, rt: gp.buttons[7]?.value ?? 0,
  };
}
export function padActive(p: PadState): boolean {
  return p.buttons.some(Boolean) || Math.abs(p.lx) + Math.abs(p.ly) > 0.3 || Math.abs(p.rx) + Math.abs(p.ry) > 0.3 || p.lt > 0.3 || p.rt > 0.3;
}
