/** Rebindable gamepad buttons: per-context overrides of the default PAD_LAYOUTS. Pure storage / editing helpers; the settings panel and Input use them. */
import type { Action } from './settings';
import type { PadContext } from './gamepad';

export type PadOverrides = Partial<Record<PadContext, Partial<Record<Action, number[]>>>>;
export const PAD_CONTEXTS: PadContext[] = ['foot', 'car', 'heli'];
export const PAD_CONTEXT_LABEL: Record<PadContext, string> = { foot: 'On foot', car: 'In a vehicle', heli: 'Helicopter' };
/** Actions the player can move to another button. Sticks, triggers (analog fire / aim / throttle) and menu buttons are fixed. */
export const PAD_BINDABLE: Record<PadContext, Action[]> = {
  foot: ['sprint', 'jump', 'reload', 'enter', 'interact', 'wheel', 'orders', 'crouch', 'lookBehind', 'map', 'pause', 'prevWeapon', 'nextWeapon'],
  car: ['aim', 'handbrake', 'camera', 'horn', 'enter', 'reload', 'lookBehind', 'map', 'pause', 'headlights', 'radio', 'lightBar', 'sirenWail'],
  heli: ['handbrake', 'sprint', 'fire', 'reload', 'enter', 'camera', 'lookBehind', 'map', 'pause', 'headlights'],
};
export const PAD_BUTTON_COUNT = 16;
type Buttons = Partial<Record<Action, number[]>>;

/** Defaults with the overrides laid on top (an override replaces that action's whole list; an empty list leaves it unbound). */
export function mergedButtons(base: Buttons, o: Buttons | undefined): Buttons {
  const out: Buttons = { ...base };
  if (o) for (const a of Object.keys(o) as Action[]) { const v = o[a]; if (v) out[a] = [...v]; }
  return out;
}

/** Cleans untrusted saved data: only known contexts / actions, integer buttons 0..15, at most 3 per action; Pause always keeps a button. */
export function sanitizePadBindings(raw: unknown): PadOverrides {
  const out: PadOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const ctx of PAD_CONTEXTS) {
    const c = (raw as Record<string, unknown>)[ctx];
    if (!c || typeof c !== 'object') continue;
    for (const a of PAD_BINDABLE[ctx]) {
      const v = (c as Record<string, unknown>)[a];
      if (!Array.isArray(v)) continue;
      const list = [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < PAD_BUTTON_COUNT))].slice(0, 3);
      if (!list.length && a === 'pause') continue;
      (out[ctx] ??= {})[a] = list;
    }
  }
  return out;
}

export interface PadBindResult { overrides: PadOverrides; /** actions that lost the button to the new owner */ displaced: Action[] }
/**
 * Binds `button` as the only button of `action` in `ctx`. Any other action of that context holding the button loses it.
 * Returns null when that would leave Pause without a button.
 */
export function withPadBinding(base: Buttons, o: PadOverrides, ctx: PadContext, action: Action, button: number): PadBindResult | null {
  const cur = mergedButtons(base, o[ctx]);
  const next: PadOverrides = structuredClone(o);
  const ctxO = (next[ctx] ??= {});
  const displaced: Action[] = [];
  for (const a of PAD_BINDABLE[ctx]) {
    if (a === action) continue;
    const list = cur[a];
    if (!list?.includes(button)) continue;
    const rest = list.filter(b => b !== button);
    if (!rest.length && a === 'pause') return null;
    ctxO[a] = rest; displaced.push(a);
  }
  ctxO[action] = [button];
  return { overrides: next, displaced };
}

export function resetPadContext(o: PadOverrides, ctx: PadContext): PadOverrides { const n = structuredClone(o); delete n[ctx]; return n; }
export function hasPadOverrides(o: PadOverrides): boolean { return PAD_CONTEXTS.some(c => o[c] && Object.keys(o[c]!).length > 0); }
