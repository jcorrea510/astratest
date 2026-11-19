/** Controls help: keyboard & mouse (from live bindings) and gamepad columns. */
import { ACTION_LABELS, keyLabel, type Settings } from '../core/settings';
import { ACTION_GROUPS } from './bindings';
import { backButton, button, h } from './dom';

/** Gamepad layout as implemented by src/core/input.ts (standard mapping). */
export const PAD_HELP: { label: string; buttons: string[] }[] = [
  { label: 'Move / Steer', buttons: ['L-Stick'] },
  { label: 'Look', buttons: ['R-Stick'] },
  { label: 'Fire / Accelerate', buttons: ['RT'] },
  { label: 'Aim / Brake & reverse', buttons: ['LT'] },
  { label: 'Sprint / Handbrake', buttons: ['A'] },
  { label: 'Jump', buttons: ['B'] },
  { label: 'Reload / Interact', buttons: ['X'] },
  { label: 'Enter / exit vehicle', buttons: ['Y'] },
  { label: 'Inventory wheel (hold)', buttons: ['LB'] },
  { label: 'Next weapon', buttons: ['RB'] },
  { label: 'Dodge roll / Horn', buttons: ['L3'] },
  { label: 'Look behind', buttons: ['R3'] },
  { label: 'Radio station', buttons: ['D-Pad ↑'] },
  { label: 'Headlights', buttons: ['D-Pad ↓'] },
  { label: 'Camera distance', buttons: ['D-Pad →'] },
  { label: 'City map', buttons: ['View'] },
  { label: 'Pause', buttons: ['Menu'] },
];

export class ControlsPanel {
  readonly el: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  private kbCol: HTMLDivElement;

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
    const padCol = h('div', 'ma-controls-col');
    padCol.appendChild(h('div', 'ma-controls-head', 'Gamepad'));
    for (const p of PAD_HELP) padCol.appendChild(this.line(p.label, p.buttons, 'ma-pad'));
    this.scroller.append(this.kbCol, padCol);
    panel.appendChild(this.scroller);
    const foot = h('div', 'ma-panel-foot');
    const hints = h('div', 'ma-foot-hints');
    hints.appendChild(h('span', 'ma-foot-note', 'Rebind keys in Settings → Key bindings.'));
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
    this.scroller.scrollTop = 0;
  }
}
