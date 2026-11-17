/** Tiny DOM helpers. Dynamic strings always go through textContent. */

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Creates an element from trusted, static markup authored in this codebase. */
export function fromHtml<T extends Element = HTMLElement>(markup: string): T {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as T;
}

export function button(cls: string, label: string, opts: { nav?: boolean; onClick?: () => void } = {}): HTMLButtonElement {
  const b = h('button', cls);
  b.type = 'button';
  b.textContent = label;
  if (opts.nav !== false) b.dataset.nav = '';
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

/** Writes text only when it changed. */
export class TextSlot {
  private last: string | null = null;
  constructor(public el: HTMLElement) {}
  set(v: string) { if (v !== this.last) { this.last = v; this.el.textContent = v; } }
}

/** Toggles a class only when the value changed. */
export function setClass(el: Element, cls: string, on: boolean) {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Renders "[F] to drive" style text with key caps. */
export function renderKeyText(target: HTMLElement, text: string) {
  target.textContent = '';
  const parts = text.split(/(\[[^\]]{1,14}\])/g);
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith('[') && p.endsWith(']')) target.appendChild(h('kbd', 'ma-key', p.slice(1, -1)));
    else target.appendChild(document.createTextNode(p));
  }
}
