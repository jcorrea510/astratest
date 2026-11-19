/** Pure helpers for key bindings: grouping, context-aware conflict detection and edits. */
import { ACTION_LABELS, DEFAULT_BINDINGS, type Action } from '../core/settings';

/** Where an action is used. Two actions may share a key when they never apply at the same time. */
export type ActionContext = 'foot' | 'vehicle' | 'both';
export const ACTION_CONTEXT: Record<Action, ActionContext> = {
  forward: 'both', back: 'both', left: 'both', right: 'both',
  sprint: 'foot', jump: 'foot', crouch: 'foot',
  enter: 'both', fire: 'both', aim: 'both', reload: 'both', wheel: 'both', nextWeapon: 'both', prevWeapon: 'both',
  handbrake: 'vehicle', horn: 'vehicle', lookBehind: 'vehicle', headlights: 'vehicle', radio: 'vehicle',
  sirenWail: 'vehicle', sirenYelp: 'vehicle', sirenPhaser: 'vehicle', lightBar: 'vehicle',
  map: 'both', pause: 'both', interact: 'both', camera: 'both',
};

export const ACTION_GROUPS: { title: string; actions: Action[] }[] = [
  { title: 'On foot', actions: ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'crouch', 'interact'] },
  { title: 'Combat', actions: ['fire', 'aim', 'reload', 'wheel', 'nextWeapon', 'prevWeapon'] },
  { title: 'Driving', actions: ['enter', 'handbrake', 'horn', 'lookBehind', 'headlights', 'radio', 'lightBar', 'sirenWail', 'sirenYelp', 'sirenPhaser'] },
  { title: 'General', actions: ['map', 'camera', 'pause'] },
];

export const ALL_ACTIONS = Object.keys(ACTION_LABELS) as Action[];

function contextsOverlap(a: ActionContext, b: ActionContext) {
  return a === 'both' || b === 'both' || a === b;
}

/** Returns every key code bound to two or more actions that can be active at the same time. */
export function findConflicts(bindings: Record<Action, string[]>): Map<string, Action[]> {
  const byCode = new Map<string, Action[]>();
  for (const a of ALL_ACTIONS) for (const code of new Set(bindings[a] ?? [])) {
    const list = byCode.get(code);
    if (list) list.push(a); else byCode.set(code, [a]);
  }
  const out = new Map<string, Action[]>();
  for (const [code, actions] of byCode) {
    if (actions.length < 2) continue;
    const clashing = actions.filter(a => actions.some(b => b !== a && contextsOverlap(ACTION_CONTEXT[a], ACTION_CONTEXT[b])));
    if (clashing.length >= 2) out.set(code, clashing);
  }
  return out;
}

/** Set of "action|code" pairs that are in conflict, for highlighting individual key slots. */
export function conflictSlots(bindings: Record<Action, string[]>): Set<string> {
  const s = new Set<string>();
  for (const [code, actions] of findConflicts(bindings)) for (const a of actions) s.add(`${a}|${code}`);
  return s;
}

/** Returns a new bindings record with `code` placed into `slot` (0 primary, 1 secondary) of `action`; null clears the slot. */
export function withBinding(bindings: Record<Action, string[]>, action: Action, slot: number, code: string | null): Record<Action, string[]> {
  const next = structuredClone(bindings);
  const list = [...(next[action] ?? [])];
  if (code === null) {
    if (slot < list.length) list.splice(slot, 1);
  } else {
    const existing = list.indexOf(code);
    if (existing >= 0 && existing !== slot) list.splice(existing, 1);
    if (slot >= list.length) list.push(code); else list[slot] = code;
  }
  next[action] = list.slice(0, 2);
  return next;
}

export function defaultBindings(): Record<Action, string[]> { return structuredClone(DEFAULT_BINDINGS); }
