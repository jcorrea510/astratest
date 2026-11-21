/**
 * Entry point. In a normal browser tab the page becomes a thin shell that holds a full-window iframe running the game.
 * Quitting to the title or leaving the highway reloads only the iframe, so the top page — the element that is
 * fullscreen — never navigates and fullscreen survives mode switches. Automation (navigator.webdriver) and ?noshell
 * load the game directly, so tests and debug hooks keep working on the top window.
 */
const params = new URLSearchParams(location.search);
let isTop = false;
try { isTop = window.top === window; } catch { isTop = false; }
if (isTop && !navigator.webdriver && !params.has('noshell')) {
  document.documentElement.style.cssText = 'height:100%;background:#000';
  document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#000';
  const f = document.createElement('iframe');
  f.id = 'game-frame';
  f.title = 'Meridian Afterglow';
  f.src = location.pathname + location.search + location.hash;
  f.allow = 'fullscreen; pointer-lock; gamepad; autoplay; clipboard-write';
  f.setAttribute('allowfullscreen', '');
  f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;display:block;background:#000';
  document.getElementById('app')?.replaceWith(f);
  const focus = () => { try { f.contentWindow?.focus(); } catch { /* ignore */ } };
  f.addEventListener('load', focus);
  window.addEventListener('pointerdown', focus, true);
  window.addEventListener('focus', focus);
  window.addEventListener('keydown', focus, true);
} else {
  void import('./main');
}
export {};
