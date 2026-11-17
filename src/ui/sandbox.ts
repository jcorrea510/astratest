/** Sandbox tools: a generic side panel rendering SandboxAction controls grouped by `group`. */
import type { SandboxAction } from './contracts';
import { button, h } from './dom';

type Value = number | string | boolean | undefined;

export class SandboxPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private desc: HTMLDivElement;
  private actions: SandboxAction[] = [];
  private onAction: (id: string, value?: number | string | boolean) => void = () => {};
  private open = false;

  constructor(private sound: (k: 'click' | 'hover' | 'back') => void, private onBack: () => void) {
    this.el = h('div', 'ma-layer ma-sandbox');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Sandbox tools');
    const panel = h('div', 'ma-sb-panel');
    const head = h('div', 'ma-sb-head');
    head.appendChild(h('div', 'ma-sb-title', 'Sandbox tools'));
    head.appendChild(button('ma-btn ma-btn-ghost ma-sb-close', 'Close', { nav: false, onClick: () => this.onBack() }));
    panel.appendChild(head);
    this.body = h('div', 'ma-sb-body');
    panel.appendChild(this.body);
    this.desc = h('div', 'ma-sb-desc');
    panel.appendChild(this.desc);
    const foot = h('div', 'ma-sb-foot');
    for (const [k, t] of [['↑↓', 'Select'], ['←→', 'Adjust'], ['Enter', 'Use'], ['Esc', 'Close']]) {
      const s = h('span', 'ma-foot-hint');
      s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(t));
      foot.appendChild(s);
    }
    panel.appendChild(foot);
    this.el.appendChild(panel);
    this.body.addEventListener('focusin', e => {
      const row = (e.target as Element).closest<HTMLElement>('[data-desc]');
      this.desc.textContent = row?.dataset.desc ?? '';
    });
  }

  isOpen() { return this.open; }

  show(actions: SandboxAction[], onAction: (id: string, value?: number | string | boolean) => void) {
    this.onAction = onAction;
    this.open = true;
    this.render(actions);
  }
  hide() { this.open = false; }

  refresh(actions: SandboxAction[]) { if (this.open) this.render(actions); }

  private render(actions: SandboxAction[]) {
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && this.body.contains(active) ? active.dataset.key ?? null : null;
    const scroll = this.body.scrollTop;
    this.actions = actions;
    this.body.textContent = '';
    const groups = new Map<string, SandboxAction[]>();
    for (const a of actions) { const g = groups.get(a.group); if (g) g.push(a); else groups.set(a.group, [a]); }
    for (const [name, list] of groups) {
      const sec = h('div', 'ma-sb-group');
      sec.appendChild(h('div', 'ma-sb-group-title', name));
      for (const a of list) sec.appendChild(this.control(a));
      this.body.appendChild(sec);
    }
    this.body.scrollTop = scroll;
    const target = focusKey ? this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`) : null;
    target?.focus({ preventScroll: true });
  }

  private fire(id: string, v?: Value) {
    try { this.onAction(id, v); } catch (e) { console.error(e); }
  }

  private control(a: SandboxAction): HTMLElement {
    const row = h('div', `ma-sb-row ma-sb-${a.kind}`);
    row.dataset.desc = a.detail ?? '';
    if (a.kind === 'button') {
      const b = button('ma-sb-btn', a.label, { onClick: () => { this.sound('click'); this.fire(a.id); } });
      b.dataset.key = a.id;
      row.appendChild(b);
      return row;
    }
    row.appendChild(h('span', 'ma-sb-label', a.label));
    if (a.kind === 'toggle') {
      const on = a.value === true;
      const b = button('ma-toggle', '', {
        onClick: () => {
          const v = b.getAttribute('aria-checked') !== 'true';
          b.setAttribute('aria-checked', String(v));
          txt.textContent = v ? 'On' : 'Off';
          this.sound('click');
          this.fire(a.id, v);
        },
      });
      b.dataset.key = a.id;
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-label', a.label);
      b.appendChild(h('span', 'ma-toggle-track'));
      const txt = h('span', 'ma-toggle-text', on ? 'On' : 'Off');
      b.appendChild(txt);
      row.appendChild(b);
    } else if (a.kind === 'slider') {
      const min = a.min ?? 0, max = a.max ?? 1, step = a.step ?? (max - min) / 20;
      const ctl = h('div', 'ma-slider');
      const input = h('input', 'ma-range');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(typeof a.value === 'number' ? a.value : min);
      input.dataset.nav = ''; input.dataset.key = a.id;
      input.setAttribute('aria-label', a.label);
      const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
      const out = h('span', 'ma-slider-value');
      const paint = () => {
        const v = Number(input.value);
        input.style.setProperty('--ma-fill', `${max > min ? ((v - min) / (max - min)) * 100 : 0}%`);
        out.textContent = v.toFixed(decimals);
      };
      paint();
      input.addEventListener('input', () => { paint(); this.fire(a.id, Number(input.value)); });
      ctl.append(input, out);
      row.appendChild(ctl);
    } else {
      const seg = h('div', 'ma-seg');
      seg.dataset.navRow = '';
      for (const o of a.options ?? []) {
        const b = button('ma-seg-opt', o.label, {
          onClick: () => {
            if (b.classList.contains('is-selected')) return;
            seg.querySelectorAll('.is-selected').forEach(x => { x.classList.remove('is-selected'); x.setAttribute('aria-pressed', 'false'); });
            b.classList.add('is-selected'); b.setAttribute('aria-pressed', 'true');
            this.sound('click');
            this.fire(a.id, o.value);
          },
        });
        b.dataset.key = `${a.id}:${o.value}`;
        const sel = o.value === a.value;
        b.setAttribute('aria-pressed', String(sel));
        if (sel) b.classList.add('is-selected');
        seg.appendChild(b);
      }
      row.appendChild(seg);
    }
    return row;
  }

  /** Current actions (for tests / debugging). */
  get current() { return this.actions; }
}
