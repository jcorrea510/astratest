/**
 * Audio harness: interactive controls for every sound plus `window.audioTest`, an offline-rendering test API used by
 * headless checks (levels, spectra, music key, engine response).
 */
import type { SfxName, EngineVoice, LoopVoice } from '../src/ui/contracts';
import { Audio } from '../src/audio/audio';
import { AudioCore } from '../src/audio/core';
import { SFX_META } from '../src/audio/sfx';
import { EngineVoiceImpl, SirenVoice, SkidVoice } from '../src/audio/loops';
import { PITCHED, STATIONS } from '../src/audio/composer';
import { inScale, rng } from '../src/audio/theory';
import { type SampleName, registerSample } from '../src/audio/dsp';

const FILES: Record<SampleName, string> = { engine: 'engine.ogg', engineBike: 'engine-motorcycle.ogg', impact: 'impact.ogg', skid: 'skid.ogg' };
const SFX = Object.keys(SFX_META) as SfxName[];
const buffers: Record<string, ArrayBuffer> = {};
const loaded = Promise.all(Object.entries(FILES).map(async ([k, f]) => {
  const r = await fetch(import.meta.env.BASE_URL + 'assets/vehicles/audio/' + f);
  if (r.ok) buffers[k] = await r.arrayBuffer();
}));

// ---------------- analysis ----------------
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len; const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j], ai = im[i + j]; const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci; const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br; im[i + j] = ai + bi; re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
export interface Stats { peak: number; peakDb: number; rmsDb: number; activeSec: number; lowShare: number; centroid: number; centroidHi: number; zcr: number; clipped: number; nan: boolean; windowsRmsDb?: number[] }
function analyse(buf: AudioBuffer, from = 0, to = buf.duration, windowSec = 0): Stats {
  const sr = buf.sampleRate; const a = Math.floor(from * sr), b = Math.min(buf.length, Math.floor(to * sr));
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  let peak = 0, sum = 0, last = 0, clipped = 0, nan = false;
  const mono = new Float64Array(b - a);
  for (let i = a; i < b; i++) {
    let m = 0;
    for (const ch of chans) { const v = ch[i]; if (!Number.isFinite(v)) nan = true; const av = Math.abs(v); if (av > peak) peak = av; if (av > 0.966) clipped++; m += v; }
    m /= chans.length; mono[i - a] = m; sum += m * m; if (Math.abs(m) > 0.001) last = i;
  }
  let zc = 0; for (let i = 1; i < mono.length; i++) if ((mono[i - 1] < 0) !== (mono[i] < 0)) zc++;
  const N = 2048; let low = 0, tot = 0, cen = 0, hiTot = 0, hiCen = 0; const re = new Float64Array(N), im = new Float64Array(N);
  for (let off = 0; off + N <= mono.length; off += N) {
    for (let i = 0; i < N; i++) { re[i] = mono[off + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; const f = k * sr / N; tot += p; cen += p * f; if (f < 200) low += p; if (f >= 150) { hiTot += p; hiCen += p * f; } }
  }
  const out: Stats = { peak, peakDb: 20 * Math.log10(peak + 1e-12), rmsDb: 10 * Math.log10(sum / Math.max(1, mono.length) + 1e-12), activeSec: (last - a) / sr, lowShare: tot ? low / tot : 0, centroid: tot ? cen / tot : 0, centroidHi: hiTot ? hiCen / hiTot : 0, zcr: zc / Math.max(1e-9, mono.length / sr) / 2, clipped, nan };
  if (windowSec > 0) {
    out.windowsRmsDb = []; const w = Math.floor(windowSec * sr);
    for (let o = 0; o + w <= mono.length; o += w) { let s = 0; for (let i = 0; i < w; i++) s += mono[o + i] * mono[o + i]; out.windowsRmsDb.push(+(10 * Math.log10(s / w + 1e-12)).toFixed(1)); }
  }
  return out;
}

async function offlineCore(seconds: number, seed = 1): Promise<{ ctx: OfflineAudioContext; core: AudioCore }> {
  await loaded;
  const ctx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  const core = new AudioCore(ctx, rng(seed));
  core.ambience.set({ night: 0, water: 0, traffic: 0, park: 0, indoors: 1 }, 0.001);
  // silence the ambience entirely for isolated measurements
  core.ambIn.gain.value = 0;
  await Promise.all(Object.entries(buffers).map(async ([k, b]) => { try { registerSample(core.kit, k as SampleName, await ctx.decodeAudioData(b.slice(0))); } catch { /* fallback */ } }));
  return { ctx, core };
}

/** Advance an offline render in steps, calling `fn(t)` at each suspension point. */
async function steppedRender(ctx: OfflineAudioContext, step: number, fn: (t: number) => void): Promise<AudioBuffer> {
  const dur = ctx.length / ctx.sampleRate;
  for (let t = step; t < dur - step / 2; t += step) {
    const tt = Math.round(t * ctx.sampleRate / 128) * 128 / ctx.sampleRate;
    ctx.suspend(tt).then(() => { fn(tt); return ctx.resume(); }).catch(() => undefined);
  }
  fn(0);
  return ctx.startRendering();
}

const audioTest = {
  sfxNames: SFX,
  async samples(): Promise<Record<string, unknown>> {
    const { core } = await offlineCore(0.1); const out: Record<string, unknown> = {};
    for (const [k, b] of Object.entries(core.kit.samples)) { const d = b.getChannelData(0); out[k] = { dur: b.duration, ch: b.numberOfChannels, sr: b.sampleRate, first: d[0], last: d[d.length - 1], win: Array.from({ length: Math.floor(b.duration) }, (_, i) => { const a = analyse(b, i, i + 1); return [Math.round(a.rmsDb), Math.round(a.centroidHi), Math.round(a.zcr)]; }), zcr: analyse(b).zcr, cen: analyse(b).centroidHi, rms: analyse(b).rmsDb }; }
    return out;
  },
  async sfx(name: SfxName, dist = 0, seconds = 3.5): Promise<Stats> {
    const { ctx, core } = await offlineCore(seconds);
    core.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    core.play(name, dist > 0 ? { pos: { x: dist * 0.6, y: 0, z: -dist * 0.8 } } : undefined, 0.05);
    const buf = await ctx.startRendering(); core.flush(); return analyse(buf);
  },
  /** Spam: 100 shots/s of every gun plus explosions and crashes for 3 s. Must not clip, voices must stay bounded. */
  async spam(): Promise<Stats & { maxVoices: number }> {
    const { ctx, core } = await offlineCore(4);
    let maxVoices = 0;
    const buf = await steppedRender(ctx, 0.01, t => {
      if (t > 3) return;
      const guns: SfxName[] = ['pistol', 'smg', 'shotgun', 'rifle'];
      core.play(guns[Math.floor(t * 100) % 4], { pos: { x: (t * 37) % 10 - 5, y: 0, z: -3 }, volume: 2 }, t);
      if (Math.floor(t * 100) % 25 === 0) { core.play('explosion', { pos: { x: 2, y: 0, z: -4 }, volume: 2 }, t); core.play('crash', { volume: 2 }, t); }
      core.tick(0.05); maxVoices = Math.max(maxVoices, core.activeVoices);
    });
    return { ...analyse(buf), maxVoices };
  },
  async radio(station: number, seconds = 32, startAt = 0): Promise<Stats & { notes: number; outOfKey: number; songs: string[]; silentWindows: number }> {
    const { ctx, core } = await offlineCore(seconds, 3 + station);
    let notes = 0, outOfKey = 0; const songs = new Set<string>();
    core.radio.onNote = (e, _t, song) => { notes++; songs.add(`${song.style}${song.ident ? '-ident' : ''}@${song.bpm}`); if (PITCHED.has(e.inst) && !inScale(e.midi, song.root, song.scale)) outOfKey++; };
    // force a deterministic broadcast position
    (core.radio as unknown as { offsets: number[] }).offsets[station] = startAt;
    while (core.radio.station !== station) core.radio.next();
    core.setRadioActive(true);
    const buf = await steppedRender(ctx, 0.1, () => core.tick(0.2));
    const st = analyse(buf, 0.3, seconds, 1);
    return { ...st, notes, outOfKey, songs: [...songs], silentWindows: (st.windowsRmsDb ?? []).filter(v => v < -50).length };
  },
  async mood(m: 'tension' | 'action', seconds = 8): Promise<Stats & { notes: number }> {
    const { ctx, core } = await offlineCore(seconds); let notes = 0; core.mood.onNote = () => { notes++; };
    core.setMood(m);
    const buf = await steppedRender(ctx, 0.1, () => core.tick(0.2));
    return { ...analyse(buf, 2.5), notes };
  },
  /** Engine at low rpm/throttle then high rpm/throttle: returns stats of both halves. */
  async engine(kind: 'car' | 'bike' | 'truck', damage = 0, noSample = false): Promise<{ low: Stats; high: Stats }> {
    const { ctx, core } = await offlineCore(6);
    if (noSample) core.kit.samples = {};
    const v = new EngineVoiceImpl(() => core);
    const buf = await steppedRender(ctx, 0.05, t => {
      const hi = t >= 3; v.update({ rpm: hi ? 0.9 : 0.12, throttle: hi ? 1 : 0.05, pos: { x: 0, y: 0, z: -4 }, kind, damage });
      core.tick(0.1);
    });
    return { low: analyse(buf, 1, 3), high: analyse(buf, 4, 6) };
  },
  async siren(): Promise<Stats> {
    const { ctx, core } = await offlineCore(8); const v = new SirenVoice(() => core);
    const buf = await steppedRender(ctx, 0.05, t => { v.update({ x: -60 + t * 15, y: 0, z: -8 }, 1); core.tick(0.1); });
    return analyse(buf, 0.5);
  },
  async skid(): Promise<{ on: Stats; off: Stats; parked: boolean }> {
    const { ctx, core } = await offlineCore(4); const v = new SkidVoice(() => core); let parked = false;
    const buf = await steppedRender(ctx, 0.05, t => { v.update({ x: 0, y: 0, z: -3 }, t < 2 ? 0.9 : 0); core.tick(0.1); if (t > 3.5) parked = core.skids.active.size === 0; });
    return { on: analyse(buf, 0.3, 1.9), off: analyse(buf, 2.6, 4), parked };
  },
  async ambience(state: { night: number; water: number; traffic: number; park: number; indoors?: number }, seconds = 6): Promise<Stats> {
    const { ctx, core } = await offlineCore(seconds); core.ambIn.gain.value = 0.55; core.ambience.set(state, 0.01);
    const buf = await steppedRender(ctx, 0.1, () => core.tick(0.2));
    return analyse(buf, 1);
  },
  /** Slow-mo / pause routing: world sounds get muffled, UI does not. */
  async mix(name: SfxName, slow: number, paused: boolean): Promise<Stats> {
    const { ctx, core } = await offlineCore(1.5); core.setSlowMo(slow); core.setPaused(paused);
    core.play(name, undefined, 0.3); const buf = await ctx.startRendering(); return analyse(buf, 0.25);
  },
  /** Volume ramps: sfx volume 0 must silence world+UI sounds, music volume must not affect them. */
  async volumes(master: number, music: number, sfx: number): Promise<Stats> {
    const { ctx, core } = await offlineCore(1.5); core.setVolumes(master, music, sfx);
    core.play('pistol', undefined, 0.4); core.play('uiClick', undefined, 0.4); const buf = await ctx.startRendering(); return analyse(buf, 0.3);
  },
  /** Realtime soak: traffic engines, sirens, gunfire, radio hopping and mood changes; tracks internal bounds. */
  async soak(seconds = 60): Promise<Record<string, unknown>> {
    await loaded; const a = new Audio(buffers); await a.resume();
    const core = (a as unknown as { core: AudioCore }).core;
    const engines = Array.from({ length: 12 }, () => a.engine()); const sirens = [a.siren(), a.siren(), a.siren(), a.siren()]; const skid = a.skid();
    a.setRadioActive(true);
    let maxLive = 0, maxLater = 0, maxEng = 0, maxSir = 0, frames = 0, plays = 0; const t0 = performance.now(); let lastHop = 0;
    const gc = (window as unknown as { gc?: () => void }).gc; gc?.();
    const heap0 = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    await new Promise<void>(res => {
      const f = () => {
        frames++; const t = (performance.now() - t0) / 1000;
        a.setListener({ x: Math.sin(t * 0.1) * 50, y: 1.6, z: Math.cos(t * 0.1) * 50 }, { x: Math.cos(t), y: 0, z: Math.sin(t) });
        engines.forEach((e, i) => e.update({ rpm: (Math.sin(t + i) + 1) / 2, throttle: 0.6, pos: { x: Math.sin(t * 0.3 + i) * (10 + i * 12), y: 0, z: Math.cos(t * 0.3 + i) * (10 + i * 12) }, kind: (['car', 'bike', 'truck'] as const)[i % 3], damage: (i % 4) / 4 }));
        sirens.forEach((s, i) => s.update({ x: 30 * Math.sin(t * 0.4 + i), y: 0, z: 40 * Math.cos(t * 0.2 + i) }, 1));
        skid.update({ x: 0, y: 0, z: -3 }, Math.max(0, Math.sin(t * 3)));
        for (let k = 0; k < 3; k++) { a.play(SFX[Math.floor(Math.random() * SFX.length)], { pos: { x: Math.random() * 300 - 150, y: 0, z: Math.random() * 300 - 150 } }); plays++; }
        a.setAmbience({ night: (Math.sin(t * 0.05) + 1) / 2, water: (Math.sin(t * 0.07) + 1) / 2, traffic: 0.6, park: (Math.cos(t * 0.09) + 1) / 2 });
        a.setSlowMo(Math.sin(t * 0.5) > 0.9 ? 1 : 0); a.setPausedMuffle(Math.sin(t * 0.21) > 0.95);
        if (t - lastHop > 7) { lastHop = t; a.radioNext(); a.setMusicMood((['none', 'tension', 'action'] as const)[Math.floor(t / 7) % 3]); a.setRadioActive(Math.floor(t / 7) % 4 !== 3); }
        maxLive = Math.max(maxLive, core.activeVoices); maxLater = Math.max(maxLater, core.pendingLater); maxEng = Math.max(maxEng, core.engines.active.size); maxSir = Math.max(maxSir, core.sirens.active.size);
        if (t < seconds) requestAnimationFrame(f); else res();
      };
      requestAnimationFrame(f);
    });
    engines.forEach(e => e.stop()); sirens.forEach(s => s.stop()); skid.stop(); a.setRadioActive(false); a.setMusicMood('none');
    await new Promise(r => setTimeout(r, 4000)); gc?.();
    const heap1 = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    const end = { live: core.activeVoices, later: core.pendingLater, engines: core.engines.active.size, sirens: core.sirens.active.size, skids: core.skids.active.size, pool: core.pool.size };
    a.dispose();
    return { frames, plays, maxLive, maxLater, maxEng, maxSir, end, heapMB: [(heap0 / 1e6).toFixed(1), (heap1 / 1e6).toFixed(1)] };
  },
  /** Realtime smoke test through the public facade (needs a prior user gesture). */
  async realtime(): Promise<Record<string, unknown>> {
    await loaded;
    const a = new Audio(buffers);
    // everything before resume must be a safe no-op
    a.play('pistol'); a.setVolumes(1, 0.8, 1); a.setAmbience({ night: 0.2, water: 0.3, traffic: 0.6, park: 0.4 }); a.setRadioActive(true); a.setMusicMood('tension');
    const e: EngineVoice = a.engine(); e.update({ rpm: 0.5, throttle: 0.5, pos: { x: 0, y: 0, z: -3 }, kind: 'car', damage: 0.2 });
    await a.resume(); await a.resume();
    const sir: LoopVoice = a.siren(); const sk: LoopVoice = a.skid();
    for (const n of SFX) a.play(n, { pos: { x: 3, y: 0, z: -5 } });
    for (let i = 0; i < 300; i++) a.play('smg', { pos: { x: 1, y: 0, z: -2 } }); // spam in one frame
    const t0 = performance.now(); let frames = 0;
    await new Promise<void>(res => {
      const f = () => {
        frames++; const t = (performance.now() - t0) / 1000;
        a.setListener({ x: 0, y: 1.6, z: 0 }, { x: Math.sin(t), y: 0, z: -Math.cos(t) });
        e.update({ rpm: (Math.sin(t * 2) + 1) / 2, throttle: 0.7, pos: { x: 0, y: 0, z: -3 }, kind: 'car', damage: 0.3 });
        sir.update({ x: 20 * Math.sin(t), y: 0, z: -15 }, 1); sk.update({ x: 0, y: 0, z: -3 }, t % 1 > 0.5 ? 0.8 : 0);
        a.setSlowMo(t > 1.5 && t < 2.5 ? 1 : 0); a.setPausedMuffle(t > 2.5 && t < 3);
        if (t < 4) requestAnimationFrame(f); else res();
      };
      requestAnimationFrame(f);
    });
    const name1 = a.radioNext(); const name2 = a.radioNext(); const name3 = a.radioNext(); const name4 = a.radioNext();
    const mid = a.stats();
    e.stop(); sir.stop(); sk.stop(); e.stop(); e.update({ rpm: 1, throttle: 1, pos: { x: 0, y: 0, z: 0 }, kind: 'truck', damage: 1 });
    a.setMusicMood('none'); a.setRadioActive(false);
    await new Promise(r => setTimeout(r, 1200));
    const end = a.stats(); a.dispose();
    return { frames, stations: [name1, name2, name3, name4], mid, end };
  },
};
(window as unknown as { audioTest: typeof audioTest }).audioTest = audioTest;

// ---------------- interactive UI ----------------
const app = document.getElementById('app')!; const status = document.getElementById('status')!;
let audio: Audio | null = null;
const sect = (title: string) => { const s = document.createElement('section'); const h = document.createElement('h2'); h.textContent = title; s.append(h); app.append(s); return s; };
const btn = (parent: HTMLElement, label: string, fn: () => void) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; parent.append(b); return b; };
const slider = (parent: HTMLElement, label: string, value: number, fn: (v: number) => void, min = 0, max = 1, step = 0.01) => {
  const l = document.createElement('label'); const i = document.createElement('input'); const o = document.createElement('span');
  i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value); o.textContent = String(value);
  i.oninput = () => { o.textContent = i.value; fn(Number(i.value)); }; l.append(label, i, o); parent.append(l); return i;
};

let dist = 5;
const sfxSec = sect('Sound effects');
slider(sfxSec, 'distance m', dist, v => { dist = v; }, 0, 260, 1);
for (const n of SFX) btn(sfxSec, n, () => audio?.play(n, dist > 0 ? { pos: { x: dist * 0.7, y: 0, z: -dist * 0.7 } } : undefined));

const eng = { rpm: 0.2, throttle: 0.2, damage: 0, kind: 'car' as 'car' | 'bike' | 'truck', voice: null as EngineVoice | null };
const engSec = sect('Engine');
btn(engSec, 'start/stop', () => { if (eng.voice) { eng.voice.stop(); eng.voice = null; } else if (audio) eng.voice = audio.engine(); });
for (const k of ['car', 'bike', 'truck'] as const) btn(engSec, k, () => { eng.kind = k; });
slider(engSec, 'rpm', eng.rpm, v => { eng.rpm = v; }); slider(engSec, 'throttle', eng.throttle, v => { eng.throttle = v; }); slider(engSec, 'damage', eng.damage, v => { eng.damage = v; });

const loops = { siren: null as LoopVoice | null, skid: null as LoopVoice | null, skidVol: 0, orbit: true };
const loopSec = sect('Siren & skid');
btn(loopSec, 'siren on/off', () => { if (loops.siren) { loops.siren.stop(); loops.siren = null; } else if (audio) loops.siren = audio.siren(); });
btn(loopSec, 'siren orbit/drive-by', () => { loops.orbit = !loops.orbit; });
btn(loopSec, 'skid on/off', () => { if (loops.skid) { loops.skid.stop(); loops.skid = null; } else if (audio) loops.skid = audio.skid(); });
slider(loopSec, 'skid vol', 0, v => { loops.skidVol = v; });

const amb = { night: 0, water: 0, traffic: 0.5, park: 0, indoors: 0 };
const ambSec = sect('Ambience');
for (const k of Object.keys(amb) as (keyof typeof amb)[]) slider(ambSec, k, amb[k], v => { amb[k] = v; audio?.setAmbience(amb); });

const mixSec = sect('Radio, music & mix');
const radioLabel = document.createElement('div'); radioLabel.textContent = 'station: Afterglow FM'; mixSec.append(radioLabel);
btn(mixSec, 'radio next', () => { radioLabel.textContent = 'station: ' + (audio?.radioNext() ?? 'Radio off'); });
let radioOn = false; btn(mixSec, 'radio active (in car)', () => { radioOn = !radioOn; audio?.setRadioActive(radioOn); });
for (const m of ['none', 'tension', 'action'] as const) btn(mixSec, 'mood ' + m, () => audio?.setMusicMood(m));
let paused = false; btn(mixSec, 'pause muffle', () => { paused = !paused; audio?.setPausedMuffle(paused); });
const vols = [1, 0.7, 1];
slider(mixSec, 'master', 1, v => { vols[0] = v; audio?.setVolumes(vols[0], vols[1], vols[2]); });
slider(mixSec, 'music', 0.7, v => { vols[1] = v; audio?.setVolumes(vols[0], vols[1], vols[2]); });
slider(mixSec, 'sfx', 1, v => { vols[2] = v; audio?.setVolumes(vols[0], vols[1], vols[2]); });
slider(mixSec, 'slow-mo', 0, v => audio?.setSlowMo(v));

document.getElementById('start')!.onclick = async () => {
  await loaded;
  if (!audio) { audio = new Audio(buffers); audio.setAmbience(amb); }
  await audio.resume();
  status.textContent = 'running ' + JSON.stringify(audio.stats());
};

const t0 = performance.now();
const frame = () => {
  const t = (performance.now() - t0) / 1000;
  if (audio) {
    audio.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 });
    eng.voice?.update({ rpm: eng.rpm, throttle: eng.throttle, pos: { x: 0, y: 0.5, z: -4 }, kind: eng.kind, damage: eng.damage });
    loops.siren?.update(loops.orbit ? { x: 25 * Math.sin(t * 0.5), y: 0, z: -25 * Math.cos(t * 0.5) } : { x: ((t * 18) % 240) - 120, y: 0, z: -10 }, 1);
    loops.skid?.update({ x: 2, y: 0, z: -5 }, loops.skidVol);
    if (Math.floor(t * 2) !== Math.floor((t - 0.016) * 2)) status.textContent = 'running ' + JSON.stringify(audio.stats());
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
void STATIONS;
// ?nogesture=1 : prove resume() before any user gesture creates no AudioContext (no autoplay warning)
if (new URLSearchParams(location.search).has('nogesture')) {
  const pre = new Audio({}); pre.play('pistol'); pre.engine().update({ rpm: 0.5, throttle: 0.5, pos: { x: 0, y: 0, z: 0 }, kind: 'car', damage: 0 });
  await pre.resume();
  (window as unknown as { preGesture: unknown }).preGesture = { ...pre.stats(), hasBeenActive: String(navigator.userActivation?.hasBeenActive) };
}
document.title = 'ready';
