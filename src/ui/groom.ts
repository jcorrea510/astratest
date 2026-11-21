/** Barber / clothing panel: category tabs, options with live preview (selecting previews, Pay buys). Mouse, keyboard and gamepad (data-nav). */
import { h } from './dom';
import { formatMoney } from './geometry';
import type { GroomTab } from '../game/grooming';

export interface GroomState { values: Record<string, string>; total: number; money: number; free: boolean; prices: Record<string, number> }
export interface GroomConfig { title: string; subtitle: string; tabs: GroomTab[]; onPick: (tab: string, id: string) => void; onPay: () => void; onClose: () => void }

export class GroomPanel {
  readonly el: HTMLDivElement;
  private titleEl: HTMLDivElement; private subEl: HTMLDivElement; private walletEl: HTMLDivElement;
  private tabsEl: HTMLDivElement; private bodyEl: HTMLDivElement; private totalEl: HTMLDivElement; private pay: HTMLButtonElement; private note: HTMLDivElement;
  private cfg: GroomConfig | null = null; private state: GroomState | null = null; private tab = 0; private open = false;

  constructor(private sound: (k: 'click' | 'hover' | 'back') => void) {
    this.el = h('div', 'ma-layer ma-groom'); this.el.setAttribute('role', 'dialog');
    const panel = h('div', 'ma-panel ma-groom-panel');
    const head = h('div', 'ma-panel-head ma-groom-head');
    const t = h('div'); this.titleEl = h('div', 'ma-panel-title ma-groom-title'); this.subEl = h('div', 'ma-label'); t.append(this.titleEl, this.subEl);
    const wallet = h('div', 'ma-wallet'); wallet.appendChild(h('div', 'ma-label', 'Wallet')); this.walletEl = h('div', 'ma-wallet-value'); wallet.appendChild(this.walletEl);
    head.append(t, wallet); panel.appendChild(head);
    this.tabsEl = h('div', 'ma-groom-tabs'); panel.appendChild(this.tabsEl);
    this.bodyEl = h('div', 'ma-panel-body ma-groom-body'); panel.appendChild(this.bodyEl);
    const foot = h('div', 'ma-panel-foot ma-groom-foot');
    const sum = h('div', 'ma-groom-sum'); sum.appendChild(h('div', 'ma-label', 'Your order')); this.totalEl = h('div', 'ma-groom-total'); this.note = h('div', 'ma-groom-note'); sum.append(this.totalEl, this.note);
    const acts = h('div', 'ma-foot-actions');
    const leave = h('button', 'ma-btn ma-btn-ghost', 'Leave'); leave.type = 'button'; leave.dataset.nav = ''; leave.addEventListener('click', () => this.requestClose());
    this.pay = h('button', 'ma-btn ma-btn-primary ma-groom-pay', 'Pay'); this.pay.type = 'button'; this.pay.dataset.nav = '';
    this.pay.addEventListener('click', () => { if (this.pay.disabled || !this.cfg) { this.sound('back'); return; } this.sound('click'); this.cfg.onPay(); });
    acts.append(leave, this.pay); foot.append(sum, acts); panel.appendChild(foot);
    this.el.appendChild(panel);
  }
  isOpen() { return this.open; }
  show(cfg: GroomConfig, state: GroomState) {
    this.cfg = cfg; this.state = state; this.tab = 0; this.open = true;
    this.titleEl.textContent = cfg.title; this.subEl.textContent = cfg.subtitle; this.el.setAttribute('aria-label', cfg.title);
    this.el.classList.add('is-open'); this.buildTabs(); this.render(true);
  }
  update(state: GroomState) { this.state = state; this.render(false); }
  private buildTabs() {
    this.tabsEl.textContent = '';
    this.cfg!.tabs.forEach((t, i) => {
      const b = h('button', 'ma-groom-tab', t.label); b.type = 'button'; b.dataset.nav = ''; b.dataset.tab = t.id;
      b.addEventListener('click', () => { this.tab = i; this.sound('hover'); this.render(true); });
      this.tabsEl.appendChild(b);
    });
  }
  private render(focusFirst: boolean) {
    const cfg = this.cfg, st = this.state; if (!cfg || !st) return;
    this.walletEl.textContent = formatMoney(st.money);
    [...this.tabsEl.children].forEach((c, i) => c.classList.toggle('is-active', i === this.tab));
    const tab = cfg.tabs[this.tab];
    const focusedOpt = (document.activeElement as HTMLElement | null)?.dataset?.opt;
    this.bodyEl.textContent = '';
    this.bodyEl.classList.toggle('is-swatches', tab.kind === 'colour');
    for (const o of tab.options) {
      const sel = st.values[tab.id] === o.id;
      const b = h('button', `ma-groom-opt${sel ? ' is-selected' : ''}`); b.type = 'button'; b.dataset.nav = ''; b.dataset.opt = o.id; b.setAttribute('aria-pressed', String(sel));
      const price = st.prices[`${tab.id}:${o.id}`] ?? 0;
      if (tab.kind === 'colour') {
        const sw = h('span', 'ma-groom-swatch'); sw.style.background = o.swatch ?? o.id; b.appendChild(sw);
        b.title = `${o.label}${price ? `  ${st.free ? 'free' : formatMoney(price)}` : ''}`; b.setAttribute('aria-label', o.label);
      } else {
        b.appendChild(h('span', 'ma-groom-name', o.label));
        b.appendChild(h('span', `ma-groom-price${sel ? ' is-current' : ''}`, sel ? 'Selected' : st.free ? 'Free' : price ? formatMoney(price) : 'Free'));
      }
      b.addEventListener('click', () => { this.sound('click'); cfg.onPick(tab.id, o.id); });
      this.bodyEl.appendChild(b);
    }
    this.totalEl.textContent = st.total > 0 ? (st.free ? 'Free (sandbox)' : formatMoney(st.total)) : 'No changes';
    const poor = !st.free && st.total > st.money;
    this.note.textContent = poor ? `Need ${formatMoney(st.total - st.money)} more` : '';
    this.pay.disabled = st.total <= 0 || poor; this.pay.classList.toggle('is-disabled', this.pay.disabled);
    this.pay.textContent = st.total <= 0 ? 'Pay' : st.free ? 'Apply' : `Pay ${formatMoney(st.total)}`;
    const target = (focusedOpt && this.bodyEl.querySelector<HTMLElement>(`[data-opt="${CSS.escape(focusedOpt)}"]`)) || (focusFirst ? this.bodyEl.querySelector<HTMLElement>('.is-selected') ?? this.bodyEl.querySelector<HTMLElement>('[data-nav]') : null);
    target?.focus({ preventScroll: true });
    if (focusFirst) target?.scrollIntoView?.({ block: 'nearest' });
  }
  requestClose() { if (!this.open) return; this.sound('back'); this.hide(); this.cfg?.onClose(); }
  hide() { this.open = false; this.el.classList.remove('is-open'); }
}
