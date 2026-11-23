/**
 * Round 9 garage panel: docked on the right so the car stays in view. Repair (priced by damage), Respray (named swatches, the
 * car previews the colour on focus / hover, Respray buys it), Sell (offer or the reason it is refused) and Leave.
 * Mouse, keyboard and gamepad (every control is a [data-nav] button; the UI layer handles arrows and Esc).
 */
import './garageMenu.css';
import { h } from './dom';
import { formatMoney } from './geometry';

export interface GarageView {
  title: string; money: number; car: string; healthPct: number; paintName: string;
  repair: { price: number; note: string; enabled: boolean };
  paints: { hex: string; name: string }[]; paintPrice: number; paintNote: string; paintEnabled: boolean;
  sell: { price: number; ok: boolean; note: string };
}
export interface GarageHandlers {
  onRepair: () => void; onPreview: (hex: string) => void; onPaint: (hex: string) => void; onSell: () => void; onLeave: () => void;
}

export class GaragePanel {
  readonly el: HTMLDivElement;
  private titleEl: HTMLDivElement; private carEl: HTMLDivElement; private walletEl: HTMLDivElement;
  private barFill: HTMLDivElement; private condEl: HTMLSpanElement;
  private repairBtn: HTMLButtonElement; private repairPrice: HTMLSpanElement; private repairNote: HTMLDivElement;
  private swatches: HTMLDivElement; private pickName: HTMLSpanElement; private paintBtn: HTMLButtonElement; private paintNote: HTMLDivElement;
  private sellBtn: HTMLButtonElement; private sellPrice: HTMLSpanElement; private sellNote: HTMLDivElement;
  private h: GarageHandlers | null = null; private view: GarageView | null = null; private picked: string | null = null; private open = false;
  private lastMoney = 0;

  constructor(private sound: (k: 'click' | 'hover' | 'back') => void) {
    this.el = h('div', 'ma-layer ma-garage'); this.el.setAttribute('role', 'dialog');
    const panel = h('div', 'ma-panel ma-garage-panel');
    const head = h('div', 'ma-panel-head ma-garage-head');
    const t = h('div'); this.titleEl = h('div', 'ma-panel-title ma-garage-title'); this.carEl = h('div', 'ma-label'); t.append(this.titleEl, this.carEl);
    const wallet = h('div', 'ma-wallet'); wallet.appendChild(h('div', 'ma-label', 'Wallet')); this.walletEl = h('div', 'ma-wallet-value'); wallet.appendChild(this.walletEl);
    head.append(t, wallet); panel.appendChild(head);
    const body = h('div', 'ma-panel-body ma-garage-body');
    // condition
    const cond = h('div', 'ma-garage-cond'); const bar = h('div', 'ma-garage-bar'); this.barFill = h('div', 'ma-garage-barfill'); bar.appendChild(this.barFill);
    this.condEl = h('span', 'ma-garage-condtxt'); cond.append(h('span', 'ma-label', 'Condition'), bar, this.condEl); body.appendChild(cond);
    // repair
    this.repairBtn = h('button', 'ma-garage-row'); this.repairBtn.type = 'button'; this.repairBtn.dataset.nav = ''; this.repairBtn.dataset.act = 'repair';
    this.repairPrice = h('span', 'ma-garage-price');
    this.repairBtn.append(h('span', 'ma-garage-name', 'Repair'), this.repairPrice);
    this.repairBtn.addEventListener('click', () => this.act(this.repairBtn, () => this.h?.onRepair()));
    this.repairNote = h('div', 'ma-garage-note');
    body.append(this.repairBtn, this.repairNote);
    // respray
    const rh = h('div', 'ma-garage-sec'); rh.append(h('span', 'ma-label', 'Respray'), this.pickName = h('span', 'ma-garage-pick')); body.appendChild(rh);
    this.swatches = h('div', 'ma-garage-swatches'); body.appendChild(this.swatches);
    this.paintBtn = h('button', 'ma-garage-row'); this.paintBtn.type = 'button'; this.paintBtn.dataset.nav = ''; this.paintBtn.dataset.act = 'paint';
    this.paintBtn.addEventListener('click', () => this.act(this.paintBtn, () => { if (this.picked) this.h?.onPaint(this.picked); }));
    this.paintNote = h('div', 'ma-garage-note');
    body.append(this.paintBtn, this.paintNote);
    // sell
    body.appendChild(h('div', 'ma-garage-sec', '')).append(h('span', 'ma-label', 'Sell'));
    this.sellBtn = h('button', 'ma-garage-row ma-garage-sell'); this.sellBtn.type = 'button'; this.sellBtn.dataset.nav = ''; this.sellBtn.dataset.act = 'sell';
    this.sellPrice = h('span', 'ma-garage-price');
    this.sellBtn.append(h('span', 'ma-garage-name', 'Sell this car'), this.sellPrice);
    this.sellBtn.addEventListener('click', () => this.act(this.sellBtn, () => this.h?.onSell()));
    this.sellNote = h('div', 'ma-garage-note');
    body.append(this.sellBtn, this.sellNote);
    panel.appendChild(body);
    const foot = h('div', 'ma-panel-foot ma-garage-foot');
    const hints = h('div', 'ma-foot-hints');
    for (const [k, txt] of [['↑↓', 'Browse'], ['Enter', 'Choose'], ['Esc', 'Leave']]) { const s = h('span', 'ma-foot-hint'); s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(txt)); hints.appendChild(s); }
    const leave = h('button', 'ma-btn ma-btn-primary', 'Leave'); leave.type = 'button'; leave.dataset.nav = ''; leave.addEventListener('click', () => this.requestClose());
    foot.append(hints, leave); panel.appendChild(foot);
    this.el.appendChild(panel);
  }

  isOpen() { return this.open; }
  /** Opens (or re-opens) the panel with the current garage state. */
  show(view: GarageView, handlers: GarageHandlers) {
    this.h = handlers; this.picked = null; this.open = true; this.lastMoney = view.money;
    this.titleEl.textContent = view.title; this.el.setAttribute('aria-label', view.title);
    this.el.classList.add('is-open'); this.buildSwatches(view); this.update(view);
  }
  hide() { this.open = false; this.el.classList.remove('is-open'); this.picked = null; }
  requestClose() { if (!this.open) return; this.sound('back'); this.hide(); this.h?.onLeave(); }
  /** Applies a changed state in place (focus, hover and the picked colour survive). */
  update(view: GarageView) {
    this.view = view;
    this.carEl.textContent = view.car;
    if (view.money !== this.lastMoney) { this.walletEl.classList.remove('is-flash'); void this.walletEl.offsetWidth; this.walletEl.classList.add('is-flash'); this.lastMoney = view.money; }
    this.walletEl.textContent = formatMoney(view.money);
    this.barFill.style.width = `${Math.round(view.healthPct)}%`;
    this.barFill.dataset.level = view.healthPct > 66 ? 'good' : view.healthPct > 33 ? 'mid' : 'bad';
    this.condEl.textContent = `${Math.round(view.healthPct)}%`;
    this.setRow(this.repairBtn, this.repairPrice, view.repair.enabled, view.repair.price > 0 ? formatMoney(view.repair.price) : 'Done');
    this.repairNote.textContent = view.repair.note;
    if (this.swatches.childElementCount !== view.paints.length) this.buildSwatches(view);
    this.pickName.textContent = this.picked ? (view.paints.find(p => p.hex === this.picked)?.name ?? '') : `Now: ${view.paintName}`;
    const canPaint = view.paintEnabled && !!this.picked;
    this.paintBtn.textContent = '';
    this.paintBtn.append(h('span', 'ma-garage-name', this.picked ? 'Respray' : 'Pick a colour'), h('span', 'ma-garage-price', formatMoney(view.paintPrice)));
    this.paintBtn.classList.toggle('is-off', !canPaint); this.paintBtn.setAttribute('aria-disabled', String(!canPaint));
    this.paintNote.textContent = view.paintNote;
    this.setRow(this.sellBtn, this.sellPrice, view.sell.ok, view.sell.price > 0 ? `+${formatMoney(view.sell.price)}` : '');
    this.sellNote.textContent = view.sell.note; this.sellNote.classList.toggle('is-bad', !view.sell.ok);
  }
  private setRow(btn: HTMLButtonElement, price: HTMLSpanElement, enabled: boolean, label: string) {
    btn.classList.toggle('is-off', !enabled); btn.setAttribute('aria-disabled', String(!enabled)); price.textContent = label;
  }
  private buildSwatches(view: GarageView) {
    this.swatches.textContent = '';
    for (const p of view.paints) {
      const b = h('button', 'ma-garage-sw'); b.type = 'button'; b.dataset.nav = ''; b.dataset.hex = p.hex; b.setAttribute('aria-label', p.name); b.title = p.name;
      const dot = h('span', 'ma-garage-dot'); dot.style.background = p.hex; b.appendChild(dot);
      const pick = () => { if (this.picked === p.hex) return; this.picked = p.hex; this.h?.onPreview(p.hex); this.mark(); if (this.view) this.update(this.view); };
      b.addEventListener('focus', pick); b.addEventListener('click', () => { pick(); this.sound('click'); });
      this.swatches.appendChild(b);
    }
    this.mark();
  }
  private mark() { for (const b of Array.from(this.swatches.children) as HTMLElement[]) b.classList.toggle('is-picked', b.dataset.hex === this.picked); }
  private act(b: HTMLElement, fn: () => void) {
    if (b.classList.contains('is-off')) { this.sound('back'); b.classList.remove('is-denied'); void b.offsetWidth; b.classList.add('is-denied'); return; }
    this.sound('click'); fn();
  }
}
