/** Minimal synthesized engine, wind, tyre and crash sounds for the highway mode (no assets). */
export class HighwayAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode[] = [];
  private engGain!: GainNode; private windGain!: GainNode; private lp!: BiquadFilterNode; private master!: GainNode;
  private noise!: AudioBuffer;
  constructor(private volume = 0.5) {}
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 600; this.lp.connect(this.master);
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0; this.engGain.connect(this.lp);
    for (const [type, mul] of [['sawtooth', 1], ['square', 0.5], ['sawtooth', 2.01]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 50 * mul; (o as OscillatorNode & { mul: number }).mul = mul;
      const g = ctx.createGain(); g.gain.value = mul === 2.01 ? 0.15 : 0.5; o.connect(g); g.connect(this.engGain); o.start(); this.osc.push(o);
    }
    const len = ctx.sampleRate * 2; this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.4;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0; src.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.master); src.start();
  }
  update(speedMps: number, throttle: number, paused: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 0.25 + ((speedMps * 0.55) % 9) / 14 + throttle * 0.12; // fake gearbox: rpm climbs then drops at each shift
    const f = 38 + rpm * 120;
    this.osc.forEach((o, i) => o.frequency.setTargetAtTime(f * [1, 0.5, 2.01][i], t, 0.05));
    this.engGain.gain.setTargetAtTime(paused ? 0 : 0.12 + throttle * 0.1, t, 0.08);
    this.lp.frequency.setTargetAtTime(380 + throttle * 900 + speedMps * 8, t, 0.1);
    this.windGain.gain.setTargetAtTime(paused ? 0 : Math.min(0.28, (speedMps / 70) ** 2 * 0.3), t, 0.15);
  }
  crash(power: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise;
    const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + power * 120;
    g.gain.setValueAtTime(Math.min(1, 0.25 + power * 0.05), ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(); src.stop(ctx.currentTime + 0.8);
  }
  honk(on: boolean): void {
    if (!this.ctx) return;
    if (on && !this.horn) {
      const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0.18; g.connect(this.master);
      const a = ctx.createOscillator(), b = ctx.createOscillator(); a.type = b.type = 'square'; a.frequency.value = 420; b.frequency.value = 520; a.connect(g); b.connect(g); a.start(); b.start();
      this.horn = { stop: () => { a.stop(); b.stop(); g.disconnect(); } };
    } else if (!on && this.horn) { this.horn.stop(); this.horn = null; }
  }
  private horn: { stop(): void } | null = null;
  setPaused(p: boolean): void { if (!this.ctx) return; if (p) void this.ctx.suspend(); else void this.ctx.resume(); }
  dispose(): void { this.honk(false); void this.ctx?.close(); this.ctx = null; }
}
