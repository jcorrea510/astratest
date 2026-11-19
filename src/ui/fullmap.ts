/** Full-screen city map: pan (drag / arrows / stick), zoom (wheel / +-), click or Enter to set a waypoint. */
import { AVENUE_NAMES, STREET_NAMES, districtAt, DISTRICT_INFO, type CityMap } from '../world/citymap';
import type { MinimapBlip, MinimapState } from './contracts';
import { mapScreenToWorld, mapScreenDeltaToWorld, mapWorldToScreen, MAP_TILT, type MapView } from './geometry';
import { BLIP_KINDS, BLIP_LABELS } from './icons';
import { CityPainter, drawBlip, drawPlayerArrow, nearestStreets } from './mapdraw';
import { h, backButton } from './dom';
import { fmtDistance } from '../core/units';

/** Ground-plane squash of the pitched map (cos of the camera tilt from straight down). */
export const MAP_PITCH = 0.64;
/** The cached ground layer extends this fraction of the viewport past each edge, so panning rarely shows a gap. */
const LAYER_MARGIN = 0.2;
const w2 = (p: { x: number; z: number }): [number, number] => [p.x, p.z];

export class FullMap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stage: HTMLDivElement;
  private readout: HTMLDivElement;
  private state: MinimapState | null = null;
  private view: MapView = { cx: 0, cz: 0, scale: 1, w: 1, h: 1, tilt: MAP_TILT, pitch: MAP_PITCH };
  private targetScale = 1;
  private targetTilt = MAP_TILT;
  private anchor = { x: 0, y: 0 };
  private lastRender = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number } | null = null;
  private layer = document.createElement('canvas');
  private layerView: { cx: number; cz: number; scale: number; tilt: number; w: number; h: number; dpr: number; heat: number; fast: boolean; W: number; H: number } | null = null;
  private viewKey = '';
  private lastChange = 0;
  private legendOpen = false;
  private legendEl!: HTMLDivElement;
  private fitScale = 1;
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private open = false;
  private drag: { id: number; x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  private cursor: { x: number; y: number } | null = null;
  private keyboardCursor = false;
  private localWaypoint: { x: number; z: number } | null = null;
  private t0 = performance.now();
  private legendCanvases: { kind: MinimapBlip['kind']; c: HTMLCanvasElement; row: HTMLElement }[] = [];

  constructor(private city: CityMap, private painter: CityPainter, private onWaypoint: (x: number, z: number) => void, private onClose: () => void, private sound: (k: 'click' | 'hover' | 'back') => void) {
    this.el = h('div', 'ma-layer ma-map');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'City map');
    const head = h('div', 'ma-map-head');
    const titles = h('div', 'ma-map-titles');
    titles.appendChild(h('div', 'ma-map-title', 'City map'));
    head.appendChild(titles);
    this.readout = h('div', 'ma-map-readout');
    head.appendChild(this.readout);
    head.appendChild(backButton(() => { this.sound('back'); this.onClose(); }));
    this.el.appendChild(head);

    const body = h('div', 'ma-map-body');
    this.stage = h('div', 'ma-map-stage');
    this.canvas = h('canvas', 'ma-map-canvas');
    this.canvas.tabIndex = -1;
    this.stage.appendChild(this.canvas);
    body.appendChild(this.stage);
    const legend = h('div', 'ma-map-legend is-collapsed');
    this.legendEl = legend;
    const chip = h('button', 'ma-legend-chip', 'Legend');
    chip.type = 'button'; chip.setAttribute('aria-expanded', 'false');
    chip.appendChild(h('kbd', 'ma-key', 'L'));
    chip.addEventListener('click', () => { this.sound('click'); this.toggleLegend(); });
    legend.appendChild(chip);
    const lbody = h('div', 'ma-legend-body');
    legend.appendChild(lbody);
    lbody.appendChild(h('div', 'ma-label', 'Legend'));
    const list = h('div', 'ma-legend-list');
    for (const kind of BLIP_KINDS) {
      const row = h('div', 'ma-legend-row');
      const c = h('canvas', 'ma-legend-icon');
      c.width = 44; c.height = 44;
      row.appendChild(c);
      row.appendChild(h('span', '', BLIP_LABELS[kind]));
      list.appendChild(row);
      this.legendCanvases.push({ kind, c, row });
    }
    lbody.appendChild(list);
    const districts = h('div', 'ma-legend-districts');
    districts.appendChild(h('div', 'ma-label', 'Districts'));
    for (const d of Object.values(DISTRICT_INFO)) {
      const row = h('div', 'ma-legend-row');
      const sw = h('span', 'ma-swatch');
      sw.style.background = d.color;
      row.appendChild(sw); row.appendChild(h('span', '', d.name));
      districts.appendChild(row);
    }
    lbody.appendChild(districts);
    body.appendChild(legend);
    this.el.appendChild(body);

    const foot = h('div', 'ma-map-foot');
    for (const [k, t] of [['Click', 'Set waypoint'], ['Drag', 'Pan'], ['Wheel', 'Zoom'], ['Arrows', 'Pan'], ['Q E', 'Rotate'], ['L', 'Legend'], ['Enter', 'Waypoint at centre'], ['Esc', 'Close']]) {
      const s = h('span', 'ma-foot-hint');
      s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(t));
      foot.appendChild(s);
    }
    this.el.appendChild(foot);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;

    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      const r0 = this.canvas.getBoundingClientRect();
      this.pointers.set(e.pointerId, { x: e.clientX - r0.left, y: e.clientY - r0.top });
      if (this.pointers.size === 2) { this.pinch = { d: this.pinchDist() }; this.drag = null; return; }
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
    });
    this.canvas.addEventListener('pointermove', e => {
      const r = this.canvas.getBoundingClientRect();
      this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.keyboardCursor = false;
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: this.cursor.x, y: this.cursor.y });
      if (this.pinch && this.pointers.size >= 2) {
        const d = this.pinchDist(), pts = [...this.pointers.values()];
        if (this.pinch.d > 0 && d > 0) {
          const f = d / this.pinch.d, mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
          this.zoomAt(f, mx, my, true);
        }
        this.pinch.d = d; this.dirty = true; return;
      }
      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.hypot(dx, dy) > 5) this.drag.moved = true;
        if (this.drag.moved) { const d = mapScreenDeltaToWorld(this.view, dx / this.view.scale, dy / this.view.scale); this.view.cx = this.drag.cx - d.x; this.view.cz = this.drag.cz - d.z; this.clampView(); }
      }
      this.dirty = true;
    });
    this.canvas.addEventListener('pointerup', e => {
      this.pointers.delete(e.pointerId);
      this.dirty = true;
      if (this.pointers.size < 2) this.pinch = null;
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const moved = this.drag.moved;
      this.drag = null;
      if (!moved) {
        const r = this.canvas.getBoundingClientRect();
        const w = mapScreenToWorld(this.view, e.clientX - r.left, e.clientY - r.top);
        this.setWaypoint(w.x, w.z);
      }
    });
    this.canvas.addEventListener('pointercancel', e => { this.drag = null; this.pointers.delete(e.pointerId); this.pinch = null; });
    this.canvas.addEventListener('pointerleave', () => { this.cursor = null; this.dirty = true; });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    window.addEventListener('resize', () => { if (this.open) this.resize(false); });
    window.addEventListener('keydown', e => {
      if (!this.open || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyQ') this.rotate(-Math.PI / 12);
      else if (e.code === 'KeyE') this.rotate(Math.PI / 12);
      else if (e.code === 'KeyL') this.toggleLegend();
      else if (e.code === 'KeyR') { this.targetTilt = MAP_TILT; this.dirty = true; }
    }, true); // capture: the UI layer stops propagation of keys while a menu is open
  }

  private toggleLegend() {
    this.legendOpen = !this.legendOpen;
    this.legendEl.classList.toggle('is-collapsed', !this.legendOpen);
    this.legendEl.querySelector('.ma-legend-chip')?.setAttribute('aria-expanded', String(this.legendOpen));
  }
  private pinchDist() { const p = [...this.pointers.values()]; return p.length >= 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0; }
  /** Rotate the map by `da` radians (eased). */
  rotate(da: number) { this.targetTilt += da; this.dirty = true; }

  private setWaypoint(x: number, z: number) {
    const b = this.painter.bounds;
    x = Math.min(b.maxX, Math.max(b.minX, x)); z = Math.min(b.maxZ, Math.max(b.minZ, z));
    this.localWaypoint = { x, z };
    this.sound('click');
    this.onWaypoint(x, z);
    this.dirty = true;
  }

  show(s: MinimapState) {
    this.state = s;
    this.open = true;
    this.el.classList.add('is-open');
    this.localWaypoint = s.blips.find(b => b.kind === 'waypoint') ?? null;
    this.resize(true);
    this.targetScale = this.view.scale; this.targetTilt = MAP_TILT; this.view.tilt = MAP_TILT; this.layerView = null; this.lastRender = performance.now();
    const present = new Set(s.blips.map(b => b.kind));
    for (const l of this.legendCanvases) {
      const ctx = l.c.getContext('2d');
      if (ctx) { ctx.clearRect(0, 0, 44, 44); drawBlip(ctx, l.kind, 22, l.kind === 'waypoint' ? 26 : 22, 11, 0); }
      l.row.classList.toggle('is-present', present.has(l.kind));
    }
    cancelAnimationFrame(this.raf);
    const loop = () => { if (!this.open) return; this.render(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  update(s: MinimapState) { if (this.open) { this.state = s; this.dirty = true; } }
  hide() {
    this.open = false;
    this.el.classList.remove('is-open');
    cancelAnimationFrame(this.raf);
    this.drag = null;
  }
  isOpen() { return this.open; }

  /** Keyboard / gamepad: returns true if handled. */
  action(a: 'up' | 'down' | 'left' | 'right' | 'select' | 'zoomIn' | 'zoomOut'): boolean {
    const step = 90 / this.view.scale;
    this.keyboardCursor = true;
    const mv = (dx: number, dy: number) => { const d = mapScreenDeltaToWorld(this.view, dx, dy); this.view.cx += d.x; this.view.cz += d.z; };
    if (a === 'up') mv(0, -step);
    else if (a === 'down') mv(0, step);
    else if (a === 'left') mv(-step, 0);
    else if (a === 'right') mv(step, 0);
    else if (a === 'zoomIn') this.zoomAt(1.25, this.view.w / 2, this.view.h / 2);
    else if (a === 'zoomOut') this.zoomAt(1 / 1.25, this.view.w / 2, this.view.h / 2);
    else if (a === 'select') { this.setWaypoint(this.view.cx, this.view.cz); return true; }
    this.clampView();
    this.dirty = true;
    return true;
  }
  /** Continuous pan from an analog stick (-1..1), dt seconds. */
  pan(x: number, y: number, dt: number) {
    if (Math.abs(x) < 0.2 && Math.abs(y) < 0.2) return;
    this.keyboardCursor = true;
    const d = mapScreenDeltaToWorld(this.view, (x * 520 * dt) / this.view.scale, (y * 520 * dt) / this.view.scale);
    this.view.cx += d.x; this.view.cz += d.z;
    this.clampView(); this.dirty = true;
  }

  private zoomAt(f: number, sx: number, sy: number, instant = false) {
    this.targetScale = Math.min(this.fitScale * 7, Math.max(this.fitScale * 0.9, this.targetScale * f));
    this.anchor = { x: sx, y: sy };
    if (instant) this.stepZoom(1);
    this.dirty = true;
  }
  /** Eases scale (about the zoom anchor) and rotation towards their targets; returns true while still moving. */
  private stepZoom(k: number): boolean {
    const v = this.view;
    let moving = false;
    if (Math.abs(this.targetScale - v.scale) > v.scale * 0.0015) {
      const before = mapScreenToWorld(v, this.anchor.x, this.anchor.y);
      v.scale += (this.targetScale - v.scale) * k;
      const after = mapScreenToWorld(v, this.anchor.x, this.anchor.y);
      v.cx += before.x - after.x; v.cz += before.z - after.z;
      moving = true;
    } else v.scale = this.targetScale;
    const t = v.tilt ?? 0;
    if (Math.abs(this.targetTilt - t) > 0.002) { v.tilt = t + (this.targetTilt - t) * k; moving = true; } else v.tilt = this.targetTilt;
    this.clampView();
    return moving;
  }
  private clampView() {
    const b = this.painter.bounds;
    this.view.cx = Math.min(b.maxX, Math.max(b.minX, this.view.cx));
    this.view.cz = Math.min(b.maxZ, Math.max(b.minZ, this.view.cz));
  }
  private resize(refit: boolean) {
    const w = Math.max(1, this.stage.clientWidth), hgt = Math.max(1, this.stage.clientHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(hgt * this.dpr);
    const b = this.painter.bounds;
    const prevFit = this.fitScale;
    const bw = b.maxX - b.minX, bh = b.maxZ - b.minZ, ct = Math.abs(Math.cos(MAP_TILT)), st = Math.abs(Math.sin(MAP_TILT));
    this.fitScale = Math.min(w / (bw * ct + bh * st), hgt / ((bw * st + bh * ct) * MAP_PITCH)) * 1.12;
    this.view.w = w; this.view.h = hgt;
    if (refit) {
      this.view.scale = this.fitScale; this.targetScale = this.fitScale;
      this.view.cx = (b.minX + b.maxX) / 2;
      this.view.cz = (b.minZ + b.maxZ) / 2;
    } else if (prevFit > 0) { this.view.scale *= this.fitScale / prevFit; this.targetScale *= this.fitScale / prevFit; }
    this.clampView();
    this.dirty = true;
  }

  private blipShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r * 0.7); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,243,220,0.55)'; ctx.stroke();
  }

  private render() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRender) / 1000); this.lastRender = now;
    const t = (now - this.t0) / 1000;
    const moving = this.stepZoom(1 - Math.exp(-dt * 11));
    const animated = moving || !!this.state?.blips.some(b => b.pulse || b.kind === 'police');
    if (!this.dirty && !animated) return;
    this.dirty = false;
    const ctx = this.ctx, v = this.view, s = this.state;
    const tilt = v.tilt ?? 0, pitch = v.pitch ?? 1;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // ground + buildings live in an oversized offscreen layer rendered crisply only when the view has settled;
    // while panning / zooming / rotating it is just re-transformed (a single drawImage)
    const W = Math.round(v.w * (1 + 2 * LAYER_MARGIN)), H = Math.round(v.h * (1 + 2 * LAYER_MARGIN));
    const heatKey = s?.heatRadius ? Math.round(s.heatRadius.x + s.heatRadius.z + s.heatRadius.r) : 0;
    const vkey = `${v.cx.toFixed(2)}|${v.cz.toFixed(2)}|${v.scale.toFixed(4)}|${tilt.toFixed(4)}`;
    if (vkey !== this.viewKey) { this.viewKey = vkey; this.lastChange = now; }
    const lv = this.layerView;
    const stale = !lv || lv.cx !== v.cx || lv.cz !== v.cz || lv.scale !== v.scale || lv.tilt !== tilt || lv.w !== v.w || lv.h !== v.h || lv.dpr !== this.dpr || lv.heat !== heatKey || lv.fast;
    const settled = now - this.lastChange > 140 && !this.drag?.moved && !this.pinch && !moving;
    let renderLayer = false, fastLayer = false;
    if (stale) {
      if (settled || !lv) { renderLayer = true; fastLayer = !settled; }
      else {
        const ratio = v.scale / lv.scale;
        if (ratio > 2.4 || ratio < 0.42 || lv.w !== v.w || lv.h !== v.h || lv.dpr !== this.dpr) { renderLayer = true; fastLayer = true; }
        else this.dirty = true; // keep the loop alive until the motion settles
      }
    }
    if (renderLayer) {
      this.layerView = { cx: v.cx, cz: v.cz, scale: v.scale, tilt, w: v.w, h: v.h, dpr: this.dpr, heat: heatKey, fast: fastLayer, W, H };
      const lw = Math.round(W * this.dpr), lh = Math.round(H * this.dpr);
      if (this.layer.width !== lw || this.layer.height !== lh) { this.layer.width = lw; this.layer.height = lh; }
      const lc = this.layer.getContext('2d')!;
      lc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      lc.fillStyle = '#071f2b'; lc.fillRect(0, 0, W, H);
      lc.save();
      lc.translate(W / 2, H / 2); lc.scale(1, pitch); lc.rotate(tilt); lc.scale(v.scale, v.scale); lc.translate(-v.cx, -v.cz);
      this.painter.paintGround(lc, v.scale);
      if (s?.heatRadius) {
        lc.beginPath(); lc.arc(s.heatRadius.x, s.heatRadius.z, s.heatRadius.r, 0, Math.PI * 2);
        lc.fillStyle = 'rgba(255, 96, 78, 0.16)'; lc.fill();
        lc.lineWidth = 2 / v.scale; lc.strokeStyle = 'rgba(120,180,255,0.7)'; lc.stroke();
      }
      lc.restore();
      this.painter.buildings.drawExtruded(lc, v.cx, v.cz, v.scale, tilt, pitch, W, H, fastLayer);
      if (fastLayer && settled) this.dirty = true; // upgrade to the crisp version next frame
    }
    const L = this.layerView;
    ctx.fillStyle = '#071f2b'; ctx.fillRect(0, 0, v.w, v.h);
    if (L) {
      // layer pixel -> world (as rendered) -> current screen, an exact affine map for the ground plane
      const lvw: MapView = { cx: L.cx, cz: L.cz, scale: L.scale, w: L.W, h: L.H, tilt: L.tilt, pitch };
      const o = mapWorldToScreen(v, ...w2(mapScreenToWorld(lvw, 0, 0))), px = mapWorldToScreen(v, ...w2(mapScreenToWorld(lvw, 1, 0))), py = mapWorldToScreen(v, ...w2(mapScreenToWorld(lvw, 0, 1)));
      const d = this.dpr;
      ctx.setTransform((px.x - o.x) * d, (px.y - o.y) * d, (py.x - o.x) * d, (py.y - o.y) * d, o.x * d, o.y * d);
      ctx.drawImage(this.layer, 0, 0, L.W, L.H);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }
    // waypoint route, drawn above the buildings in screen space so it keeps a constant width
    if (s?.route && s.route.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < s.route.length; i++) { const q = mapWorldToScreen(v, s.route[i].x, s.route[i].z); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(8,24,27,0.75)'; ctx.stroke();
      ctx.lineWidth = 4.5; ctx.strokeStyle = '#ffc37e'; ctx.stroke();
      ctx.setLineDash([2, 11]); ctx.lineDashOffset = -t * 18; ctx.lineWidth = 2; ctx.strokeStyle = '#fff3dc'; ctx.stroke(); ctx.setLineDash([]);
    }
    // haze at the far edge of the pitched plane
    const hz = ctx.createLinearGradient(0, 0, 0, v.h * 0.3);
    hz.addColorStop(0, 'rgba(7,31,43,0.9)'); hz.addColorStop(1, 'rgba(7,31,43,0)');
    ctx.fillStyle = hz; ctx.fillRect(0, 0, v.w, v.h * 0.3);
    const vg = ctx.createRadialGradient(v.w / 2, v.h / 2, v.h * 0.45, v.w / 2, v.h / 2, Math.max(v.w, v.h) * 0.75);
    vg.addColorStop(0, 'rgba(3,12,16,0)'); vg.addColorStop(1, 'rgba(3,12,16,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, v.w, v.h);

    const zoomK = v.scale / this.fitScale;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const hit = (x0: number, y0: number, x1: number, y1: number) => placed.some(r => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0);
    const br = 8.5;
    // blip icons: shops only once zoomed in; key icons (safehouse, arms, garage, mission...) always
    const icons: { b: MinimapBlip; x: number; y: number }[] = [];
    if (s) {
      for (const b of s.blips) {
        if (b.kind === 'waypoint') continue;
        if ((b.kind === 'shop' || b.kind === 'collectible') && zoomK < 1.6) continue;
        const p = mapWorldToScreen(v, b.x, b.z);
        if (p.x < -20 || p.y < -20 || p.x > v.w + 20 || p.y > v.h + 20) continue;
        icons.push({ b, x: p.x, y: p.y });
      }
      for (const i of icons) {
        this.blipShadow(ctx, i.x, i.y, br);
        drawBlip(ctx, i.b.kind, i.x, i.y - br * 0.7, br, t, !!i.b.pulse);
        if (i.b.kind !== 'shop') placed.push({ x0: i.x - br, y0: i.y - br * 1.7, x1: i.x + br, y1: i.y + br * 0.3 });
      }
    }
    // text labels, highest priority first; a label that would overlap one already placed is skipped
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    type Lab = { text: string; x: number; y: number; prio: number; kind: 'district' | 'blip'; alpha: number };
    const labs: Lab[] = [];
    for (const d of this.painter.districtLabels) {
      const p = mapWorldToScreen(v, d.x, d.z);
      if (p.x < -40 || p.y < -20 || p.x > v.w + 40 || p.y > v.h + 20) continue;
      labs.push({ text: d.name.toUpperCase().split('').join(' '), x: p.x, y: p.y, prio: 1, kind: 'district', alpha: 1 });
    }
    if (s) {
      const groups = new Map<string, { x: number; y: number; n: number }>();
      for (const i of icons) {
        const b = i.b;
        if (!b.label) continue;
        const m = /^(.*?)\s+helipad\s+\d+$/i.exec(b.label);
        if (m) { const g = groups.get(m[1]) ?? { x: 0, y: 0, n: 0 }; g.x += i.x; g.y += i.y; g.n++; groups.set(m[1], g); continue; }
        const isPad = b.kind === 'vehicle';
        if (isPad && zoomK < 1.5) continue; // minor labels hidden when zoomed out
        if (b.kind === 'shop' && zoomK < 1.9) continue;
        const prio = b.kind === 'safehouse' || b.kind === 'arms' || b.kind === 'garage' || b.kind === 'mission' || b.kind === 'target' || b.kind === 'checkpoint' ? 0 : isPad ? 3 : 2;
        labs.push({ text: b.label, x: i.x + br + 5, y: i.y - br * 0.7, prio, kind: 'blip', alpha: 1 });
      }
      if (zoomK >= 1.5) for (const [name, g] of groups) labs.push({ text: `${name} helipads`, x: g.x / g.n + br + 5, y: g.y / g.n - br * 0.7, prio: 3, kind: 'blip', alpha: 1 });
    }
    labs.sort((a2, b2) => a2.prio - b2.prio);
    const fs = Math.max(10, Math.min(15, v.scale * 22));
    for (const l of labs) {
      if (l.kind === 'district') { ctx.font = `700 ${fs}px Inter, "Helvetica Neue", Arial, sans-serif`; ctx.textAlign = 'center'; }
      else { ctx.font = '700 14px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; ctx.textAlign = 'left'; }
      const tw = ctx.measureText(l.text).width, th = l.kind === 'district' ? fs : 15;
      const x0 = l.kind === 'district' ? l.x - tw / 2 : l.x, y0 = l.y - th / 2;
      if (hit(x0, y0, x0 + tw, y0 + th)) continue;
      placed.push({ x0: x0 - 2, y0: y0 - 1, x1: x0 + tw + 2, y1: y0 + th + 1 });
      if (l.kind === 'district') {
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,30,34,0.65)'; ctx.strokeText(l.text, l.x, l.y);
        ctx.fillStyle = 'rgba(252,242,217,0.78)'; ctx.fillText(l.text, l.x, l.y);
      } else {
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(6,18,21,0.9)'; ctx.strokeText(l.text, l.x, l.y);
        ctx.fillStyle = '#fff3dc'; ctx.fillText(l.text, l.x, l.y);
      }
    }
    ctx.textBaseline = 'middle';
    if (s) {
      ctx.textAlign = 'center';
      const wp = this.localWaypoint;
      if (wp) { const p = mapWorldToScreen(v, wp.x, wp.z); this.blipShadow(ctx, p.x, p.y, 10); drawBlip(ctx, 'waypoint', p.x, p.y, 10, t); }
      const pp = mapWorldToScreen(v, s.x, s.z);
      const pulse = (t * 0.9) % 1;
      ctx.beginPath(); ctx.ellipse(pp.x, pp.y, 11 + pulse * 22, (11 + pulse * 22) * pitch, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,243,220,${0.55 * (1 - pulse)})`; ctx.lineWidth = 2; ctx.stroke();
      const hd = mapWorldToScreen(v, s.x + Math.sin(s.heading), s.z - Math.cos(s.heading));
      drawPlayerArrow(ctx, pp.x, pp.y, 11, Math.atan2(hd.x - pp.x, -(hd.y - pp.y)));
    }

    // Cursor readout and keyboard reticle
    let focus: { x: number; y: number } | null = this.cursor;
    if (this.keyboardCursor || !focus) {
      focus = this.keyboardCursor ? { x: v.w / 2, y: v.h / 2 } : null;
      if (focus) {
        ctx.strokeStyle = 'rgba(255,195,126,0.95)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(focus.x - 14, focus.y); ctx.lineTo(focus.x - 5, focus.y); ctx.moveTo(focus.x + 5, focus.y); ctx.lineTo(focus.x + 14, focus.y);
        ctx.moveTo(focus.x, focus.y - 14); ctx.lineTo(focus.x, focus.y - 5); ctx.moveTo(focus.x, focus.y + 5); ctx.lineTo(focus.x, focus.y + 14);
        ctx.stroke();
      }
    }
    if (focus) {
      const w = mapScreenToWorld(v, focus.x, focus.y);
      const away = s ? Math.hypot(w.x - s.x, w.z - s.z) : 0;
      this.readout.textContent = `${DISTRICT_INFO[districtAt(this.city, w.x, w.z)].name} · ${nearestStreets(w.x, w.z, AVENUE_NAMES, STREET_NAMES)} · ${fmtDistance(away)}`;
    } else this.readout.textContent = '';
  }
}
