/** Controls help: keyboard & mouse (from live bindings) and gamepad columns. */
import { ACTION_LABELS, keyLabel, type Action, type Settings } from '../core/settings';
import { padGlyphAll, currentPadFamily, type PadContext } from '../core/gamepad';
import { familyLabel, localizeGlyph } from '../core/padGlyphs';
import { ACTION_GROUPS } from './bindings';
import { backButton, button, h } from './dom';

/** Gamepad layout as implemented by PAD_LAYOUTS in src/core/gamepad.ts (standard mapping, console-action-game style). */
export const PAD_HELP: { label: string; buttons: string[]; ctx?: PadContext; acts?: Action[]; extra?: string[] }[] = [
  { label: 'ON FOOT', buttons: [] },
  { label: 'Move (click: dodge roll)', buttons: ['L-Stick'] },
  { label: 'Camera (click: look behind)', buttons: ['R-Stick'] },
  { label: 'Aim / Fire', buttons: ['LT', 'RT'] },
  { label: 'Sprint / Jump', buttons: ['A', 'X'], ctx: 'foot', acts: ['sprint', 'jump'] },
  { label: 'Reload / melee', buttons: ['B'], ctx: 'foot', acts: ['reload'] },
  { label: 'Enter vehicle / Interact', buttons: ['Y'], ctx: 'foot', acts: ['enter', 'interact'] },
  { label: 'Weapon wheel (hold)', buttons: ['LB'], ctx: 'foot', acts: ['wheel'] },
  { label: 'Give orders (hold)', buttons: ['RB'], ctx: 'foot', acts: ['orders'] },
  { label: 'Prev / next weapon', buttons: ['D-Pad ←', 'D-Pad →'], ctx: 'foot', acts: ['prevWeapon', 'nextWeapon'] },
  { label: 'City map / Interact', buttons: ['D-Pad ↑', 'D-Pad ↓'], ctx: 'foot', acts: ['map', 'interact'] },
  { label: 'IN A VEHICLE', buttons: [] },
  { label: 'Accelerate / Brake & reverse', buttons: ['RT', 'LT'] },
  { label: 'Steer / Camera', buttons: ['L-Stick', 'R-Stick'] },
  { label: 'Handbrake', buttons: ['RB'], ctx: 'car', acts: ['handbrake'] },
  { label: 'Drive-by: aim (hold) + fire', buttons: ['LB', 'RT'], ctx: 'car', acts: ['aim'], extra: ['RT'] },
  { label: 'Horn / Look behind', buttons: ['L3', 'R3'], ctx: 'car', acts: ['horn', 'lookBehind'] },
  { label: 'Change camera / Exit', buttons: ['B', 'Y'], ctx: 'car', acts: ['camera', 'enter'] },
  { label: 'Headlights / Radio', buttons: ['D-Pad ←', 'D-Pad →'], ctx: 'car', acts: ['headlights', 'radio'] },
  { label: 'Light bar / Siren', buttons: ['D-Pad ↑', 'D-Pad ↓'], ctx: 'car', acts: ['lightBar', 'sirenWail'] },
  { label: 'HELICOPTER', buttons: [] },
  { label: 'Pitch fwd / back', buttons: ['RT', 'LT'] },
  { label: 'Bank + yaw', buttons: ['L-Stick'] },
  { label: 'Climb / Descend', buttons: ['RB', 'LB'], ctx: 'heli', acts: ['handbrake', 'sprint'] },
  { label: 'Chin gun / Missile', buttons: ['X', 'B'], ctx: 'heli', acts: ['fire', 'reload'] },
  { label: 'Exit / Camera', buttons: ['Y', 'D-Pad ↑'], ctx: 'heli', acts: ['enter', 'camera'] },
  { label: 'MENUS', buttons: [] },
  { label: 'Navigate', buttons: ['D-Pad', 'L-Stick'] },
  { label: 'Confirm / Back / Tabs', buttons: ['A', 'B', 'LB', 'RB'] },
  { label: 'Pause / City map', buttons: ['Menu', 'View'] },
];

const FAMILY_HEAD = { xbox: 'Xbox controller', playstation: 'PlayStation controller', switch: 'Switch controller', generic: 'Gamepad' } as const;
function familyHead(): string { return FAMILY_HEAD[currentPadFamily()]; }
/** Buttons of one help row: live (after the player's rebinds, in the connected pad's own names) where the row is bindable, static otherwise. */
export function padKeys(p: { buttons: string[]; ctx?: PadContext; acts?: Action[]; extra?: string[] }): string[] {
  const f = currentPadFamily();
  if (!p.ctx || !p.acts) return p.buttons.map(t => localizeGlyph(t, f));
  const out: string[] = [];
  for (const a of p.acts) for (const g of padGlyphAll(a, p.ctx)) if (!out.includes(g)) out.push(g);
  for (const e of p.extra ?? []) out.push(familyLabel(e, f));
  return out;
}

export class ControlsPanel {
  readonly el: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  private kbCol: HTMLDivElement;
  private padCol: HTMLDivElement;

  constructor(private sound: (k: 'back') => void, private onBack: () => void) {
    this.el = h('div', 'ma-layer ma-modal-layer ma-controls');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Controls');
    const panel = h('div', 'ma-panel ma-panel-wide');
    const head = h('div', 'ma-panel-head');
    head.appendChild(backButton(() => { this.sound('back'); this.onBack(); }));
    head.appendChild(h('div', 'ma-panel-title', 'Controls'));
    panel.appendChild(head);
    this.scroller = h('div', 'ma-panel-body ma-controls-body');
    this.kbCol = h('div', 'ma-controls-col');
    this.padCol = h('div', 'ma-controls-col');
    this.scroller.append(this.kbCol, this.padCol);
    panel.appendChild(this.scroller);
    const foot = h('div', 'ma-panel-foot');
    const hints = h('div', 'ma-foot-hints');
    hints.appendChild(h('span', 'ma-foot-note', 'Rebind keys in Settings → Key Bindings and controller buttons in Settings → Input.'));
    foot.appendChild(hints);
    const fr = h('div', 'ma-foot-actions');
    fr.appendChild(button('ma-btn ma-btn-primary', 'Done', { onClick: () => { this.sound('back'); this.onBack(); } }));
    foot.appendChild(fr);
    panel.appendChild(foot);
    this.el.appendChild(panel);
  }

  private line(label: string, keys: string[], cls: string) {
    const row = h('div', 'ma-controls-row');
    row.appendChild(h('span', 'ma-controls-label', label));
    const k = h('span', 'ma-controls-keys');
    if (keys.length === 0) k.appendChild(h('span', 'ma-controls-unbound', 'Unbound'));
    keys.forEach((key, i) => {
      if (i > 0) k.appendChild(h('span', 'ma-controls-or', '/'));
      k.appendChild(h('kbd', `ma-key ${cls}`, key));
    });
    row.appendChild(k);
    return row;
  }

  open(s: Settings) {
    this.kbCol.textContent = '';
    this.kbCol.appendChild(h('div', 'ma-controls-head', 'Keyboard & mouse'));
    this.kbCol.appendChild(this.line('Look / Aim direction', ['Mouse'], 'ma-kb'));
    for (const g of ACTION_GROUPS) {
      this.kbCol.appendChild(h('div', 'ma-controls-group', g.title));
      for (const a of g.actions) this.kbCol.appendChild(this.line(ACTION_LABELS[a], s.bindings[a].map(keyLabel), 'ma-kb'));
    }
    this.padCol.textContent = '';
    this.padCol.appendChild(h('div', 'ma-controls-head', familyHead()));
    for (const p of PAD_HELP) this.padCol.appendChild(!p.buttons.length ? h('div', 'ma-controls-group', p.label) : this.line(p.label, padKeys(p), 'ma-pad'));
    this.scroller.scrollTop = 0;
  }
}
