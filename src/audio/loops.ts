/** Continuous positional voices: vehicle engines, police sirens and tyre skids. All are safe to use before resume(). */
import type { EngineVoice, LoopVoice, Vec3Like } from '../ui/contracts';
import type { AudioCore } from './core';
import { bq, gain, osc } from './dsp';
import { CULL_DISTANCE, dopplerRatio, isFiniteVec } from './spatial';
import { safe } from './theory';
import { fadeOutParam } from './declick';

type CoreRef = () => AudioCore | null;
type Kind = 'car' | 'bike' | 'truck';
type UpdateOpts = { rpm: number; throttle: number; pos: Vec3Like; kind: 'car' | 'bike' | 'truck' | 'heli'; damage: number };

/** Engine voices farther than this are parked (no nodes). */
export const ENGINE_RANGE = 120;

const lerp = (a: readonly [number, number], t: number) => a[0] + (a[1] - a[0]) * t;
const ENGINE_KIND: Record<Kind, { rate: [number, number]; f0: [number, number]; rumble: number; lp: [number, number]; level: number }> = {
  car: { rate: [0.62, 1.75], f0: [30, 120], rumble: 0.32, lp: [900, 4200], level: 0.42 },
  truck: { rate: [0.45, 1.12], f0: [19, 64], rumble: 0.55, lp: [550, 2400], level: 0.46 },
  bike: { rate: [0.7, 2.0], f0: [42, 170], rumble: 0.2, lp: [1300, 5600], level: 0.4 },
};

interface EngineNodes {
  out: GainNode; panner: PannerNode; src: AudioBufferSourceNode | null; tone: BiquadFilterNode;
  rumble: OscillatorNode; sub: OscillatorNode; rumbleGain: GainNode; synth: OscillatorNode[];
  rattleLfo: OscillatorNode; rattleGain: GainNode; noise: AudioBufferSourceNode; all: AudioNode[]; sources: AudioScheduledSourceNode[];
}

function releaseNodes(c: AudioCore, out: GainNode, sources: AudioScheduledSourceNode[], all: AudioNode[], fade = 0.05): void {
  const now = c.ctx.currentTime;
  fadeOutParam(out.gain, now, Math.max(fade, 0.03));
  for (const s of sources) { try { s.stop(now + fade + 0.1); } catch { /* already stopped */ } }
  c.later(now + fade + 0.2, () => { for (const n of all) { try { n.disconnect(); } catch { /* ignore */ } } });
}

export class EngineVoiceImpl implements EngineVoice {
  private n: EngineNodes | null = null; private stopped = false; private kind: Kind = 'car'; private withSample = false;
  constructor(private core: CoreRef) {}

  private rotor: RotorVoice | null = null;
  update(o: UpdateOpts): void {
    if (this.stopped || !o) return; const c = this.core(); if (!c || !isFiniteVec(o.pos)) return;
    if (o.kind === 'heli') { (this.rotor ??= new RotorVoice(this.core)).update(o); return; }
    const kind: Kind = o.kind === 'bike' || o.kind === 'truck' ? o.kind : 'car';
    const rpm = safe(o.rpm, 0, 1, 0), thr = safe(o.throttle, 0, 1, 0), dmg = safe(o.damage, 0, 1, 0);
    const d = c.distanceTo(o.pos);
    if (!(d < ENGINE_RANGE) || !c.engines.request(this, d, c.ctx.currentTime)) { this.park(); return; }
    const hasSample = !!c.kit.samples[kind === 'bike' ? 'engineBike' : 'engine'];
    if (this.n && (kind !== this.kind || hasSample !== this.withSample)) this.drop(c, 0.08);
    if (!this.n) { if (!c.allowEngineBuild()) return; this.build(c, kind, hasSample, o.pos); }
    const n = this.n; if (!n) return;
    const K = ENGINE_KIND[kind]; const now = c.ctx.currentTime; const tc = 0.06; const pm = c.pitchMul;
    c.placePanner(n.panner, o.pos, 0.03);
    n.src?.playbackRate.setTargetAtTime(lerp(K.rate, rpm) * pm, now, tc);
    const f0 = lerp(K.f0, rpm) * pm;
    n.rumble.frequency.setTargetAtTime(f0, now, tc); n.sub.frequency.setTargetAtTime(f0 * 0.5, now, tc);
    n.synth.forEach((s, i) => s.frequency.setTargetAtTime(f0 * (i + 2), now, tc));
    n.tone.frequency.setTargetAtTime(lerp(K.lp, 0.35 * rpm + 0.65 * thr) * (1 - 0.3 * dmg), now, tc);
    n.rumbleGain.gain.setTargetAtTime(K.rumble * (0.6 + 0.4 * thr), now, tc);
    n.out.gain.setTargetAtTime(K.level * (0.42 + 0.33 * thr + 0.25 * rpm), now, tc);
    n.rattleGain.gain.setTargetAtTime(dmg * 0.22 * (0.4 + 0.6 * rpm), now, 0.1);
    n.rattleLfo.frequency.setTargetAtTime(6 + rpm * 24, now, tc);
  }

  private build(c: AudioCore, kind: Kind, hasSample: boolean, pos: Vec3Like): void {
    const ctx = c.ctx; const now = ctx.currentTime; const k = c.kit;
    this.kind = kind; this.withSample = hasSample;
    const out = gain(ctx, 0); const panner = c.makePanner(false); c.placePanner(panner, pos); out.connect(panner); panner.connect(c.sfxIn);
    const tone = bq(ctx, 'lowpass', 2000, 0.9); tone.connect(out);
    const sources: AudioScheduledSourceNode[] = []; const all: AudioNode[] = [out, panner, tone];
    let src: AudioBufferSourceNode | null = null; const synth: OscillatorNode[] = [];
    const buf = k.samples[kind === 'bike' ? 'engineBike' : 'engine'];
    if (hasSample && buf) {
      src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = ENGINE_KIND[kind].rate[0];
      const sg = gain(ctx, 0.9); src.connect(sg); sg.connect(tone); src.start(now, k.rand() * buf.duration); sources.push(src); all.push(sg);
    } else {
      // synth fallback: firing harmonics through a body resonance and a soft saturator
      const bp = bq(ctx, 'bandpass', 520, 0.8); const ws = ctx.createWaveShaper(); ws.curve = k.soft; const sg = gain(ctx, 0.28);
      for (let i = 0; i < 2; i++) { const o = osc(ctx, 'sawtooth', 60 * (i + 2), now, 1e7); o.detune.value = i ? -7 : 5; o.connect(bp); synth.push(o); sources.push(o); }
      bp.connect(ws); ws.connect(sg); sg.connect(tone); all.push(bp, ws, sg);
    }
    // low rumble layer (always)
    const rumble = osc(ctx, 'sawtooth', 40, now, 1e7); const sub = osc(ctx, 'sine', 20, now, 1e7);
    const rlp = bq(ctx, 'lowpass', 240, 0.7); const rumbleGain = gain(ctx, 0); const subG = gain(ctx, 0.8);
    rumble.connect(rlp); sub.connect(subG); subG.connect(rlp); rlp.connect(rumbleGain); rumbleGain.connect(out);
    sources.push(rumble, sub); all.push(rlp, rumbleGain, subG);
    // damage rattle: band-passed noise chopped by an rpm-locked square LFO
    const noise = ctx.createBufferSource(); noise.buffer = k.white; noise.loop = true; noise.start(now, k.rand());
    const nbp = bq(ctx, 'bandpass', 1500, 2.2); const chop = gain(ctx, 0.5); const rattleLfo = osc(ctx, 'square', 10, now, 1e7); const lfoG = gain(ctx, 0.5);
    const rattleGain = gain(ctx, 0); rattleLfo.connect(lfoG); lfoG.connect(chop.gain);
    noise.connect(nbp); nbp.connect(chop); chop.connect(rattleGain); rattleGain.connect(out);
    sources.push(noise, rattleLfo); all.push(nbp, chop, lfoG, rattleGain);
    this.n = { out, panner, src, tone, rumble, sub, rumbleGain, synth, rattleLfo, rattleGain, noise, all, sources };
  }

  private drop(c: AudioCore, fade: number): void { const n = this.n; if (!n) return; this.n = null; releaseNodes(c, n.out, n.sources, n.all, fade); }

  /** Release nodes but stay usable (out of range or slot taken by a closer engine). */
  park(): void { const c = this.core(); if (!c) return; c.engines.release(this); this.drop(c, 0.08); }

  stop(): void { if (this.stopped) return; this.stopped = true; this.rotor?.stop(); const c = this.core(); if (!c) return; c.engines.release(this); this.drop(c, 0.15); }
}

interface SirenNodes { out: GainNode; panner: PannerNode; oscs: OscillatorNode[]; lfo: OscillatorNode; depth: GainNode; all: AudioNode[]; sources: AudioScheduledSourceNode[] }

/** Original wail/yelp siren: a triangle+square pair swept by an LFO, alternating patterns, with Doppler shift. */
export class SirenVoice implements LoopVoice {
  private n: SirenNodes | null = null; private stopped = false;
  /** 0 = auto wail/yelp cycle (AI units), 1 wail, 2 yelp, 3 phaser (driver's choice) */
  tone = 0;
  private mode: 'wail' | 'yelp' | 'phaser' = 'wail'; private modeUntil = 0; private lastD = -1; private lastT = 0; private cents = 0;
  constructor(private core: CoreRef) {}
  update(pos: Vec3Like, volume: number): void {
    if (this.stopped) return; const c = this.core(); if (!c || !isFiniteVec(pos)) return;
    const vol = safe(volume, 0, 1, 0); const d = c.distanceTo(pos);
    if (!(d < CULL_DISTANCE) || vol <= 0.001 || !c.sirens.request(this, d, c.ctx.currentTime)) { this.park(); return; }
    if (!this.n) this.build(c, pos);
    const n = this.n; if (!n) return; const now = c.ctx.currentTime;
    c.placePanner(n.panner, pos, 0.03);
    if (this.tone > 0) {
      const want = this.tone === 1 ? 'wail' : this.tone === 2 ? 'yelp' : 'phaser';
      if (want !== this.mode || this.modeUntil === 0) { this.setMode(n, now, want); this.modeUntil = Infinity; }
    } else if (now >= this.modeUntil) this.setMode(n, now, this.modeUntil === 0 || this.mode === 'phaser' ? 'wail' : this.mode === 'wail' ? 'yelp' : 'wail');
    if (this.lastD >= 0 && now > this.lastT + 0.02) {
      const vr = (d - this.lastD) / (now - this.lastT);
      this.cents += (1200 * Math.log2(dopplerRatio(vr)) - this.cents) * 0.3;
    }
    if (now > this.lastT + 0.02) { this.lastD = d; this.lastT = now; }
    const det = this.cents + 1200 * Math.log2(c.pitchMul);
    for (const o of n.oscs) o.detune.setTargetAtTime(det, now, 0.08);
    n.out.gain.setTargetAtTime(vol * 0.32, now, 0.05);
  }
  private setMode(n: SirenNodes, now: number, mode: 'wail' | 'yelp' | 'phaser'): void {
    this.mode = mode; this.modeUntil = now + (mode === 'wail' ? 7.2 : 2.6);
    // phaser: a fast saw-like down-sweep around 700 Hz (the electronic "whoop-whoop" of a modern bar)
    n.lfo.type = mode === 'wail' ? 'sine' : mode === 'yelp' ? 'triangle' : 'sawtooth';
    n.lfo.frequency.setValueAtTime(mode === 'wail' ? 0.27 : mode === 'yelp' ? 3.3 : 9.5, now);
    n.depth.gain.setTargetAtTime(mode === 'wail' ? 340 : mode === 'yelp' ? 260 : 380, now, 0.03);
    for (const o of n.oscs) o.frequency.setTargetAtTime(mode === 'wail' ? 960 : mode === 'yelp' ? 1060 : 760, now, 0.03);
  }
  private build(c: AudioCore, pos: Vec3Like): void {
    const ctx = c.ctx; const now = ctx.currentTime;
    const out = gain(ctx, 0); const panner = c.makePanner(false); c.placePanner(panner, pos); out.connect(panner); panner.connect(c.sfxIn);
    const bp = bq(ctx, 'bandpass', 1350, 0.55); const ws = ctx.createWaveShaper(); ws.curve = c.kit.soft; const post = gain(ctx, 0.7);
    bp.connect(ws); ws.connect(post); post.connect(out);
    const lfo = osc(ctx, 'sine', 0.27, now, 1e7); const depth = gain(ctx, 340); lfo.connect(depth);
    const a = osc(ctx, 'triangle', 960, now, 1e7); const b = osc(ctx, 'square', 960, now, 1e7); const bg = gain(ctx, 0.14);
    depth.connect(a.frequency); depth.connect(b.frequency); a.connect(bp); b.connect(bg); bg.connect(bp);
    this.n = { out, panner, oscs: [a, b], lfo, depth, all: [out, panner, bp, ws, post, depth, bg], sources: [lfo, a, b] };
    this.modeUntil = 0; this.lastD = -1;
  }
  park(): void { const c = this.core(); if (!c) return; c.sirens.release(this); const n = this.n; if (!n) return; this.n = null; releaseNodes(c, n.out, n.sources, n.all, 0.1); }
  stop(): void { if (this.stopped) return; this.park(); this.stopped = true; }
}

interface SkidNodes { out: GainNode; panner: PannerNode; src: AudioBufferSourceNode | null; osc: OscillatorNode | null; all: AudioNode[]; sources: AudioScheduledSourceNode[] }

/** Looping tyre squeal from the skid sample (synth fallback), volume-controlled, parked when silent. */
export class SkidVoice implements LoopVoice {
  private n: SkidNodes | null = null; private stopped = false; private quietSince = -1;
  constructor(private core: CoreRef) {}
  update(pos: Vec3Like, volume: number): void {
    if (this.stopped) return; const c = this.core(); if (!c || !isFiniteVec(pos)) return;
    const vol = safe(volume, 0, 1, 0); const now = c.ctx.currentTime; const d = c.distanceTo(pos);
    if (!(d < CULL_DISTANCE)) { this.park(); return; }
    if (vol < 0.01) {
      if (!this.n) return;
      if (this.quietSince < 0) this.quietSince = now;
      this.n.out.gain.setTargetAtTime(0, now, 0.04);
      if (now - this.quietSince > 0.4) this.park();
      return;
    }
    this.quietSince = -1;
    if (!c.skids.request(this, d, now)) { this.park(); return; }
    if (!this.n) this.build(c, pos);
    const n = this.n; if (!n) return;
    c.placePanner(n.panner, pos, 0.03);
    n.src?.playbackRate.setTargetAtTime((0.9 + 0.2 * vol) * c.pitchMul, now, 0.05);
    n.osc?.frequency.setTargetAtTime((880 + 260 * vol) * c.pitchMul, now, 0.05);
    n.out.gain.setTargetAtTime(vol * 0.6, now, 0.04);
  }
  private build(c: AudioCore, pos: Vec3Like): void {
    const ctx = c.ctx; const now = ctx.currentTime; const k = c.kit;
    const out = gain(ctx, 0); const panner = c.makePanner(false); c.placePanner(panner, pos); out.connect(panner); panner.connect(c.sfxIn);
    const all: AudioNode[] = [out, panner]; const sources: AudioScheduledSourceNode[] = [];
    let src: AudioBufferSourceNode | null = null, o: OscillatorNode | null = null;
    const buf = k.samples.skid;
    if (buf) { src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.start(now, k.rand() * buf.duration); src.connect(out); sources.push(src); }
    else {
      o = osc(ctx, 'sawtooth', 950, now, 1e7); const lfo = osc(ctx, 'sine', 7, now, 1e7); const lg = gain(ctx, 35); lfo.connect(lg); lg.connect(o.frequency);
      const bp = bq(ctx, 'bandpass', 1900, 3); const ws = ctx.createWaveShaper(); ws.curve = k.soft; const g = gain(ctx, 0.3);
      o.connect(bp); bp.connect(ws); ws.connect(g); g.connect(out); sources.push(o, lfo); all.push(lg, bp, ws, g);
    }
    this.n = { out, panner, src, osc: o, all, sources };
  }
  park(): void { const c = this.core(); if (!c) return; c.skids.release(this); const n = this.n; if (!n) return; this.n = null; this.quietSince = -1; releaseNodes(c, n.out, n.sources, n.all, 0.08); }
  stop(): void { if (this.stopped) return; this.park(); this.stopped = true; }
}

interface RotorNodes { out: GainNode; panner: PannerNode; slap: OscillatorNode; slapG: GainNode; whine: OscillatorNode; whineG: GainNode; wash: GainNode; all: AudioNode[]; sources: AudioScheduledSourceNode[] }

/**
 * Helicopter: blade slap (a pulse train at blade-pass rate shaping low-passed noise, with the double "wop" of a two-blade
 * rotor), a turbine whine that rises with power, and a broadband rotor wash. rpm 0..1 sets blade-pass 4..22 Hz.
 */
export class RotorVoice {
  private n: RotorNodes | null = null; private stopped = false;
  constructor(private core: CoreRef) {}
  update(o: UpdateOpts): void {
    if (this.stopped) return; const c = this.core(); if (!c) return;
    const d = c.distanceTo(o.pos);
    if (!(d < 220) || !c.engines.request(this, d, c.ctx.currentTime)) { this.park(); return; }
    if (!this.n) { if (!c.allowEngineBuild()) return; this.build(c, o.pos); }
    const n = this.n; if (!n) return; const now = c.ctx.currentTime; const tc = 0.08;
    const rpm = safe(o.rpm, 0, 1, 0), thr = safe(o.throttle, 0, 1, 0), dmg = safe(o.damage, 0, 1, 0);
    c.placePanner(n.panner, o.pos, 0.04);
    const bpf = (4 + 18 * rpm) * c.pitchMul;
    n.slap.frequency.setTargetAtTime(bpf, now, tc);
    n.slapG.gain.setTargetAtTime(0.5 + 0.5 * thr + 0.3 * dmg, now, tc);
    n.whine.frequency.setTargetAtTime((900 + 1900 * rpm) * c.pitchMul, now, tc);
    n.whineG.gain.setTargetAtTime(0.02 + 0.07 * rpm * (0.5 + 0.5 * thr), now, tc);
    n.wash.gain.setTargetAtTime(0.1 + 0.3 * thr * rpm, now, tc);
    n.out.gain.setTargetAtTime(0.5 * (0.3 + 0.7 * rpm), now, tc);
  }
  private build(c: AudioCore, pos: Vec3Like): void {
    const ctx = c.ctx; const now = ctx.currentTime; const k = c.kit;
    const out = gain(ctx, 0); const panner = c.makePanner(false); c.placePanner(panner, pos); out.connect(panner); panner.connect(c.sfxIn);
    const sources: AudioScheduledSourceNode[] = []; const all: AudioNode[] = [out, panner];
    // blade slap: noise gated by a soft pulse (square LFO → low-pass makes rounded thumps), plus a body thump an octave under
    const nz = ctx.createBufferSource(); nz.buffer = k.brown; nz.loop = true; nz.start(now, k.rand() * 2); sources.push(nz);
    const nlp = bq(ctx, 'lowpass', 520, 0.8); const gate = gain(ctx, 0.5); const slap = osc(ctx, 'square', 10, now, 1e7); const sl = bq(ctx, 'lowpass', 40, 0.5); const slapG = gain(ctx, 0.5);
    const slapTone = gain(ctx, 0.5); slap.connect(sl); sl.connect(slapG); slapG.connect(gate.gain); nz.connect(nlp); nlp.connect(gate); gate.connect(slapTone); slapTone.connect(out);
    const thump = osc(ctx, 'sine', 55, now, 1e7); const tg = gain(ctx, 0.0); slapG.connect(tg.gain); thump.connect(tg); tg.connect(out); sources.push(slap, thump);
    // turbine whine
    const whine = osc(ctx, 'sawtooth', 1200, now, 1e7); const wbp = bq(ctx, 'bandpass', 2200, 3); const whineG = gain(ctx, 0.03); whine.connect(wbp); wbp.connect(whineG); whineG.connect(out); sources.push(whine);
    // rotor wash: band-passed white noise
    const wn = ctx.createBufferSource(); wn.buffer = k.white; wn.loop = true; wn.start(now, k.rand()); const wbp2 = bq(ctx, 'bandpass', 900, 0.5); const wash = gain(ctx, 0.2); wn.connect(wbp2); wbp2.connect(wash); wash.connect(out); sources.push(wn);
    all.push(nlp, gate, sl, slapG, slapTone, tg, wbp, whineG, wbp2, wash);
    this.n = { out, panner, slap, slapG, whine, whineG, wash, all, sources };
  }
  park(): void { const c = this.core(); if (!c) return; c.engines.release(this); const n = this.n; if (!n) return; this.n = null; releaseNodes(c, n.out, n.sources, n.all, 0.1); }
  stop(): void { if (this.stopped) return; this.park(); this.stopped = true; }
}
