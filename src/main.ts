import './style.css';
import { loadAssets } from './world/assets';
import { initPhysics } from './core/physics';
import { loadSettings } from './core/settings';
import { Game } from './game/game';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<canvas id="view"></canvas><div id="boot">Loading…</div>`;
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
async function boot() {
  const settings = loadSettings();
  const q = new URLSearchParams(location.search);
  if (q.get('quality')) settings.quality = q.get('quality') as typeof settings.quality;
  await initPhysics();
  const assets = await loadAssets((f, l) => { document.querySelector('#boot')!.textContent = `${l} ${(f * 100) | 0}%`; });
  const game = new Game(canvas, settings, assets);
  (window as unknown as { __game: Game }).__game = game;
  await game.init(() => {});
  if (q.get('hour')) game.hour = Number(q.get('hour'));
  document.querySelector('#boot')!.remove();
  if (q.get('manual') !== '1') game.start();
  document.title = 'ready';
  canvas.addEventListener('click', () => game.input.requestLock());
}
boot().catch(e => { console.error(e); document.title = 'error'; document.body.insertAdjacentHTML('beforeend', `<pre style="color:red;position:fixed;top:0">${e?.stack ?? e}</pre>`); });
