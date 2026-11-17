/** Web Audio voices for the procedural music. Each note builds a few short-lived nodes that stop themselves. */
import type { Inst, NoteEv, StyleId } from './composer';
import { midiToFreq } from './theory';
import { type Kit, ahr, bq, gain, glide, noise, osc, perc } from './dsp';

export interface MusicOuts { dry: AudioNode; rev: AudioNode; dly: AudioNode }

function send(src: AudioNode, outs: MusicOuts, rev: number, dly: number, pan = 0): void {
  const ctx = src.context;
  let node: AudioNode = src;
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; src.connect(p); node = p; }
  node.connect(outs.dry);
  if (rev > 0) { const g = ctx.createGain(); g.gain.value = rev; node.connect(g); g.connect(outs.rev); }
  if (dly > 0) { const g = ctx.createGain(); g.gain.value = dly; node.connect(g); g.connect(outs.dly); }
}

/** Plays one note event at time `t`. `sd` = seconds per 16th step. Returns the time the voice is silent. */
export function playNote(k: Kit, outs: MusicOuts, style: StyleId, e: NoteEv, t: number, sd: number): number {
  const ctx = k.ctx; const f = midiToFreq(e.midi); const dur = Math.max(0.03, e.dur * sd); const v = Math.max(0, Math.min(1, e.vel));
  const wob = style === 'lofi' ? (k.rand() - 0.5) * 14 : 0; // tape wobble in cents
  switch (e.inst as Inst) {
    case 'pad': case 'drone': {
      const lp = bq(ctx, 'lowpass', style === 'synthwave' ? 1500 : style === 'tension' ? 700 : 1200, 0.8);
      const g = gain(ctx, 0); const a = Math.min(0.5, dur * 0.3); const end = ahr(g.gain, t, a, v * (e.inst === 'drone' ? 0.05 : 0.045), Math.max(0, dur - a), 0.7);
      for (const d of [-9, 9]) { const o = osc(ctx, 'sawtooth', f, t, end - t + 0.05); o.detune.value = d + wob; o.connect(lp); }
      if (style === 'synthwave') { glide(lp.frequency, t, 900, 2200, dur * 0.8); }
      lp.connect(g); send(g, outs, 0.55, 0); return end;
    }
    case 'arp': {
      const o = osc(ctx, 'square', f, t, 0.3); const lp = bq(ctx, 'lowpass', 3400, 4); glide(lp.frequency, t, 3400, 650, 0.16);
      const g = gain(ctx, 0); const end = perc(g.gain, t, 0.002, v * 0.075, 0.24); o.connect(lp); lp.connect(g); send(g, outs, 0.25, 0.35, e.pan); return end;
    }
    case 'bass': {
      const g = gain(ctx, 0); const funk = style === 'funk'; const lofi = style === 'lofi';
      const lp = bq(ctx, 'lowpass', funk ? 2400 : lofi ? 650 : 900, funk ? 7 : 1);
      glide(lp.frequency, t, funk ? 2400 : lofi ? 650 : 900, funk ? 340 : lofi ? 500 : 320, funk ? 0.09 : 0.2);
      const hold = Math.max(0.02, dur * 0.75); const end = ahr(g.gain, t, 0.004, v * (lofi ? 0.26 : 0.2), hold, 0.06);
      const o = osc(ctx, funk ? 'square' : lofi ? 'triangle' : 'sawtooth', f, t, end - t + 0.03); o.detune.value = wob;
      const sub = osc(ctx, 'sine', f, t, end - t + 0.03); const sg = gain(ctx, 0.7);
      o.connect(lp); lp.connect(g); sub.connect(sg); sg.connect(g); send(g, outs, 0, 0); return end;
    }
    case 'lead': {
      const lp = bq(ctx, 'lowpass', style === 'funk' ? 3200 : 2700, 1.4); const g = gain(ctx, 0);
      const end = ahr(g.gain, t, 0.012, v * 0.06, Math.max(0.02, dur - 0.03), 0.18);
      const vib = osc(ctx, 'sine', 5.4, t, end - t + 0.05); const vg = gain(ctx, 0); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(9, t + Math.min(0.4, dur)); vib.connect(vg);
      const types: OscillatorType[] = style === 'funk' ? ['square', 'sawtooth'] : ['sawtooth', 'square'];
      types.forEach((ty, i) => { const o = osc(ctx, ty, f * (i === 1 && style === 'funk' ? 0.5 : 1), t, end - t + 0.05); o.detune.value = i ? -6 : 6; vg.connect(o.detune); o.connect(lp); });
      lp.connect(g); send(g, outs, 0.3, 0.38, 0.1); return end;
    }
    case 'keys': {
      const lp = bq(ctx, 'lowpass', 2400, 0.7); const g = gain(ctx, 0); const end = perc(g.gain, t, 0.004, v * 0.07, dur + 0.9);
      const a = osc(ctx, 'sine', f, t, end - t + 0.05); const b = osc(ctx, 'triangle', f, t, end - t + 0.05); const c = osc(ctx, 'sine', f * 2, t, 0.4);
      a.detune.value = wob; b.detune.value = wob + 4; const cg = gain(ctx, 0); perc(cg.gain, t, 0.002, 0.35, 0.3); c.connect(cg); cg.connect(lp);
      const bg = gain(ctx, 0.4); a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(g); send(g, outs, 0.35, 0); return end;
    }
    case 'bell': {
      const g = gain(ctx, 0); const end = perc(g.gain, t, 0.002, v * 0.065, Math.max(0.8, dur));
      const a = osc(ctx, 'sine', f, t, end - t + 0.05); a.detune.value = wob; const b = osc(ctx, 'sine', f * 3.01, t, 0.5); const bg = gain(ctx, 0); perc(bg.gain, t, 0.002, 0.25, 0.4);
      a.connect(g); b.connect(bg); bg.connect(g); send(g, outs, 0.45, 0.3, -0.15); return end;
    }
    case 'clav': {
      const o = osc(ctx, 'square', f, t, 0.2); const bp = bq(ctx, 'bandpass', 1500, 1.8); const g = gain(ctx, 0); const end = perc(g.gain, t, 0.001, v * 0.08, 0.1);
      o.connect(bp); bp.connect(g); send(g, outs, 0.1, 0, e.pan); return end;
    }
    case 'stab': {
      const lp = bq(ctx, 'lowpass', 500, 1.2); lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(2600, t + 0.05); lp.frequency.setTargetAtTime(1200, t + 0.06, 0.1);
      const g = gain(ctx, 0); const end = ahr(g.gain, t, 0.025, v * 0.05, Math.max(0.02, dur - 0.05), 0.15);
      for (const d of [-8, 8]) { const o = osc(ctx, 'sawtooth', f, t, end - t + 0.05); o.detune.value = d; o.connect(lp); }
      lp.connect(g); send(g, outs, 0.35, 0); return end;
    }
    case 'kick': {
      const soft = style === 'lofi' || style === 'tension';
      const o = osc(ctx, 'sine', soft ? 120 : 150, t, 0.45); glide(o.frequency, t, soft ? 120 : 150, soft ? 42 : 46, soft ? 0.1 : 0.08);
      const g = gain(ctx, 0); const end = perc(g.gain, t, 0.001, v * (soft ? 0.55 : 0.75), soft ? 0.38 : 0.32); o.connect(g);
      if (!soft) { const n = noise(k, t, 0.02); const hp = bq(ctx, 'highpass', 1500); const ng = gain(ctx, 0); perc(ng.gain, t, 0.0005, v * 0.12, 0.012); n.connect(hp); hp.connect(ng); ng.connect(g); }
      if (soft) { const lp = bq(ctx, 'lowpass', 400); g.connect(lp); send(lp, outs, 0, 0); } else send(g, outs, 0.04, 0);
      return end;
    }
    case 'snare': {
      const gated = style === 'synthwave';
      const n = noise(k, t, 0.4); const f1 = bq(ctx, gated ? 'bandpass' : 'lowpass', gated ? 1900 : 3200, gated ? 0.6 : 0.7);
      const g = gain(ctx, 0); const end = gated ? ahr(g.gain, t, 0.001, v * 0.22, 0.14, 0.03) : perc(g.gain, t, 0.001, v * 0.2, 0.14);
      n.connect(f1); f1.connect(g);
      const o = osc(ctx, 'triangle', gated ? 190 : 210, t, 0.12); const og = gain(ctx, 0); perc(og.gain, t, 0.001, v * 0.18, 0.08); o.connect(og); og.connect(g);
      send(g, outs, gated ? 0.5 : 0.2, 0, 0); return end;
    }
    case 'clap': {
      const n = noise(k, t, 0.3); const bp = bq(ctx, 'bandpass', 1200, 0.9); const g = gain(ctx, 0);
      g.gain.setValueAtTime(0, t); for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(v * 0.25, t + i * 0.011); g.gain.setTargetAtTime(0.02, t + i * 0.011 + 0.002, 0.003); }
      g.gain.setValueAtTime(v * 0.22, t + 0.034); g.gain.setTargetAtTime(0, t + 0.034, 0.03); g.gain.setValueAtTime(0, t + 0.25);
      n.connect(bp); bp.connect(g); send(g, outs, 0.35, 0); return t + 0.25;
    }
    case 'hat': case 'ohat': case 'rim': {
      if (e.inst === 'rim') { const o = osc(ctx, 'triangle', 1700, t, 0.05); const g = gain(ctx, 0); const end = perc(g.gain, t, 0.0005, v * 0.12, 0.03); o.connect(g); send(g, outs, 0.2, 0, -0.2); return end; }
      const n = noise(k, t, 0.3); const hp = bq(ctx, style === 'lofi' ? 'bandpass' : 'highpass', style === 'lofi' ? 6500 : 7500, style === 'lofi' ? 0.8 : 0.7);
      const g = gain(ctx, 0); const end = perc(g.gain, t, 0.0008, v * (style === 'lofi' ? 0.08 : 0.07), e.inst === 'ohat' ? 0.22 : 0.045);
      n.connect(hp); hp.connect(g); send(g, outs, 0.05, 0, e.pan); return end;
    }
  }
  return t;
}
