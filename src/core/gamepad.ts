/** Gamepad (standard mapping): state reading, button -> action map and on-screen glyph labels. Pure apart from the getter. */
import type { Action } from './settings';

export interface PadState { lx: number; ly: number; rx: number; ry: number; lt: number; rt: number; buttons: boolean[]; connected: boolean }
export const EMPTY_PAD: PadState = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: [], connected: false };

/**
 * Standard-mapping button indices: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 L3, 11 R3, 12-15 D-pad up/down/left/right.
 * The default layout is console-action-game style and depends on what the player is doing (on foot, driving, flying).
 */
export type PadContext = 'foot' | 'car' | 'heli';
export interface PadLayout {
  buttons: Partial<Record<Action, number[]>>;
  /** RT fires (on foot). In the car RT is the throttle, so firing needs LB (drive-by); in the heli the guns sit on X. */
  rtFire: 'always' | 'aimOnly' | 'never';
  /** LT aims (on foot). In the car / heli LT is brake / reverse, so aim lives on a button. */
  ltAim: boolean;
}
export const PAD_LAYOUTS: Record<PadContext, PadLayout> = {
  // LS move (click = dodge roll), RS camera (click = look behind), A sprint, X jump, B reload / melee, Y enter vehicle + interact,
  // LT aim, RT fire, LB weapon wheel (hold), RB give orders (hold), D-pad: up map, down interact, left / right previous / next weapon.
  foot: {
    rtFire: 'always', ltAim: true,
    buttons: { sprint: [0], jump: [2], reload: [1], enter: [3], interact: [3, 13], wheel: [4], orders: [5], crouch: [10], lookBehind: [11], map: [8, 12], pause: [9], prevWeapon: [14], nextWeapon: [15] },
  },
  // RT accelerate, LT brake / reverse, LS steer, RB handbrake, LB aim (drive-by, RT fires), B camera, L3 horn, Y exit, X reload,
  // D-pad: left headlights, right radio, up light bar, down siren.
  car: {
    rtFire: 'aimOnly', ltAim: false,
    buttons: { aim: [4], handbrake: [5], camera: [1], horn: [10], enter: [3], reload: [2], lookBehind: [11], map: [8], pause: [9], headlights: [14], radio: [15], lightBar: [12], sirenWail: [13] },
  },
  // RT pitch forward, LT pitch back, LS bank / yaw, RB ascend, LB descend, X chin gun, B missile, Y exit, D-pad up camera.
  heli: {
    rtFire: 'never', ltAim: false,
    buttons: { handbrake: [5], sprint: [4], fire: [2], reload: [1], enter: [3], camera: [12], lookBehind: [11], map: [8], pause: [9], headlights: [14] },
  },
};
/** Legacy name: the on-foot button map. */
export const PAD_MAP = PAD_LAYOUTS.foot.buttons;
let currentCtx: PadContext = 'foot';
export function setPadContext(c: PadContext) { currentCtx = c; }
export function getPadContext(): PadContext { return currentCtx; }
const GLYPHS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→'];
/** Short label for the controller button that triggers an action in a context, or null when it is not on the pad. */
export function padGlyph(a: Action, ctx: PadContext = currentCtx): string | null {
  const lay = PAD_LAYOUTS[ctx];
  if (a === 'fire') return lay.rtFire === 'always' ? 'RT' : lay.rtFire === 'aimOnly' ? 'LB + RT' : lay.buttons.fire ? GLYPHS[lay.buttons.fire[0]] : null;
  if (a === 'aim') return lay.ltAim ? 'LT' : lay.buttons.aim ? GLYPHS[lay.buttons.aim[0]] : null;
  if (a === 'forward') return 'RT';
  if (a === 'back') return 'LT';
  if (a === 'left' || a === 'right') return 'L-Stick';
  const b = lay.buttons[a]?.[0];
  return b === undefined ? null : GLYPHS[b] ?? null;
}
/** Is a binding held / pressed for an action, given the current pad and layout. Pure helper shared by Input and the tests. */
export function padHeld(a: Action, pad: PadState, ctx: PadContext): boolean {
  const lay = PAD_LAYOUTS[ctx];
  if (lay.buttons[a]?.some(b => pad.buttons[b])) return true;
  if (a === 'fire') {
    if (lay.rtFire === 'always') return pad.rt > 0.5;
    if (lay.rtFire === 'aimOnly') return pad.rt > 0.5 && !!pad.buttons[lay.buttons.aim?.[0] ?? 4];
  }
  if (a === 'aim' && lay.ltAim) return pad.lt > 0.5;
  return false;
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

// ---- prompt glyphs: on a controller, every "E  Do the thing" prompt shows the pad button for that action instead ----
let promptSrc: 'kbm' | 'pad' = 'kbm';
export function setPromptSource(s: 'kbm' | 'pad') { promptSrc = s; }
export function promptSource(): 'kbm' | 'pad' { return promptSrc; }
const PROMPT_FIRST: Action[] = ['interact', 'enter', 'orders', 'reload', 'jump', 'crouch', 'map', 'wheel'];
function capOf(code: string): string { return code.replace(/^Key/, '').replace(/^Digit/, '').toUpperCase(); }
/** The cap for a prompt's key: the keyboard label as given, or (playing on a pad) the button bound to the same action. */
export function promptCap(label: string, bindings: Partial<Record<Action, string[]>>, ctx: PadContext = currentCtx): string {
  if (promptSrc !== 'pad') return label;
  const want = label.toUpperCase();
  const order = [...PROMPT_FIRST, ...(Object.keys(bindings) as Action[]).filter(a => !PROMPT_FIRST.includes(a))];
  for (const a of order) for (const c of bindings[a] ?? []) if (c && capOf(c) === want) { const g = padGlyph(a, ctx); if (g) return g; }
  return label;
}
/** Rewrites "E  Enter the car" (key cap, two spaces, text) for the current input device. */
export function promptFor(prompt: string | null, bindings: Partial<Record<Action, string[]>>): string | null {
  if (!prompt || promptSrc !== 'pad') return prompt;
  const m = /^(\S{1,12})(\s{2,}.+)$/.exec(prompt);
  return m ? promptCap(m[1], bindings) + m[2] : prompt;
}
