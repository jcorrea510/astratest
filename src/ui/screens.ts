/** Static screen artwork and builders: title art, loading, mobile gate, death moment, mission card. */
import { h } from './dom';

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Sunset skyline of Port Meridian, generated deterministically as an SVG string. */
export function titleArtSvg(): string {
  const rnd = lcg(1977);
  const W = 1600, HZ = 650;
  const far: string[] = [], near: string[] = [], windows: string[] = [];
  // Far layer: hazy towers
  for (let x = 380; x < W; ) {
    const w = 26 + rnd() * 46;
    const centre = Math.exp(-(((x - 1020) / 260) ** 2));
    const hgt = 40 + rnd() * 80 + centre * 210;
    far.push(`<rect x="${x.toFixed(0)}" y="${(HZ - hgt).toFixed(0)}" width="${w.toFixed(0)}" height="${hgt.toFixed(0)}"/>`);
    x += w + 2 + rnd() * 10;
  }
  // Near layer: downtown silhouettes, a stepped tower and the harbour
  for (let x = 300; x < 1330; ) {
    const w = 30 + rnd() * 58;
    const centre = Math.exp(-(((x - 900) / 220) ** 2));
    const hgt = 26 + rnd() * 60 + centre * 150 * (0.6 + rnd() * 0.6);
    const y = HZ - hgt;
    near.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${(hgt + 2).toFixed(0)}"/>`);
    if (hgt > 120 && rnd() < 0.5) near.push(`<rect x="${(x + w * 0.3).toFixed(0)}" y="${(y - 18).toFixed(0)}" width="${(w * 0.4).toFixed(0)}" height="20"/>`);
    if (hgt > 150 && rnd() < 0.6) near.push(`<rect x="${(x + w / 2 - 1).toFixed(0)}" y="${(y - 46).toFixed(0)}" width="2" height="30"/>`);
    for (let wy = y + 10; wy < HZ - 8; wy += 11) for (let wx = x + 5; wx < x + w - 6; wx += 9) {
      if (rnd() < 0.09) windows.push(`<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="4" height="5"/>`);
    }
    x += w + rnd() * 6;
  }
  // Ferris wheel on the pier
  const fx = 1395, fy = 515, fr = 96;
  const spokes: string[] = [];
  const cabins: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const ex = fx + Math.cos(a) * fr, ey = fy + Math.sin(a) * fr;
    spokes.push(`M${fx} ${fy}L${ex.toFixed(1)} ${ey.toFixed(1)}`);
    cabins.push(`<rect x="${(ex - 5).toFixed(1)}" y="${(ey - 1).toFixed(1)}" width="10" height="9" rx="2"/>`);
  }
  // Sun reflection stripes on the water
  const refl: string[] = [];
  for (let i = 0; i < 16; i++) {
    const y = HZ + 10 + i * i * 0.9 + i * 6;
    const w = 300 - i * 15 + rnd() * 30;
    refl.push(`<rect x="${(1110 - w / 2).toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${(2 + i * 0.35).toFixed(1)}" opacity="${(0.75 - i * 0.04).toFixed(2)}"/>`);
  }
  // Sun stripe mask
  const stripes: string[] = [];
  for (let i = 0; i < 7; i++) {
    const y = 560 + i * 15 + i * i * 1.2;
    stripes.push(`<rect x="0" y="${y.toFixed(0)}" width="${W}" height="${(2 + i * 1.6).toFixed(1)}" fill="#000"/>`);
  }
  const palm = (x: number, y: number, s: number, flip: number) => {
    const fronds: string[] = [];
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.95 * 1.05;
      const len = 120 * s * (0.8 + (i % 2) * 0.25);
      const ex = Math.cos(a) * len, ey = Math.sin(a) * len * 0.55 + len * 0.28;
      const cx = Math.cos(a) * len * 0.5, cy = Math.sin(a) * len * 0.5 - 22 * s;
      fronds.push(`<path d="M0 0Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}Q${(cx * 0.9).toFixed(1)} ${(cy + 14 * s).toFixed(1)} 0 ${(6 * s).toFixed(1)}Z"/>`);
    }
    return `<g transform="translate(${x} ${y}) scale(${flip} 1)"><path d="M-7 ${(520 * s).toFixed(0)}Q${(30 * s).toFixed(0)} ${(260 * s).toFixed(0)} 0 0L7 2Q${(44 * s).toFixed(0)} ${(260 * s).toFixed(0)} 9 ${(520 * s).toFixed(0)}Z"/>${fronds.join('')}</g>`;
  };
  return `<svg class="ma-art" viewBox="0 0 ${W} 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<defs>
<linearGradient id="maSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c2a31"/><stop offset="0.3" stop-color="#21505a"/><stop offset="0.55" stop-color="#7f6a6c"/><stop offset="0.66" stop-color="#d8906a"/><stop offset="0.72" stop-color="#ffc483"/></linearGradient>
<linearGradient id="maSun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0c4"/><stop offset="0.6" stop-color="#ffc483"/><stop offset="1" stop-color="#ff9b6a"/></linearGradient>
<linearGradient id="maSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d5a5f"/><stop offset="0.35" stop-color="#173f47"/><stop offset="1" stop-color="#0a2229"/></linearGradient>
<radialGradient id="maGlow" cx="1110" cy="560" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffd59a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffd59a" stop-opacity="0"/></radialGradient>
<mask id="maSunMask"><rect width="${W}" height="900" fill="#fff"/>${stripes.join('')}</mask>
</defs>
<rect width="${W}" height="900" fill="url(#maSky)"/>
<rect width="${W}" height="900" fill="url(#maGlow)"/>
<g class="ma-art-sun"><circle cx="1110" cy="560" r="205" fill="url(#maSun)" mask="url(#maSunMask)"/></g>
<g fill="#5b6b72" opacity="0.55">${far.join('')}</g>
<g fill="none" stroke="#14343b" stroke-width="3"><circle cx="${fx}" cy="${fy}" r="${fr}"/><circle cx="${fx}" cy="${fy}" r="${fr - 10}" stroke-width="1.5"/><path d="${spokes.join('')}" stroke-width="1.4"/><path d="M${fx} ${fy}L${fx - 60} ${HZ}M${fx} ${fy}L${fx + 60} ${HZ}" stroke-width="5"/></g>
<g fill="#14343b">${cabins.join('')}<rect x="1300" y="${HZ - 14}" width="300" height="16"/></g>
<g fill="#14343b"><path d="M1500 ${HZ}V430H1508V${HZ}ZM1440 438H1600V446H1440ZM1504 430L1560 380L1563 386L1508 438Z"/><path d="M1560 ${HZ}V470H1566V${HZ}Z"/></g>
<g fill="#10313a">${near.join('')}</g>
<g fill="#ffcf8f" opacity="0.8">${windows.join('')}</g>
<rect y="${HZ}" width="${W}" height="${900 - HZ}" fill="url(#maSea)"/>
<g fill="#ffd59a">${refl.join('')}</g>
<rect y="${HZ}" width="${W}" height="1.5" fill="#ffd59a" opacity="0.5"/>
<g fill="#0a2329">${palm(1515, 400, 1.0, 1)}${palm(1585, 470, 0.8, -1)}${palm(150, 520, 0.75, -1)}</g>
</svg>`;
}

export function wordmark(cls = ''): HTMLElement {
  const w = h('div', `ma-wordmark ${cls}`);
  w.appendChild(h('div', 'ma-wm-1', 'Meridian'));
  w.appendChild(h('div', 'ma-wm-2', 'Afterglow'));
  return w;
}

export function monogram(): HTMLElement {
  const m = h('div', 'ma-monogram');
  m.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="22" r="11" fill="#ffc37e"/><rect x="4" y="24" width="32" height="2" fill="#12363a"/><rect x="4" y="28.5" width="32" height="2.6" fill="#12363a"/><rect x="2" y="33" width="36" height="7" fill="#12363a"/></svg>';
  return m;
}

export function buildLoading(): { el: HTMLDivElement; fill: HTMLDivElement; pct: HTMLDivElement; label: HTMLDivElement; tip: HTMLDivElement } {
  const el = h('div', 'ma-layer ma-loading');
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100');
  el.appendChild(h('div', 'ma-loading-sun'));
  const inner = h('div', 'ma-loading-inner');
  inner.appendChild(wordmark('ma-wordmark-sm'));
  const row = h('div', 'ma-loading-row');
  const label = h('div', 'ma-loading-label', 'Loading');
  const pct = h('div', 'ma-loading-pct', '0%');
  row.append(label, pct);
  inner.appendChild(row);
  const bar = h('div', 'ma-loading-bar');
  const fill = h('div', 'ma-loading-fill');
  bar.appendChild(fill);
  inner.appendChild(bar);
  el.appendChild(inner);
  const tip = h('div', 'ma-loading-tip');
  el.appendChild(tip);
  return { el, fill, pct, label, tip };
}

export function buildMobileGate(): HTMLDivElement {
  const el = h('div', 'ma-layer ma-mobile');
  el.innerHTML = titleArtSvg();
  el.appendChild(h('div', 'ma-mobile-shade'));
  const box = h('div', 'ma-mobile-box');
  box.appendChild(monogram());
  box.appendChild(wordmark('ma-wordmark-md'));
  box.appendChild(h('div', 'ma-mobile-rule'));
  box.appendChild(h('div', 'ma-mobile-head', 'Port Meridian is waiting on a bigger screen.'));
  box.appendChild(h('p', 'ma-mobile-text', 'Meridian Afterglow is built for a computer with a keyboard and mouse, or a gamepad. Open this page in Chrome, Safari or Firefox on your desktop or laptop to play.'));
  const url = h('div', 'ma-mobile-url', location.href.split('#')[0]);
  box.appendChild(url);
  const copy = h('button', 'ma-btn ma-btn-primary', 'Copy link');
  copy.type = 'button';
  copy.addEventListener('click', () => {
    const done = () => { copy.textContent = 'Link copied'; };
    try {
      const p = navigator.clipboard?.writeText(location.href.split('#')[0]);
      if (p) p.then(done, () => { copy.textContent = 'Copy unavailable'; }); else copy.textContent = 'Copy unavailable';
    } catch { copy.textContent = 'Copy unavailable'; }
  });
  box.appendChild(copy);
  el.appendChild(box);
  return el;
}

export function buildDeath(): { el: HTMLDivElement; word: HTMLDivElement; eyebrow: HTMLDivElement; detail: HTMLDivElement } {
  const el = h('div', 'ma-death');
  el.setAttribute('role', 'alert');
  const band = h('div', 'ma-death-band');
  const eyebrow = h('div', 'ma-eyebrow ma-death-eyebrow');
  const word = h('div', 'ma-death-word');
  const detail = h('div', 'ma-death-detail');
  band.append(eyebrow, word, h('div', 'ma-death-rule'), detail);
  el.appendChild(band);
  return { el, word, eyebrow, detail };
}

export function buildCard(): { el: HTMLDivElement; eyebrow: HTMLDivElement; title: HTMLDivElement; sub: HTMLDivElement } {
  const el = h('div', 'ma-card');
  el.setAttribute('aria-live', 'assertive');
  const eyebrow = h('div', 'ma-eyebrow ma-card-eyebrow');
  const title = h('div', 'ma-card-title');
  const sub = h('div', 'ma-card-sub');
  el.append(eyebrow, title, h('div', 'ma-card-rule'), sub);
  return { el, eyebrow, title, sub };
}
