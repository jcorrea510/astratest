/**
 * Game-facing audio facade (implements GameAudio from src/ui/contracts.ts).
 *
 * Nothing touches Web Audio until resume() is called after a user gesture, so there are never autoplay warnings.
 * Every method is safe to call before resume(): state is remembered and applied once the context exists;
 * one-shot sounds requested before then are dropped.
 */
import type { EngineVoice, GameAudio, LoopVoice, SfxName, Vec3Like } from '../ui/contracts';
import { AudioCore } from './core';
import { type SampleName, registerSample } from './dsp';
import { EngineVoiceImpl, SirenVoice, SkidVoice } from './loops';
import { STATIONS } from './composer';
import { isFiniteVec } from './spatial';

type AmbienceArg = { night: number; water: number; traffic: number; park: number; indoors?: number };
type Mood = 'none' | 'tension' | 'action';
const SAMPLE_KEYS: readonly SampleName[] = ['engine', 'engineBike', 'impact', 'skid'];

interface AudioCtor { new (opts?: AudioContextOptions): AudioContext }

export class Audio implements GameAudio {
  private ctx: AudioContext | null = null;
  private core: AudioCore | null = null;
  private resuming: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0; private tickGap = 0.025;
  // remembered state (applied when the context is created)
  private vols: [number, number, number] = [1, 0.7, 1];
  private lis = { pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 } };
  private amb: AmbienceArg = { night: 0, water: 0, traffic: 0.5, park: 0 };
  private radioActive = false; private station = 0; private slow = 0; private paused = false; private mood: Mood = 'none';

  constructor(private buffers: Record<string, ArrayBuffer>) {}

  /** Must be called from a user gesture. Idempotent; never throws or rejects. */
  resume(): Promise<void> {
    if (this.resuming) return this.resuming;
    const p = this.doResume().catch(() => undefined).finally(() => { this.resuming = null; });
    this.resuming = p; return p;
  }

  private async doResume(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const AC = w.AudioContext ?? w.webkitAudioContext; if (!AC) return;
      // Avoid the browser's autoplay warning: only create the context once the page has had a user gesture.
      const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
      if (ua && !ua.hasBeenActive) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const core = new AudioCore(ctx);
      this.core = core;
      core.setVolumes(...this.vols);
      core.setListener(this.lis.pos, this.lis.fwd);
      core.ambience.set(this.amb, 0.3);
      core.setSlowMo(this.slow); core.setPaused(this.paused);
      while (core.radio.station !== this.station) core.radio.next();
      core.setRadioActive(this.radioActive);
      core.setMood(this.mood);
      this.decodeSamples(ctx, core);
      this.lastTick = performance.now();
      this.timer = setInterval(() => this.tick(), 25);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  private decodeSamples(ctx: AudioContext, core: AudioCore): void {
    for (const key of SAMPLE_KEYS) {
      const buf = this.buffers?.[key];
      if (!(buf instanceof ArrayBuffer) || buf.byteLength === 0) continue;
      let copy: ArrayBuffer;
      try { copy = buf.slice(0); } catch { continue; }
      // Callback form + promise guard: works in old Safari and never surfaces an unhandled rejection.
      try {
        const pr = ctx.decodeAudioData(copy, b => { try { registerSample(core.kit, key, b); } catch { /* keep synth fallback */ } }, () => undefined);
        if (pr && typeof pr.catch === 'function') pr.catch(() => undefined);
      } catch { /* undecodable: synth fallbacks are used */ }
    }
  }

  private tick(): void {
    const core = this.core; if (!core || !this.ctx) return;
    const t = performance.now(); const gap = (t - this.lastTick) / 1000; this.lastTick = t;
    this.tickGap = this.tickGap * 0.8 + Math.min(1, gap) * 0.2;
    if (this.ctx.state !== 'running') return;
    const ahead = Math.min(1.2, Math.max(0.12, Math.max(gap, this.tickGap) * 1.6 + 0.04));
    try { core.tick(ahead); } catch { /* never let audio break the game loop */ }
  }

  setVolumes(master: number, music: number, sfx: number): void { this.vols = [master, music, sfx]; this.core?.setVolumes(master, music, sfx); }

  setListener(pos: Vec3Like, forward: Vec3Like): void {
    if (!isFiniteVec(pos)) return;
    this.lis.pos = { x: pos.x, y: pos.y, z: pos.z };
    if (isFiniteVec(forward)) this.lis.fwd = { x: forward.x, y: forward.y, z: forward.z };
    this.core?.setListener(this.lis.pos, this.lis.fwd);
  }

  play(name: SfxName, opts?: { pos?: Vec3Like; volume?: number; pitch?: number }): void {
    const core = this.core; if (!core || this.ctx?.state !== 'running') return;
    try { core.play(name, opts); } catch { /* ignore */ }
  }

  engine(): EngineVoice { return new EngineVoiceImpl(() => this.core); }
  siren(): LoopVoice { return new SirenVoice(() => this.core); }
  skid(): LoopVoice { return new SkidVoice(() => this.core); }

  setAmbience(a: { night: number; water: number; traffic: number; park: number; indoors?: number }): void {
    if (!a) return; this.amb = { ...a }; this.core?.setAmbience(this.amb);
  }

  radioNext(): string | null {
    this.station = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    if (this.core) this.core.radioNext();
    return this.station >= 0 ? STATIONS[this.station].name : null;
  }

  setRadioActive(active: boolean): void { this.radioActive = !!active; this.core?.setRadioActive(this.radioActive); }
  setSlowMo(amount: number): void { this.slow = amount; this.core?.setSlowMo(amount); }
  setPausedMuffle(paused: boolean): void { this.paused = !!paused; this.core?.setPaused(this.paused); }
  setMusicMood(mood: Mood): void { this.mood = mood === 'tension' || mood === 'action' ? mood : 'none'; this.core?.setMood(this.mood); }

  // ---- extras (not part of GameAudio) ----
  /** Name of the currently selected station (null = off). */
  get stationName(): string | null { return this.station >= 0 ? STATIONS[this.station].name : null; }
  /** Diagnostics for dev tools / tests. */
  stats(): { running: boolean; voices: number; engines: number; sirens: number; skids: number; samples: string[] } {
    const c = this.core;
    return { running: this.ctx?.state === 'running', voices: c?.activeVoices ?? 0, engines: c?.engines.active.size ?? 0, sirens: c?.sirens.active.size ?? 0, skids: c?.skids.active.size ?? 0, samples: c ? Object.keys(c.kit.samples) : [] };
  }
  /** Stop everything and close the context. */
  dispose(): void {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    const ctx = this.ctx; this.ctx = null; this.core = null;
    if (ctx) ctx.close().catch(() => undefined);
  }
}
