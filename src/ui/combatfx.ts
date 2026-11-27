/**
 * R6-F screen feedback that lives outside the main HUD: the directional damage indicator, the red hit vignette (plus the
 * low-health pulse), the hold-to-order radial menu and a one-line subtitle for what people shout back. Self-contained DOM
 * (its own stylesheet), so it works under any menu / HUD arrangement.
 */
import { h } from './dom';

const CSS = `
.ma-fx { position: fixed; inset: 0; pointer-events: none; z-index: 30; overflow: hidden; font-family: inherit; }
.ma-fx-vig { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, rgba(120,0,0,0) 38%, rgba(160,10,10,0.38) 80%, rgba(100,0,0,0.68) 100%); }
.ma-fx-sup { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, rgba(14,18,26,0) 56%, rgba(8,10,16,0.42) 88%, rgba(4,6,10,0.72) 100%); }
.ma-fx-low { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(40,0,0,0.65) 100%); }
.ma-fx-ind { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
.ma-fx-ind svg { position: absolute; left: -50vh; top: -50vh; width: 100vh; height: 100vh; overflow: visible; }
.ma-fx-ind path { fill: none; stroke: rgba(255,54,42,0.98); stroke-width: 1.45; stroke-linecap: round; filter: drop-shadow(0 0 0.7vh rgba(180,12,8,0.9)); }
.ma-fx-ind.is-on { animation: ma-fx-ind 0.95s ease-out forwards; }
@keyframes ma-fx-ind { 0% { opacity: 1; } 55% { opacity: 0.78; } 100% { opacity: 0; } }
.ma-fx-say { position: absolute; left: 50%; bottom: 24%; transform: translateX(-50%); padding: 6px 14px; border-radius: 4px; background: rgba(9,12,17,0.86);
  border: 1px solid rgba(255,255,255,0.1); border-left: 3px solid #ffc37e; box-shadow: 0 6px 18px rgba(0,0,0,0.45);
  color: #f4f6fa; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; opacity: 0; transition: opacity 0.2s; white-space: nowrap; }
.ma-fx-say.is-on { opacity: 1; }
.ma-fx-menu { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; transition: opacity 0.12s; }
.ma-fx-menu.is-on { opacity: 1; }
.ma-fx-menu .ring { position: absolute; left: -120px; top: -120px; width: 240px; height: 240px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.18); background: rgba(9,12,17,0.72); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
.ma-fx-menu .hub { position: absolute; left: -46px; top: -12px; width: 92px; text-align: center; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.72); text-transform: uppercase; letter-spacing: 0.14em; }
.ma-fx-menu .opt { position: absolute; padding: 7px 13px; border-radius: 4px; background: rgba(9,12,17,0.92); color: #eef1f6; font-size: 15px; font-weight: 600; white-space: nowrap;
  border: 1px solid rgba(255,255,255,0.16); box-shadow: 0 4px 14px rgba(0,0,0,0.45); transform: translate(-50%, -50%); }
.ma-fx-menu .opt b { color: #ffc37e; margin-right: 7px; }
.ma-fx-menu .opt.is-sel { background: #ffc37e; color: #14100a; border-color: #ffe2bc; }
.ma-fx-menu .opt.is-sel b { color: #14100a; }
`;

/** Thin curved wedge on a ring of radius 22% of the screen height (the svg is 100vh square, centred on the screen), pointing up; rotated per shooter. */
const WEDGE = '<svg viewBox="-50 -50 100 100"><path d="M -6 -21.2 A 22 22 0 0 1 6 -21.2"/></svg>';

export interface MenuItem { id: string; label: string }

export class CombatFx {
  readonly root: HTMLDivElement;
  private vig: HTMLDivElement; private sup: HTMLDivElement; private low: HTMLDivElement; private say_: HTMLDivElement; private menu: HTMLDivElement; private hub: HTMLDivElement;
  private inds: HTMLDivElement[] = []; private indNext = 0;
  private vigT = 0; private supT = 0; private sayT = 0; private lowK = 0; private pulse = 0;
  /** last indicator fired (angle in degrees: 0 = shooter ahead / top of the screen, 90 = to the right) - read by tests */
  last: { angle: number; t: number } | null = null;
  constructor(parent: HTMLElement) {
    if (!document.getElementById('ma-fx-css')) { const st = document.createElement('style'); st.id = 'ma-fx-css'; st.textContent = CSS; document.head.appendChild(st); }
    this.root = h('div', 'ma-fx');
    this.vig = h('div', 'ma-fx-vig'); this.sup = h('div', 'ma-fx-sup'); this.low = h('div', 'ma-fx-low');
    this.root.append(this.low, this.sup, this.vig);
    for (let i = 0; i < 6; i++) { const d = h('div', 'ma-fx-ind'); d.innerHTML = WEDGE; this.root.appendChild(d); this.inds.push(d); }
    this.say_ = h('div', 'ma-fx-say'); this.menu = h('div', 'ma-fx-menu'); this.hub = h('div', 'hub');
    this.root.append(this.say_, this.menu);
    parent.appendChild(this.root);
  }
  /** Damage came from `angleDeg` relative to where the camera looks (0 = ahead, 90 = right, 180 = behind). */
  hurt(angleDeg: number, amount: number) {
    const el = this.inds[this.indNext]; this.indNext = (this.indNext + 1) % this.inds.length;
    el.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`; el.dataset.angle = angleDeg.toFixed(1);
    el.classList.remove('is-on'); void el.offsetWidth; el.classList.add('is-on');
    this.vigT = Math.min(1, Math.max(this.vigT, 0.35 + amount / 40));
    this.last = { angle: angleDeg, t: performance.now() };
  }
  /** Subtle dark edge pulse when enemy rounds whizz closely past the player's head in a firefight. */
  suppress(strength: number) {
    this.supT = Math.min(1, Math.max(this.supT, 0.25 + strength * 0.55));
  }
  /** Brief subtitle line (what a person shouts back). */
  say(text: string, ms = 1800) { this.say_.textContent = text; this.say_.classList.add('is-on'); this.sayT = ms / 1000; }
  /** health 0..1; the screen darkens at the edges and pulses below 30%. */
  update(dt: number, healthFrac: number, alive: boolean) {
    this.vigT = Math.max(0, this.vigT - dt * 1.6);
    this.supT = Math.max(0, this.supT - dt * 2.4);
    const lowK = alive ? Math.max(0, Math.min(1, (0.35 - healthFrac) / 0.3)) : 0;
    this.lowK += (lowK - this.lowK) * Math.min(1, dt * 3);
    this.pulse += dt * (1.6 + this.lowK * 1.4);
    this.vig.style.opacity = String(this.vigT * 0.9);
    this.sup.style.opacity = String(this.supT * 0.72);
    this.low.style.opacity = String(this.lowK * (0.7 + 0.3 * Math.sin(this.pulse * Math.PI)));
    if (this.sayT > 0 && (this.sayT -= dt) <= 0) this.say_.classList.remove('is-on');
  }
  get lowHealth() { return this.lowK; }
  get vignette() { return this.vigT; }
  /** Opens / updates the radial order menu (items spread around a ring, top first). */
  showMenu(title: string, items: MenuItem[], sel: number) {
    const n = items.length;
    if (this.menu.dataset.sig !== items.map(i => i.id).join()) {
      this.menu.textContent = ''; this.menu.dataset.sig = items.map(i => i.id).join();
      const ring = h('div', 'ring'); this.menu.appendChild(ring); this.hub.textContent = title; this.menu.appendChild(this.hub);
      items.forEach((it, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2, o = h('div', 'opt'); o.dataset.id = it.id;
        o.style.left = `${Math.cos(a) * 150}px`; o.style.top = `${Math.sin(a) * 120}px`;
        const b = document.createElement('b'); b.textContent = String(i + 1); o.append(b, document.createTextNode(it.label)); this.menu.appendChild(o);
      });
    }
    this.hub.textContent = title;
    this.menu.querySelectorAll('.opt').forEach((o, i) => o.classList.toggle('is-sel', i === sel));
    this.menu.classList.add('is-on');
  }
  hideMenu() { this.menu.classList.remove('is-on'); }
  get menuOpen() { return this.menu.classList.contains('is-on'); }
  dispose() { this.root.remove(); }
}
