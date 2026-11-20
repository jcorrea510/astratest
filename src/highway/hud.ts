/** DOM overlay for the highway mode: menu, HUD, pause and wreck screens. Styled inline so the mode stays self-contained. */
import { MPS_TO_MPH, fmtClock12, miles } from '../core/units';
import { createFullscreenButton } from '../core/fullscreen';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import type { TimeOfDay } from './sky';

const CSS = `
.hw{position:fixed;inset:0;font-family:'Barlow Condensed','Arial Narrow',sans-serif;color:#f4efe4;pointer-events:none;user-select:none;z-index:30;text-transform:none}
.hw *{box-sizing:border-box}
.hw button{font-family:inherit;pointer-events:auto;cursor:pointer}
.hw-menu{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 60%,rgba(10,16,30,.78),rgba(2,4,10,.96));font-family:'Barlow Condensed','Arial Narrow',sans-serif;color:#f4efe4}
.hw-card{width:min(920px,92vw);max-height:92vh;overflow:auto;padding:28px 34px;border:1px solid rgba(255,255,255,.14);background:rgba(12,16,26,.88);border-radius:6px}
.hw-card h1{margin:0 0 4px;font-size:54px;letter-spacing:.06em;font-weight:800;font-style:italic;text-transform:uppercase}
.hw-card h2{margin:18px 0 8px;font-size:20px;letter-spacing:.2em;text-transform:uppercase;color:#f2b950;font-weight:700}
.hw-sub{opacity:.7;font-size:20px;margin-bottom:6px}
.hw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.hw-opt{padding:10px 12px;text-align:left;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:inherit;font-size:21px;font-weight:600;border-radius:3px;line-height:1.1}
.hw-opt small{display:block;font-size:15px;opacity:.6;font-weight:500;margin-top:3px}
.hw-opt:hover,.hw-opt:focus-visible{background:rgba(255,255,255,.12);outline:none}
.hw-opt.on{border-color:#f2b950;background:rgba(242,185,80,.16)}
.hw-row{display:flex;gap:8px;flex-wrap:wrap}
.hw-row .hw-opt{min-width:120px;text-align:center}
.hw-actions{display:flex;gap:12px;margin-top:22px;align-items:center}
.hw-go{padding:12px 34px;font-size:30px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;background:#f2b950;color:#14100a;border:0;border-radius:3px;font-style:italic}
.hw-go:hover,.hw-go:focus-visible{background:#ffd27a;outline:none}
.hw-ghost{padding:12px 22px;font-size:22px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:transparent;color:inherit;border:1px solid rgba(255,255,255,.3);border-radius:3px}
.hw-ghost:hover,.hw-ghost:focus-visible{background:rgba(255,255,255,.12);outline:none}
.hw-fs-btn{position:fixed;right:18px;top:16px;z-index:60;width:40px;height:40px;padding:8px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);color:#f4efe4;border:1px solid rgba(255,255,255,.28);border-radius:3px;pointer-events:auto;cursor:pointer}
.hw-fs-btn svg{width:100%;height:100%}
.hw-fs-btn:hover,.hw-fs-btn:focus-visible{background:rgba(255,255,255,.18);outline:none}
.hw-keys{margin-left:auto;opacity:.6;font-size:17px;text-align:right}
.hw-score{position:absolute;left:28px;top:22px;text-shadow:0 2px 10px rgba(0,0,0,.6)}
.hw-score b{display:block;font-size:64px;line-height:.9;font-weight:800;font-style:italic;font-variant-numeric:tabular-nums}
.hw-score span{font-size:18px;letter-spacing:.2em;opacity:.75;text-transform:uppercase}
.hw-combo{font-size:30px;font-weight:800;font-style:italic;color:#f2b950;min-height:34px;transition:opacity .3s}
.hw-speed{position:absolute;right:30px;bottom:26px;text-align:right;text-shadow:0 2px 12px rgba(0,0,0,.7)}
.hw-speed b{font-size:118px;line-height:.8;font-weight:800;font-style:italic;font-variant-numeric:tabular-nums}
.hw-speed span{display:block;font-size:24px;letter-spacing:.3em;opacity:.8;margin-top:4px}
.hw-bar{height:8px;width:260px;margin:10px 0 0 auto;background:rgba(255,255,255,.14);border-radius:2px;overflow:hidden}
.hw-bar i{display:block;height:100%;background:linear-gradient(90deg,#f2b950,#ff6a3d);transform-origin:left;transition:transform .08s}
.hw-bar.hp i{background:linear-gradient(90deg,#d8392b,#6fd36f)}
.hw-trip{position:absolute;left:28px;bottom:26px;font-size:26px;line-height:1.15;text-shadow:0 2px 10px rgba(0,0,0,.7)}
.hw-trip b{font-weight:800;font-size:40px;font-variant-numeric:tabular-nums}
.hw-trip div{opacity:.82}
.hw-top{position:absolute;right:68px;top:18px;display:flex;gap:8px;align-items:center}
.hw-top .hw-ghost{padding:6px 12px;font-size:18px;background:rgba(0,0,0,.35)}
.hw-pop{position:absolute;left:50%;top:26%;transform:translateX(-50%);text-align:center;font-size:44px;font-weight:800;font-style:italic;color:#fff;text-shadow:0 3px 14px rgba(0,0,0,.7);opacity:0}
.hw-pop small{display:block;font-size:26px;color:#f2b950}
.hw-pop.show{animation:hwpop 1.1s ease-out}
@keyframes hwpop{0%{opacity:0;transform:translateX(-50%) scale(.7)}12%{opacity:1;transform:translateX(-50%) scale(1.08)}70%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-26px) scale(1)}}
.hw-hit{position:absolute;inset:0;box-shadow:inset 0 0 160px 40px rgba(220,30,20,.75);opacity:0;transition:opacity .5s}
.hw-hint{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);font-size:19px;letter-spacing:.14em;opacity:.7;text-transform:uppercase;text-shadow:0 1px 6px #000}
.hw-layer{position:fixed;inset:0;z-index:45;display:none;align-items:center;justify-content:center;background:rgba(2,4,10,.72);font-family:'Barlow Condensed','Arial Narrow',sans-serif;color:#f4efe4}
.hw-layer.on{display:flex}
.hw-layer .hw-card{width:min(460px,90vw);text-align:center}
.hw-layer .hw-card h1{font-size:46px}
.hw-stack{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.hw-stack .hw-go,.hw-stack .hw-ghost{width:100%;pointer-events:auto}
.hw-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:12px 0 4px;text-align:left;font-size:22px}
.hw-stats b{float:right;font-variant-numeric:tabular-nums}
@media (max-width:760px){.hw-speed b{font-size:80px}.hw-score b{font-size:44px}}
`;

export interface MenuChoice { kind: VehicleKind; time: TimeOfDay; density: number }
export const CAR_CHOICES: VehicleKind[] = ['sedan', 'hatch', 'fullsize', 'wagon', 'suv', 'pickup', 'coupe', 'convertible', 'muscle', 'luxury', 'race', 'super'];
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

function ensureStyle(): void {
  if (document.getElementById('hw-style')) return;
  const s = document.createElement('style'); s.id = 'hw-style'; s.textContent = CSS; document.head.appendChild(s);
}

/** Car / time / traffic picker shown before a run. */
export function showHighwayMenu(onGo: (c: MenuChoice) => void, onBack: () => void, initial?: Partial<MenuChoice>): () => void {
  ensureStyle();
  const root = el('div', 'hw-menu'); root.id = 'hw-menu'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Highway run setup');
  const card = el('div', 'hw-card'); root.appendChild(card);
  card.append(el('h1', '', 'Highway'), el('div', 'hw-sub', 'Endless night run. Weave through traffic, pass close for points, stay off the barriers.'));
  const choice: MenuChoice = { kind: initial?.kind ?? 'sedan', time: initial?.time ?? 'night', density: initial?.density ?? 1 };
  const group = <T,>(title: string, opts: { label: string; sub?: string; value: T }[], get: () => T, set: (v: T) => void, cls = 'hw-grid') => {
    card.appendChild(el('h2', '', title));
    const row = el('div', cls); const btns: HTMLButtonElement[] = [];
    const paint = () => btns.forEach((b, i) => b.classList.toggle('on', opts[i].value === get()));
    opts.forEach(o => {
      const b = el('button', 'hw-opt'); b.type = 'button'; b.textContent = o.label; if (o.sub) b.appendChild(el('small', '', o.sub));
      b.dataset.value = String(o.value);
      b.addEventListener('click', () => { set(o.value); paint(); }); row.appendChild(b); btns.push(b);
    });
    paint(); card.appendChild(row); return row;
  };
  group('Car', CAR_CHOICES.map(k => ({ label: VEHICLES[k].name, sub: `${Math.round(VEHICLES[k].topSpeed * MPS_TO_MPH)} mph top`, value: k })), () => choice.kind, v => { choice.kind = v; }).id = 'hw-cars';
  group('Time of day', [{ label: 'Night', value: 'night' as TimeOfDay }, { label: 'Dusk', value: 'dusk' as TimeOfDay }, { label: 'Day', value: 'day' as TimeOfDay }], () => choice.time, v => { choice.time = v; }, 'hw-row');
  group('Traffic', [{ label: 'Light', value: 0.6 }, { label: 'Medium', value: 1 }, { label: 'Heavy', value: 1.5 }], () => choice.density, v => { choice.density = v; }, 'hw-row');
  const act = el('div', 'hw-actions');
  const go = el('button', 'hw-go', 'Start'); go.id = 'hw-start'; go.type = 'button';
  const back = el('button', 'hw-ghost', 'Back'); back.type = 'button';
  root.appendChild(createFullscreenButton('hw-fs-btn', 'hw-menu-fs'));
  act.append(go, back, Object.assign(el('div', 'hw-keys'), { innerHTML: 'W / S throttle and brake · A / D steer<br>V camera · C look back · H horn · Esc pause' }));
  card.appendChild(act);
  const close = () => root.remove();
  go.addEventListener('click', () => { close(); onGo({ ...choice }); });
  back.addEventListener('click', () => { close(); onBack(); });
  document.body.appendChild(root);
  go.focus();
  return close;
}

export class HighwayHud {
  readonly root = el('div', 'hw');
  private score = el('b', '', '0'); private combo = el('div', 'hw-combo');
  private speed = el('b', '', '0'); private speedBar = el('i'); private hpBar = el('i');
  private odo = el('b', '', '0.0 mi'); private clock = el('div'); private best = el('div');
  private pop = el('div', 'hw-pop'); private hit = el('div', 'hw-hit'); private hint = el('div', 'hw-hint');
  private pause = el('div', 'hw-layer'); private wreck = el('div', 'hw-layer');
  private wreckStats = el('div', 'hw-stats');
  private cache = new Map<string, string>();
  fsButton = createFullscreenButton('hw-fs-btn', 'hw-fs');
  constructor(private cb: { onResume(): void; onQuit(): void; onRetry(): void; onPause(): void }) {
    ensureStyle();
    const sc = el('div', 'hw-score'); sc.append(el('span', '', 'Score'), this.score, this.combo);
    const sp = el('div', 'hw-speed'); sp.append(this.speed, el('span', '', 'MPH'));
    const sb = el('div', 'hw-bar'); sb.appendChild(this.speedBar);
    const hb = el('div', 'hw-bar hp'); hb.appendChild(this.hpBar); hb.title = 'Car condition';
    sp.append(sb, hb);
    const trip = el('div', 'hw-trip'); trip.append(el('div', '', 'Trip'), this.odo, this.clock, this.best);
    const top = el('div', 'hw-top');
    const pb = el('button', 'hw-ghost', 'Pause'); pb.type = 'button'; pb.addEventListener('click', () => cb.onPause());
    top.append(pb); document.body.appendChild(this.fsButton);
    this.hint.textContent = 'V camera · C look back · H horn · Esc pause';
    this.root.append(this.hit, sc, trip, sp, top, this.pop, this.hint);
    // pause layer
    const pc = el('div', 'hw-card'); pc.append(el('h1', '', 'Paused'));
    const st = el('div', 'hw-stack');
    const mk = (label: string, cls: string, fn: () => void, id: string) => { const b = el('button', cls, label); b.type = 'button'; b.id = id; b.addEventListener('click', fn); return b; };
    st.append(mk('Resume', 'hw-go', () => cb.onResume(), 'hw-resume'), mk('Quit to title', 'hw-ghost', () => cb.onQuit(), 'hw-quit'));
    pc.appendChild(st); this.pause.appendChild(pc); this.pause.setAttribute('role', 'dialog'); this.pause.setAttribute('aria-label', 'Paused');
    const wc = el('div', 'hw-card'); wc.append(el('h1', '', 'Wrecked'), this.wreckStats);
    const ws = el('div', 'hw-stack'); ws.append(mk('Try again', 'hw-go', () => cb.onRetry(), 'hw-retry'), mk('Quit to title', 'hw-ghost', () => cb.onQuit(), 'hw-quit2'));
    wc.appendChild(ws); this.wreck.appendChild(wc);
    document.body.append(this.root, this.pause, this.wreck);
  }
  private set(key: string, node: HTMLElement, text: string): void { if (this.cache.get(key) !== text) { this.cache.set(key, text); node.textContent = text; } }
  update(s: { mph: number; topMph: number; score: number; combo: number; mult: number; health: number; meters: number; hour: number; bestMeters: number; cockpit: boolean }): void {
    this.set('score', this.score, Math.round(s.score).toLocaleString('en-US'));
    this.set('combo', this.combo, s.combo > 0 ? `COMBO x${s.mult.toFixed(1)}` : '');
    this.set('speed', this.speed, String(Math.round(s.mph)));
    this.speedBar.style.transform = `scaleX(${Math.min(1, s.mph / Math.max(60, s.topMph)).toFixed(3)})`;
    this.hpBar.style.transform = `scaleX(${(s.health / 100).toFixed(3)})`;
    this.set('odo', this.odo, `${miles(s.meters).toFixed(1)} mi`);
    this.set('clock', this.clock, fmtClock12(s.hour));
    this.set('best', this.best, `Best ${miles(s.bestMeters).toFixed(1)} mi`);
  }
  popup(title: string, sub = ''): void {
    this.pop.textContent = title; if (sub) this.pop.appendChild(el('small', '', sub));
    this.pop.classList.remove('show'); void this.pop.offsetWidth; this.pop.classList.add('show');
  }
  flashHit(power: number): void { this.hit.style.transition = 'none'; this.hit.style.opacity = String(Math.min(1, 0.25 + power * 0.07)); void this.hit.offsetWidth; this.hit.style.transition = 'opacity .6s'; this.hit.style.opacity = '0'; }
  showPause(on: boolean): void { this.pause.classList.toggle('on', on); if (on) this.pause.querySelector<HTMLButtonElement>('#hw-resume')?.focus(); }
  showWreck(on: boolean, stats?: [string, string][]): void {
    this.wreck.classList.toggle('on', on);
    if (on && stats) { this.wreckStats.textContent = ''; for (const [k, v] of stats) { const d = el('div', '', k); d.appendChild(el('b', '', v)); this.wreckStats.appendChild(d); } this.wreck.querySelector<HTMLButtonElement>('#hw-retry')?.focus(); }
  }
  hideHint(): void { this.hint.style.opacity = '0'; }
  dispose(): void { this.root.remove(); this.pause.remove(); this.wreck.remove(); }
}
