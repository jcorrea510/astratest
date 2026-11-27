/**
 * AAA Custom Garage panel: docked on the right over a studio vignette so the vehicle stays framed in the bay.
 * Repair (priced by damage), Paint Studio (18 named automotive finishes with live car preview on hover/focus),
 * Appraisal / Buyback, and Exit Bay. Full mouse, keyboard, gamepad and touch support via [data-nav].
 */
import './garageMenu.css';
import { h } from './dom';
import { formatMoney } from './geometry';

export interface GarageView {
  title: string;
  accent?: string;
  money: number;
  car: string;
  carClass?: string;
  healthPct: number;
  currentHex?: string;
  paintName: string;
  repair: { price: number; note: string; enabled: boolean };
  paints: { hex: string; name: string }[];
  paintPrice: number;
  paintNote: string;
  paintEnabled: boolean;
  sell: { price: number; ok: boolean; note: string };
}

export interface GarageHandlers {
  onRepair: () => void;
  onPreview: (hex: string) => void;
  onPaint: (hex: string) => void;
  onSell: () => void;
  onLeave: () => void;
}

export class GaragePanel {
  readonly el: HTMLDivElement;
  private panelEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private carEl: HTMLDivElement;
  private walletEl: HTMLDivElement;
  private barFill: HTMLDivElement;
  private condEl: HTMLSpanElement;
  private condTag: HTMLSpanElement;
  private repairBtn: HTMLButtonElement;
  private repairPrice: HTMLSpanElement;
  private repairNote: HTMLDivElement;
  private swatches: HTMLDivElement;
  private previewChip: HTMLSpanElement;
  private pickName: HTMLSpanElement;
  private pickState: HTMLSpanElement;
  private paintBtn: HTMLButtonElement;
  private paintNote: HTMLDivElement;
  private sellBtn: HTMLButtonElement;
  private sellPrice: HTMLSpanElement;
  private sellNote: HTMLDivElement;
  private h: GarageHandlers | null = null;
  private view: GarageView | null = null;
  private picked: string | null = null;
  private open = false;
  private lastMoney = 0;

  constructor(private sound: (k: 'click' | 'hover' | 'back') => void) {
    this.el = h('div', 'ma-layer ma-garage');
    this.el.setAttribute('role', 'dialog');

    const panel = h('div', 'ma-panel ma-garage-panel');
    this.panelEl = panel;

    // Header
    const head = h('div', 'ma-panel-head ma-garage-head');
    const headLeft = h('div', 'ma-garage-brand');
    headLeft.appendChild(h('div', 'ma-garage-eyebrow', 'Port Meridian Customs'));
    this.titleEl = h('div', 'ma-panel-title ma-garage-title');
    this.carEl = h('div', 'ma-garage-vehicle');
    headLeft.append(this.titleEl, this.carEl);

    const wallet = h('div', 'ma-wallet ma-garage-wallet');
    wallet.appendChild(h('div', 'ma-label', 'Cash'));
    this.walletEl = h('div', 'ma-wallet-value');
    wallet.appendChild(this.walletEl);
    head.append(headLeft, wallet);
    panel.appendChild(head);

    // Body
    const body = h('div', 'ma-panel-body ma-garage-body');

    // Diagnostics / Integrity block
    const diag = h('div', 'ma-garage-diag');
    const diagTop = h('div', 'ma-garage-diag-top');
    diagTop.appendChild(h('span', 'ma-garage-sec-label', 'Chassis Integrity'));
    const diagRight = h('div', 'ma-garage-diag-right');
    this.condTag = h('span', 'ma-garage-condtag');
    this.condEl = h('span', 'ma-garage-condtxt');
    diagRight.append(this.condTag, this.condEl);
    diagTop.appendChild(diagRight);
    const bar = h('div', 'ma-garage-bar');
    this.barFill = h('div', 'ma-garage-barfill');
    bar.appendChild(this.barFill);
    diag.append(diagTop, bar);
    body.appendChild(diag);

    // Repair service card
    const repairSec = h('div', 'ma-garage-section');
    const repairHead = h('div', 'ma-garage-sec');
    repairHead.appendChild(h('span', 'ma-garage-sec-label', 'Body & Mechanical'));
    this.repairBtn = h('button', 'ma-garage-row');
    this.repairBtn.type = 'button';
    this.repairBtn.dataset.nav = '';
    this.repairBtn.dataset.act = 'repair';
    this.repairPrice = h('span', 'ma-garage-price');
    this.repairBtn.append(h('span', 'ma-garage-name', 'Full Repair'), this.repairPrice);
    this.repairBtn.addEventListener('click', () => this.act(this.repairBtn, () => this.h?.onRepair()));
    this.repairNote = h('div', 'ma-garage-note');
    repairSec.append(repairHead, this.repairBtn, this.repairNote);
    body.appendChild(repairSec);

    // Paint Studio card
    const paintSec = h('div', 'ma-garage-section');
    const rh = h('div', 'ma-garage-sec');
    rh.appendChild(h('span', 'ma-garage-sec-label', 'Finish Studio'));
    this.pickState = h('span', 'ma-garage-pickstate');
    rh.appendChild(this.pickState);

    const activeFinish = h('div', 'ma-garage-active');
    this.previewChip = h('span', 'ma-garage-chip');
    this.pickName = h('span', 'ma-garage-pick');
    activeFinish.append(this.previewChip, this.pickName);

    this.swatches = h('div', 'ma-garage-swatches');
    this.paintBtn = h('button', 'ma-garage-row ma-garage-apply');
    this.paintBtn.type = 'button';
    this.paintBtn.dataset.nav = '';
    this.paintBtn.dataset.act = 'paint';
    this.paintBtn.addEventListener('click', () => this.act(this.paintBtn, () => { if (this.picked) this.h?.onPaint(this.picked); }));
    this.paintNote = h('div', 'ma-garage-note');
    paintSec.append(rh, activeFinish, this.swatches, this.paintBtn, this.paintNote);
    body.appendChild(paintSec);

    // Appraisal / Sell section
    const sellSec = h('div', 'ma-garage-section');
    const sh = h('div', 'ma-garage-sec');
    sh.appendChild(h('span', 'ma-garage-sec-label', 'Appraisal & Buyback'));
    this.sellBtn = h('button', 'ma-garage-row ma-garage-sell');
    this.sellBtn.type = 'button';
    this.sellBtn.dataset.nav = '';
    this.sellBtn.dataset.act = 'sell';
    this.sellPrice = h('span', 'ma-garage-price');
    this.sellBtn.append(h('span', 'ma-garage-name', 'Sell Vehicle'), this.sellPrice);
    this.sellBtn.addEventListener('click', () => this.act(this.sellBtn, () => this.h?.onSell()));
    this.sellNote = h('div', 'ma-garage-note');
    sellSec.append(sh, this.sellBtn, this.sellNote);
    body.appendChild(sellSec);

    panel.appendChild(body);

    // Footer
    const foot = h('div', 'ma-panel-foot ma-garage-foot');
    const hints = h('div', 'ma-foot-hints');
    for (const [k, txt] of [['↑↓', 'Browse'], ['Enter', 'Confirm'], ['Esc', 'Exit']]) {
      const s = h('span', 'ma-foot-hint');
      s.appendChild(h('kbd', 'ma-key', k));
      s.appendChild(document.createTextNode(txt));
      hints.appendChild(s);
    }
    const leave = h('button', 'ma-btn ma-btn-primary ma-garage-exit', 'Exit Bay');
    leave.type = 'button';
    leave.dataset.nav = '';
    leave.addEventListener('click', () => this.requestClose());
    foot.append(hints, leave);
    panel.appendChild(foot);

    this.el.appendChild(panel);
  }

  isOpen() { return this.open; }

  /** Opens (or re-opens) the panel with the current garage state. */
  show(view: GarageView, handlers: GarageHandlers) {
    this.h = handlers;
    this.picked = null;
    this.open = true;
    this.lastMoney = view.money;
    this.titleEl.textContent = view.title;
    this.el.setAttribute('aria-label', view.title);
    this.panelEl.style.setProperty('--bay-accent', view.accent || '#f5a855');
    this.el.classList.add('is-open');
    this.buildSwatches(view);
    this.update(view);
  }

  hide() {
    this.open = false;
    this.el.classList.remove('is-open');
    this.picked = null;
  }

  requestClose() {
    if (!this.open) return;
    this.sound('back');
    this.hide();
    this.h?.onLeave();
  }

  /** Applies a changed state in place (focus, hover and the picked colour survive). */
  update(view: GarageView) {
    this.view = view;
    if (view.accent) this.panelEl.style.setProperty('--bay-accent', view.accent);
    this.carEl.textContent = view.carClass ? `${view.carClass} · ${view.car}` : view.car;

    if (view.money !== this.lastMoney) {
      this.walletEl.classList.remove('is-flash');
      void this.walletEl.offsetWidth;
      this.walletEl.classList.add('is-flash');
      this.lastMoney = view.money;
    }
    this.walletEl.textContent = formatMoney(view.money);

    const pct = Math.max(0, Math.min(100, Math.round(view.healthPct)));
    this.barFill.style.width = `${pct}%`;
    const lvl = pct > 72 ? 'good' : pct > 36 ? 'mid' : 'bad';
    this.barFill.dataset.level = lvl;
    this.condEl.textContent = `${pct}%`;
    this.condTag.dataset.level = lvl;
    this.condTag.textContent = pct >= 99 ? 'Pristine' : pct > 72 ? 'Minor Wear' : pct > 36 ? 'Damaged' : 'Critical';

    this.setRow(
      this.repairBtn,
      this.repairPrice,
      view.repair.enabled,
      view.repair.price > 0 ? formatMoney(view.repair.price) : 'Pristine',
    );
    this.repairNote.textContent = view.repair.note;

    if (this.swatches.childElementCount !== view.paints.length) this.buildSwatches(view);

    const pickedPaint = this.picked ? view.paints.find(p => p.hex === this.picked) : null;
    if (pickedPaint) {
      this.pickName.textContent = pickedPaint.name;
      this.pickState.textContent = 'Previewing';
      this.pickState.classList.add('is-preview');
      this.previewChip.style.background = pickedPaint.hex;
    } else {
      this.pickName.textContent = view.paintName;
      this.pickState.textContent = 'Current Finish';
      this.pickState.classList.remove('is-preview');
      this.previewChip.style.background = view.currentHex || '#7a828c';
    }

    const canPaint = view.paintEnabled && !!this.picked;
    this.paintBtn.textContent = '';
    this.paintBtn.append(
      h('span', 'ma-garage-name', this.picked ? 'Apply Respray' : 'Select a Finish'),
      h('span', 'ma-garage-price', formatMoney(view.paintPrice)),
    );
    this.paintBtn.classList.toggle('is-off', !canPaint);
    this.paintBtn.setAttribute('aria-disabled', String(!canPaint));
    this.paintNote.textContent = view.paintNote;

    this.setRow(
      this.sellBtn,
      this.sellPrice,
      view.sell.ok,
      view.sell.price > 0 ? `+${formatMoney(view.sell.price)}` : 'Unavailable',
    );
    this.sellNote.textContent = view.sell.note;
    this.sellNote.classList.toggle('is-bad', !view.sell.ok);
  }

  private setRow(btn: HTMLButtonElement, price: HTMLSpanElement, enabled: boolean, label: string) {
    btn.classList.toggle('is-off', !enabled);
    btn.setAttribute('aria-disabled', String(!enabled));
    price.textContent = label;
  }

  private buildSwatches(view: GarageView) {
    this.swatches.textContent = '';
    for (const p of view.paints) {
      const b = h('button', 'ma-garage-sw');
      b.type = 'button';
      b.dataset.nav = '';
      b.dataset.hex = p.hex;
      b.setAttribute('aria-label', p.name);
      b.title = p.name;
      const dot = h('span', 'ma-garage-dot');
      dot.style.background = p.hex;
      b.appendChild(dot);
      const pick = () => {
        if (this.picked === p.hex) return;
        this.picked = p.hex;
        this.h?.onPreview(p.hex);
        this.mark();
        if (this.view) this.update(this.view);
      };
      b.addEventListener('focus', pick);
      b.addEventListener('mouseenter', pick);
      b.addEventListener('click', () => { pick(); this.sound('click'); });
      this.swatches.appendChild(b);
    }
    this.mark();
  }

  private mark() {
    for (const b of Array.from(this.swatches.children) as HTMLElement[]) {
      b.classList.toggle('is-picked', b.dataset.hex === this.picked);
    }
  }

  private act(b: HTMLElement, fn: () => void) {
    if (b.classList.contains('is-off')) {
      this.sound('back');
      b.classList.remove('is-denied');
      void b.offsetWidth;
      b.classList.add('is-denied');
      return;
    }
    this.sound('click');
    fn();
  }
}
