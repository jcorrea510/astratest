import './style.css';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<div class="shell"><div class="sun"></div><div class="horizon"></div><header><span class="monogram">M<span>↗</span></span><span>PORT MERIDIAN · 32° N</span></header><section class="title"><p class="eyebrow">A CITY BETWEEN TIDES</p><h1>MERIDIAN<br><em>AFTERGLOW</em></h1><p class="intro">The sun goes down.<br>The city opens up.</p><button id="start">Enter the city <span>↗</span></button><p class="hint">KEYBOARD + MOUSE / CONTROLLER</p></section><footer><span>AN ORIGINAL OPEN-WORLD EXPERIENCE</span><span>01 / THE COAST IS CLEAR</span></footer><div id="loading" hidden role="status"><span>PORT MERIDIAN</span><h2>Finding your way…</h2><progress max="100" value="0"></progress><p>Preparing the city</p></div><section id="mobile"><p class="eyebrow">MERIDIAN AFTERGLOW</p><h2>A big city.<br>A bigger screen.</h2><p>Play this on a computer with a keyboard and mouse or controller.</p></section></div>`;
document.querySelector('#start')!.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#loading')!.hidden = false;
  document.querySelector('progress')!.value = 100;
  document.querySelector('#loading p')!.textContent = 'City development is underway. This is the foundation build.';
});
