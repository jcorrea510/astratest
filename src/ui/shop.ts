/** Shop modal: list with prices, owned/disabled states, mouse + keyboard + gamepad. */
import type { ShopItem } from './contracts';
import { formatMoney } from './geometry';
import { h } from './dom';
import { CHECK_SVG, LOCK_SVG, guessIcon, weaponSvg } from './icons';

export class Shop {
  readonly el: HTMLDivElement;
  private title: HTMLDivElement;
  private moneyEl: HTMLDivElement;
  private list: HTMLDivElement;
  private items: ShopItem[] = [];
  private money = 0;
  private onBuy: (id: string) => void = () => {};
  private onCloseCb: () => void = () => {};
  private open = false;

  constructor(private sound: (k: 'click' | 'hover' | 'back') => void) {
    this.el = h('div', 'ma-layer ma-modal-layer ma-shop');
    this.el.setAttribute('role', 'dialog');
    const panel = h('div', 'ma-panel ma-shop-panel');
    const head = h('div', 'ma-panel-head ma-shop-head');
    this.title = h('div', 'ma-panel-title');
    head.appendChild(this.title);
    const wallet = h('div', 'ma-wallet');
    wallet.appendChild(h('div', 'ma-label', 'Wallet'));
    this.moneyEl = h('div', 'ma-wallet-value');
    wallet.appendChild(this.moneyEl);
    head.appendChild(wallet);
    panel.appendChild(head);
    this.list = h('div', 'ma-panel-body ma-shop-list');
    panel.appendChild(this.list);
    const foot = h('div', 'ma-panel-foot');
    const hints = h('div', 'ma-foot-hints');
    for (const [k, t] of [['↑↓', 'Browse'], ['Enter', 'Buy'], ['Esc', 'Leave store']]) {
      const s = h('span', 'ma-foot-hint');
      s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(t));
      hints.appendChild(s);
    }
    foot.appendChild(hints);
    const fr = h('div', 'ma-foot-actions');
    const leave = h('button', 'ma-btn ma-btn-ghost', 'Leave');
    leave.type = 'button'; leave.dataset.nav = '';
    leave.addEventListener('click', () => this.requestClose());
    fr.appendChild(leave);
    foot.appendChild(fr);
    panel.appendChild(foot);
    this.el.appendChild(panel);
  }

  isOpen() { return this.open; }

  show(title: string, items: ShopItem[], money: number, onBuy: (id: string) => void, onClose: () => void) {
    this.title.textContent = title;
    this.el.setAttribute('aria-label', title);
    this.onBuy = onBuy; this.onCloseCb = onClose;
    this.open = true;
    this.el.classList.add('is-open');
    this.refresh(items, money, true);
  }

  refresh(items: ShopItem[], money: number, first = false) {
    const prevMoney = this.money;
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.itemId;
    this.items = items; this.money = money;
    this.moneyEl.textContent = formatMoney(money);
    if (!first && money !== prevMoney) { this.moneyEl.classList.remove('is-flash'); void this.moneyEl.offsetWidth; this.moneyEl.classList.add('is-flash'); }
    this.list.textContent = '';
    for (const it of items) {
      const b = h('button', 'ma-shop-item');
      b.type = 'button'; b.dataset.nav = ''; b.dataset.itemId = it.id;
      const afford = money >= it.price;
      const state = it.owned ? 'owned' : it.disabled ? 'disabled' : afford ? 'buy' : 'poor';
      b.classList.add(`is-${state}`);
      const icon = h('span', 'ma-shop-icon');
      const ic = guessIcon(`${it.id} ${it.label}`);
      if (ic) icon.innerHTML = weaponSvg(ic); else icon.classList.add('is-empty');
      b.appendChild(icon);
      const text = h('span', 'ma-shop-text');
      text.appendChild(h('span', 'ma-shop-name', it.label));
      text.appendChild(h('span', 'ma-shop-desc', it.description));
      b.appendChild(text);
      const right = h('span', 'ma-shop-right');
      if (state === 'owned') {
        const tag = h('span', 'ma-shop-tag is-owned');
        tag.innerHTML = CHECK_SVG; tag.appendChild(document.createTextNode('Owned'));
        right.appendChild(tag);
      } else {
        right.appendChild(h('span', 'ma-shop-price', formatMoney(it.price)));
        if (state === 'poor') right.appendChild(h('span', 'ma-shop-tag is-poor', `Need ${formatMoney(it.price - money)} more`));
        if (state === 'disabled') { const tag = h('span', 'ma-shop-tag is-locked'); tag.innerHTML = LOCK_SVG; tag.appendChild(document.createTextNode('Unavailable')); right.appendChild(tag); }
      }
      b.appendChild(right);
      b.setAttribute('aria-label', `${it.label}, ${it.owned ? 'owned' : formatMoney(it.price)}`);
      b.addEventListener('click', () => this.buy(it.id, b));
      this.list.appendChild(b);
    }
    const target = (focusedId && this.list.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(focusedId)}"]`)) || (first ? this.list.querySelector<HTMLElement>('.is-buy') ?? this.list.querySelector<HTMLElement>('[data-nav]') : null);
    target?.focus({ preventScroll: true });
  }

  private buy(id: string, b: HTMLElement) {
    const it = this.items.find(i => i.id === id);
    if (!it) return;
    if (it.owned || it.disabled || this.money < it.price) {
      this.sound('back');
      b.classList.remove('is-denied'); void b.offsetWidth; b.classList.add('is-denied');
      return;
    }
    this.sound('click');
    this.onBuy(id);
  }

  requestClose() {
    if (!this.open) return;
    this.sound('back');
    this.hide();
    this.onCloseCb();
  }
  hide() { this.open = false; this.el.classList.remove('is-open'); }
}
