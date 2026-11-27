/** Radial weapon / item wheel (SVG). Direction is accumulated from pointer deltas or stick input. */
import type { WheelSlot } from './contracts';
import { accumulateDirection, slotAngle, slotFromDirection } from './geometry';
import { WEAPON_PATHS, weaponIconUrl } from './icons';
import { h } from './dom';

const NS = 'http://www.w3.org/2000/svg';
const R_OUT = 232, R_IN = 98, R_MID = 166;
/** Accumulated direction length range: past the dead zone a slot is highlighted. */
export const WHEEL_MAX = 120;
export const WHEEL_DEADZONE = 28;

function polar(a: number, r: number) { return { x: Math.sin(a) * r, y: -Math.cos(a) * r }; }
/** Annular sector between angles a0..a1 with a constant-width gap of `gap` px on each side. */
function sectorPath(a0: number, a1: number, r0: number, r1: number, gap = 0) {
  const g0 = gap / r0, g1 = gap / r1;
  const p0 = polar(a0 + g1, r1), p1 = polar(a1 - g1, r1), p2 = polar(a1 - g0, r0), p3 = polar(a0 + g0, r0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}A${r1} ${r1} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}` +
    `L${p2.x.toFixed(2)} ${p2.y.toFixed(2)}A${r0} ${r0} 0 ${large} 0 ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}Z`;
}
/** Thin arc along radius r between angles a0..a1 (inset by the same constant gap as the sectors). */
function arcPath(a0: number, a1: number, r: number, gap: number) {
  const g = gap / r + 0.035, p0 = polar(a0 + g, r), p1 = polar(a1 - g, r);
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls) e.setAttribute('class', cls);
  return e;
}

export class Wheel {
  readonly el: HTMLDivElement;
  private svgRoot: SVGSVGElement;
  private slots: WheelSlot[] = [];
  private groups: SVGGElement[] = [];
  private highlighted = -1;
  private acc = { x: 0, y: 0 };
  private open = false;
  private centerName: SVGTextElement;
  private centerDetail: SVGTextElement;
  private centerHint: SVGTextElement;
  private statsGroup: SVGGElement;
  private needle: SVGCircleElement;
  private slotLayer: SVGGElement;

  constructor(private sound: (k: 'hover') => void) {
    this.el = h('div', 'ma-wheel');
    this.el.setAttribute('aria-hidden', 'true');
    this.svgRoot = svg('svg', { viewBox: '-260 -260 520 520' }, 'ma-wheel-svg');
    this.svgRoot.appendChild(svg('circle', { r: R_OUT + 2 }, 'ma-wheel-halo'));
    this.svgRoot.appendChild(svg('circle', { r: R_OUT }, 'ma-wheel-ring'));
    this.svgRoot.appendChild(svg('circle', { r: R_IN }, 'ma-wheel-ring ma-wheel-ring-in'));
    this.slotLayer = svg('g');
    this.svgRoot.appendChild(this.slotLayer);
    this.svgRoot.appendChild(svg('circle', { r: R_IN - 10 }, 'ma-wheel-hub'));
    this.needle = svg('circle', { r: 2.6, cx: 0, cy: -(R_IN - 14) }, 'ma-wheel-needle');
    this.svgRoot.appendChild(this.needle);
    this.centerName = svg('text', { x: 0, y: -20, 'text-anchor': 'middle' }, 'ma-wheel-name');
    this.centerDetail = svg('text', { x: 0, y: 24, 'text-anchor': 'middle' }, 'ma-wheel-detail');
    this.statsGroup = svg('g', {}, 'ma-wheel-stats');
    this.centerHint = svg('text', { x: 0, y: 50, 'text-anchor': 'middle' }, 'ma-wheel-hint');
    this.centerHint.textContent = 'Release to equip';
    this.svgRoot.append(this.centerName, this.centerDetail, this.statsGroup, this.centerHint);
    this.el.appendChild(this.svgRoot);
  }

  isOpen() { return this.open; }
  /** COMBAT: id of the highlighted slot (null when closed). */
  peek(): string | null { return this.open ? this.slots[this.highlighted]?.id ?? null : null; }

  show(slots: WheelSlot[], selectedId: string) {
    this.slots = slots.slice(0, 8);
    this.acc.x = 0; this.acc.y = 0;
    this.slotLayer.textContent = '';
    this.groups = [];
    const n = this.slots.length;
    const gap = n > 1 ? 2.5 : 0;
    this.slots.forEach((s, i) => {
      const a = slotAngle(i, n), half = Math.PI / Math.max(1, n);
      const g = svg('g', {}, 'ma-wheel-slot' + (s.enabled ? '' : ' is-disabled'));
      g.appendChild(svg('path', { d: n === 1 ? sectorPath(0, Math.PI * 2 - 0.0001, R_IN, R_OUT) : sectorPath(a - half, a + half, R_IN, R_OUT, gap) }, 'ma-wheel-sector'));
      const c = polar(a, R_MID);
      const url = weaponIconUrl(s.icon);
      if (url) {
        g.appendChild(svg('image', { href: url, x: c.x - 62, y: c.y - 38, width: 124, height: 51.7, preserveAspectRatio: 'xMidYMid meet' }, 'ma-wheel-icon'));
      } else {
        const icon = svg('svg', { x: c.x - 42, y: c.y - 30, width: 84, height: 42, viewBox: '0 0 64 32' }, 'ma-wheel-icon ma-wheel-glyph');
        icon.appendChild(svg('path', { d: WEAPON_PATHS[s.icon] ?? WEAPON_PATHS.fists, 'fill-rule': 'evenodd', fill: 'currentColor' }));
        g.appendChild(icon);
      }
      if (n > 1) g.appendChild(svg('path', { d: arcPath(a - half, a + half, R_OUT - 4, gap) }, 'ma-wheel-accent'));
      const lab = svg('text', { x: c.x, y: c.y + 30, 'text-anchor': 'middle' }, 'ma-wheel-slot-label');
      lab.textContent = s.label;
      g.appendChild(lab);
      const det = svg('text', { x: c.x, y: c.y + 46, 'text-anchor': 'middle' }, 'ma-wheel-slot-detail');
      det.textContent = s.enabled ? s.detail : '—';
      g.appendChild(det);
      g.addEventListener('pointerenter', () => this.highlight(i));
      this.slotLayer.appendChild(g);
      this.groups.push(g);
    });
    this.highlighted = -1;
    const sel = this.slots.findIndex(s => s.id === selectedId);
    this.highlight(sel >= 0 ? sel : 0, true);
    this.open = true;
    this.el.classList.add('is-open');
  }

  update(dx: number, dy: number) {
    if (!this.open || this.slots.length === 0) return;
    accumulateDirection(this.acc, dx, dy, WHEEL_MAX);
    const len = Math.hypot(this.acc.x, this.acc.y);
    if (len > WHEEL_DEADZONE) {
      this.highlight(slotFromDirection(this.acc.x, this.acc.y, this.slots.length));
      const k = (R_IN - 14) / len;
      this.needle.setAttribute('cx', (this.acc.x * k).toFixed(1));
      this.needle.setAttribute('cy', (this.acc.y * k).toFixed(1));
      this.needle.classList.add('is-active');
    }
  }

  hide(): string | null {
    if (!this.open) return null;
    this.open = false;
    this.el.classList.remove('is-open');
    const s = this.slots[this.highlighted];
    return s && s.enabled ? s.id : null;
  }

  private highlight(i: number, silent = false) {
    if (i === this.highlighted || i < 0 || i >= this.slots.length) return;
    this.groups[this.highlighted]?.classList.remove('is-active');
    this.highlighted = i;
    this.groups[i].classList.add('is-active');
    const s = this.slots[i];
    this.centerName.textContent = s.label;
    this.centerDetail.textContent = s.enabled ? s.detail : 'Not carried';
    this.centerHint.textContent = s.enabled ? 'Release to equip' : 'Unavailable';
    this.statsGroup.textContent = '';
    const stats = s.enabled && s.stats && s.stats.length ? s.stats.slice(0, 4) : null;
    if (stats) {
      this.centerName.setAttribute('y', '-44');
      this.centerDetail.setAttribute('y', '-22');
      this.centerDetail.setAttribute('style', 'font-size:18px');
      this.centerHint.setAttribute('y', '64');
      const barW = 66, barH = 4.5, xLabel = -58, xBar = -6;
      const startY = stats.length <= 2 ? 4 : -4;
      stats.forEach((st, idx) => {
        const y = startY + idx * 14;
        const lbl = svg('text', { x: xLabel, y: y + 4, 'text-anchor': 'start' }, 'ma-wheel-stat-label');
        lbl.textContent = st.label;
        const bg = svg('rect', { x: xBar, y, width: barW, height: barH, rx: 1.5 }, 'ma-wheel-stat-bg');
        const fill = svg('rect', { x: xBar, y, width: (Math.max(0.06, Math.min(1, st.value)) * barW).toFixed(1), height: barH, rx: 1.5 }, 'ma-wheel-stat-fill');
        this.statsGroup.append(lbl, bg, fill);
      });
    } else {
      this.centerName.setAttribute('y', '-20');
      this.centerDetail.setAttribute('y', '24');
      this.centerDetail.removeAttribute('style');
      this.centerHint.setAttribute('y', '50');
    }
    if (!silent) this.sound('hover');
    const a = slotAngle(i, this.slots.length);
    if (Math.hypot(this.acc.x, this.acc.y) <= WHEEL_DEADZONE) {
      const p = polar(a, R_IN - 14);
      this.needle.setAttribute('cx', p.x.toFixed(1)); this.needle.setAttribute('cy', p.y.toFixed(1));
    }
  }
}
