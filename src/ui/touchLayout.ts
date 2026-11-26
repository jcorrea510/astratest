/** Touch controls: pure layout + maths (no DOM), so it is unit-tested. The DOM side is touch.ts. */
import type { Action } from '../core/settings';

export type TouchContext = 'foot' | 'car' | 'heli';
/** hold = down while the finger is on it; toggle = tap on / tap off (aim, sprint). */
export type TouchKind = 'hold' | 'toggle';
export interface TouchButton {
  id: string; action: Action; label: string; icon: string; kind: TouchKind;
  /** size in --u units (1 u = 1 px at 1280x720; never drawn below 44 CSS px) */
  size: number;
  /** offset from the right edge / bottom edge, in --u units (before the safe-area inset) */
  right: number; bottom: number;
  /** also drag-to-look while held (fire, aim) */
  look?: boolean;
  /** hold-to-open wheel: the drag steers the selection */
  wheel?: boolean;
}
export const MIN_TARGET_PX = 44;

/** Pure: which control set to show. */
export function touchContext(s: { heli: boolean; vehicle: boolean }): TouchContext { return s.heli ? 'heli' : s.vehicle ? 'car' : 'foot'; }

const B = (id: string, action: Action, label: string, icon: string, size: number, right: number, bottom: number, extra: Partial<TouchButton> = {}): TouchButton =>
  ({ id, action, label, icon, kind: 'hold', size, right, bottom, ...extra });

/*
 * Right-thumb cluster. The big action button sits in the corner, the rest fan out above and to its left in an arc.
 * Everything stays right of the left-thumb stick zone and below the money / weapon / stars block at the top right.
 */
export const LAYOUTS: Record<TouchContext, TouchButton[]> = {
  foot: [
    B('fire', 'fire', 'FIRE', 'fire', 104, 34, 40, { look: true }),
    B('aim', 'aim', 'AIM', 'aim', 76, 152, 108, { kind: 'toggle', look: true }),
    B('jump', 'jump', 'JUMP', 'jump', 76, 34, 160),
    B('sprint', 'sprint', 'RUN', 'run', 66, 150, 206, { kind: 'toggle' }),
    B('enter', 'enter', 'CAR', 'car', 66, 254, 40),
    B('interact', 'interact', 'USE', 'use', 66, 262, 128),
    B('reload', 'reload', 'RELOAD', 'reload', 58, 34, 256),
    B('crouch', 'crouch', 'ROLL', 'roll', 58, 232, 214),
    B('wheel', 'wheel', 'ARMS', 'wheel', 58, 112, 288, { wheel: true }),
  ],
  car: [
    B('gas', 'forward', 'GAS', 'gas', 104, 34, 40),
    B('brake', 'back', 'BRAKE', 'brake', 84, 156, 40),
    B('handbrake', 'handbrake', 'HAND', 'hand', 66, 34, 160),
    B('exit', 'enter', 'EXIT', 'car', 66, 262, 40),
    B('horn', 'horn', 'HORN', 'horn', 58, 124, 148),
    B('fire', 'fire', 'SHOOT', 'fire', 66, 200, 148, { look: true }),
    B('radio', 'radio', 'RADIO', 'radio', 58, 34, 238),
    B('cam', 'camera', 'CAM', 'cam', 58, 110, 238),
    B('wheel', 'wheel', 'ARMS', 'wheel', 58, 186, 238, { wheel: true }),
  ],
  heli: [
    B('up', 'handbrake', 'UP', 'up', 96, 34, 120),
    B('down', 'sprint', 'DOWN', 'down', 96, 34, 14),
    B('pitch', 'forward', 'FWD', 'gas', 76, 152, 90),
    B('rev', 'back', 'BACK', 'brake', 66, 152, 14),
    B('exit', 'enter', 'EXIT', 'car', 66, 254, 40),
  ],
};
/** Pause + map sit top-left, away from the money / weapon / stars at top-right. */
export const TOP_BUTTONS: TouchButton[] = [
  B('pause', 'pause', 'PAUSE', 'pause', 46, 0, 0),
  B('map', 'map', 'MAP', 'map', 46, 0, 0),
];

/** Rendered size in CSS px for a --u of `u` px. */
export function pxSize(size: number, u: number): number { return Math.max(MIN_TARGET_PX, size * u); }
/** --u as ui.css defines it (1 px at 1280x720, scaling with the viewport, times the player's UI scale). */
export function uFor(w: number, h: number, scale = 1): number { return Math.max(0.72, Math.min(h / 720, w / 1280)) * scale; }

/** Floating stick: finger offset from where it landed -> axes in [-1, 1] (x right, y forward) with a dead zone and full deflection at `radius`. */
export function stickAxes(dx: number, dy: number, radius: number, dead = 0.14): { x: number; y: number; mag: number } {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: 0, mag: 0 };
  const m = Math.min(1, len / radius);
  if (m < dead) return { x: 0, y: 0, mag: 0 };
  const mag = (m - dead) / (1 - dead); // 0 at the dead-zone edge, 1 at full deflection
  const x = dx / len * mag, y = -dy / len * mag;
  return { x, y, mag };
}
/** Pushing the stick past this (fraction of full) while on foot latches sprint, like the run button. */
export const STICK_SPRINT = 0.97;
/** Look gain from finger pixels to "mouse pixels" (the game applies the sensitivity setting after). */
export const LOOK_GAIN = 1.5;
/** Axes handed to the game in a given context: a car steers with x only (the pedals do the speed). */
export function axesFor(ctx: TouchContext, a: { x: number; y: number }): { x: number; y: number } {
  return ctx === 'car' ? { x: a.x, y: 0 } : a;
}
