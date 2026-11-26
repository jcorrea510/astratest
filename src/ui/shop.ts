/** Shop modal: list with prices, owned/disabled states, mouse + keyboard + gamepad. */
import type { ShopItem } from './contracts';
import { formatMoney } from './geometry';
import { h } from './dom';
import { CHECK_SVG, LOCK_SVG, guessIcon, weaponSvg } from './icons';
import { shopItemWeapon, weaponPreviewUrl } from './weaponPreview';

const CAR_SVG = '<svg class="ma-icon ma-icon-lg" viewBox="0 0 120 48" aria-hidden="true"><path fill="currentColor" d="M5 35c0-5 2-8 7-9l16-3 12-12c2-2 5-3 8-3h25c4 0 7 1 10 4l10 11 14 3c5 1 8 4 8 8v4H5z"/><path fill="rgba(8,10,12,0.55)" d="M43 22h19l-1-9H50zM67 22h22l-8-9h-14z"/><g fill="#0b0d10" stroke="currentColor" stroke-width="2.5"><circle cx="31" cy="37" r="8.5"/><circle cx="90" cy="37" r="8.5"/></g><g fill="currentColor"><circle cx="31" cy="37" r="3"/><circle cx="90" cy="37" r="3"/></g></svg>';

export class Shop {
  readonly el: HTMLDivElement;
  private title: HTMLDivElement;
  private moneyEl: HTMLDivElement;
  private list: HTMLDivElement;
  private detail: HTMLDivElement;
  private buyBtn: HTMLButtonElement;
  private selectedId = '';
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
    const split = h('div', 'ma-shop-split');
    this.list = h('div', 'ma-panel-body ma-shop-list');
    this.detail = h('div', 'ma-shop-detail');
    this.buyBtn = h('button', 'ma-btn ma-btn-primary ma-shop-buy');
    this.buyBtn.type = 'button';
    this.buyBtn.addEventListener('click', () => {
      const row = this.list.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(this.selectedId)}"]`);
      if (row) this.buy(this.selectedId, row);
    });
    split.append(this.list, this.detail);
    panel.appendChild(split);
    this.list.addEventListener('focusin', e => { const row = (e.target as Element).closest<HTMLElement>('[data-item-id]'); if (row) this.select(row.dataset.itemId!); });
    this.list.addEventListener('pointerover', e => { const row = (e.target as Element).closest<HTMLElement>('[data-item-id]'); if (row && row.dataset.itemId !== this.selectedId) this.select(row.dataset.itemId!); });
    const foot = h('div', 'ma-panel-foot');
    const hints = h('div', 'ma-foot-hints');
    for (const [k, t] of [['↑↓', 'Browse'], ['Enter', 'Buy'], ['Esc', 'Leave store']]) {
      const s = h('span', 'ma-foot-hint');
      if (k === 'Enter') s.classList.add('ma-hint-buy');
      if (k === 'Esc') s.classList.add('ma-hint-leave');
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
    const readOnly = items.length > 0 && items.every(i => i.info);
    this.el.classList.toggle('is-readonly', readOnly);
    const anyIcon = items.some(i => guessIcon(`${i.id} ${i.label}`));
    this.list.classList.toggle('no-icons', !anyIcon);
    for (const it of items) {
      const b = h('button', 'ma-shop-item');
      b.type = 'button'; b.dataset.nav = ''; b.dataset.itemId = it.id;
      const afford = money >= it.price;
      const state = it.owned ? 'owned' : !afford ? 'poor' : it.disabled ? 'disabled' : 'buy';
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
      if (it.info) {
        if (it.info.value) right.appendChild(h('span', 'ma-shop-price', it.info.value));
        else { const tag = h('span', `ma-shop-tag ${it.owned ? 'is-owned' : 'is-poor'}`); if (it.owned) tag.innerHTML = CHECK_SVG; tag.appendChild(document.createTextNode(it.owned ? 'Done' : 'To do')); right.appendChild(tag); }
      } else if (state === 'owned') {
        const tag = h('span', 'ma-shop-tag is-owned');
        tag.innerHTML = CHECK_SVG; tag.appendChild(document.createTextNode('Owned'));
        right.appendChild(tag);
      } else {
        right.appendChild(h('span', 'ma-shop-price', formatMoney(it.price)));
        if (state === 'poor') right.appendChild(h('span', 'ma-shop-tag is-poor', `Need ${formatMoney(it.price - money)} more`));
        if (state === 'disabled') { const tag = h('span', 'ma-shop-tag is-locked'); tag.innerHTML = LOCK_SVG; tag.appendChild(document.createTextNode('Unavailable')); right.appendChild(tag); }
      }
      b.appendChild(right);
      b.setAttribute('aria-label', `${it.label}, ${it.info ? (it.info.value ?? (it.owned ? 'done' : 'to do')) : it.owned ? 'owned' : formatMoney(it.price)}`);
      b.addEventListener('click', () => this.buy(it.id, b));
      this.list.appendChild(b);
    }
    const target = (focusedId && this.list.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(focusedId)}"]`)) || (first ? this.list.querySelector<HTMLElement>('.is-buy') ?? this.list.querySelector<HTMLElement>('[data-nav]') : null);
    target?.focus({ preventScroll: true });
    const sel = (target as HTMLElement | null)?.dataset?.itemId ?? (this.items.some(i => i.id === this.selectedId) ? this.selectedId : this.items[0]?.id ?? '');
    this.select(sel, true);
  }

  /** Marks a row as the one shown in the detail pane and fills the pane. */
  private select(id: string, force = false) {
    if (!force && id === this.selectedId) return;
    this.selectedId = id;
    const it = this.items.find(i => i.id === id);
    this.detail.textContent = '';
    if (!it) return;
    for (const r of this.list.children) (r as HTMLElement).classList.toggle('is-selected', (r as HTMLElement).dataset.itemId === id);
    const money = this.money;
    const ic = guessIcon(`${it.id} ${it.label}`);
    const pv = h('div', 'ma-shop-preview');
    const wid = shopItemWeapon(it.id), wurl = wid ? weaponPreviewUrl(wid) : null;
    if (wurl) { const img = document.createElement('img'); img.className = 'ma-wpreview'; img.src = wurl; img.alt = `${it.label} model`; img.draggable = false; pv.appendChild(img); pv.dataset.preview = 'model'; }
    else pv.innerHTML = ic ? weaponSvg(ic, 'ma-icon ma-icon-lg') : it.id.startsWith('car:') ? CAR_SVG : '';
    this.detail.appendChild(pv);
    this.detail.appendChild(h('div', 'ma-shop-dname', it.label));
    this.detail.appendChild(h('div', 'ma-shop-ddesc', it.description));
    if (it.stats?.length) {
      const st = h('div', 'ma-shop-stats');
      for (const s of it.stats) {
        const row = h('div', 'ma-shop-stat');
        row.appendChild(h('span', 'ma-shop-stat-l', s.label));
        const bar = h('span', 'ma-shop-stat-bar'); const fill = h('span', 'ma-shop-stat-fill');
        fill.style.width = `${Math.round(Math.max(0.04, Math.min(1, s.value)) * 100)}%`; bar.appendChild(fill); row.appendChild(bar);
        st.appendChild(row);
      }
      this.detail.appendChild(st);
    }
    if (it.info) return;
    const state = it.owned ? 'owned' : money < it.price ? 'poor' : it.disabled ? 'disabled' : 'buy';
    const foot = h('div', 'ma-shop-dfoot');
    foot.appendChild(h('div', 'ma-shop-dprice', state === 'owned' ? 'Owned' : formatMoney(it.price)));
    const b = this.buyBtn;
    b.textContent = state === 'owned' ? 'Owned' : state === 'poor' ? `Need ${formatMoney(it.price - money)} more` : state === 'disabled' ? 'Unavailable' : 'Buy';
    b.classList.toggle('is-off', state !== 'buy'); b.setAttribute('aria-disabled', String(state !== 'buy'));
    foot.appendChild(b);
    this.detail.appendChild(foot);
  }

  private buy(id: string, b: HTMLElement) {
    const it = this.items.find(i => i.id === id);
    if (!it) return;
    if (it.info || it.owned || it.disabled || this.money < it.price) {
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
