/** Procedural radio stations and the mission underscore, driven by a lookahead scheduler on the music bus. */
import { type NoteEv, type Song, type StationDef, STATIONS, heldAt, locate, makeMood, songEvents, stationSegment, stepSeconds } from './composer';
import { type MusicOuts, playNote } from './instruments';
import { type Kit, bq, gain, impulseResponse, noise } from './dsp';

export type NoteHook = (e: NoteEv, t: number, song: Song) => void;

/** Shared music effects: a soft hall reverb and a filtered feedback delay. */
export class MusicFx {
  readonly reverb: ConvolverNode; readonly delay: DelayNode; readonly delayIn: GainNode;
  constructor(k: Kit, out: AudioNode) {
    const ctx = k.ctx;
    this.reverb = ctx.createConvolver(); this.reverb.normalize = true;
    this.reverb.buffer = impulseResponse(ctx, 2.4, 2.2, [[0.023, 0.25], [0.041, 0.18]], k.rand, 0.7);
    const rg = gain(ctx, 0.55); this.reverb.connect(rg); rg.connect(out);
    this.delayIn = gain(ctx, 1); this.delay = ctx.createDelay(2); this.delay.delayTime.value = 0.45;
    const fb = gain(ctx, 0.33); const lp = bq(ctx, 'lowpass', 2800); const hp = bq(ctx, 'highpass', 300);
    this.delayIn.connect(this.delay); this.delay.connect(lp); lp.connect(hp); hp.connect(fb); fb.connect(this.delay);
    const dg = gain(ctx, 0.6); hp.connect(dg); dg.connect(out);
  }
}

/** One stream of notes into its own fadeable outputs. */
class Session {
  readonly outs: MusicOuts; private readonly gains: GainNode[]; private readonly extra: AudioScheduledSourceNode[] = [];
  private readonly tone: BiquadFilterNode;
  song: Song; step: number; nextTime: number; segIndex: number;
  constructor(private k: Kit, out: AudioNode, fx: MusicFx, song: Song, step: number, nextTime: number, segIndex: number, level: number, fadeIn: number) {
    const ctx = k.ctx; this.song = song; this.step = step; this.nextTime = nextTime; this.segIndex = segIndex;
    const now = ctx.currentTime;
    const dry = gain(ctx, 0), rev = gain(ctx, 0), dly = gain(ctx, 0); this.gains = [dry, rev, dly];
    for (const g of this.gains) { g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(level, now + fadeIn); }
    this.tone = bq(ctx, 'lowpass', song.style === 'lofi' ? 4200 : 15000, 0.6);
    dry.connect(this.tone); this.tone.connect(out); rev.connect(fx.reverb); dly.connect(fx.delayIn);
    this.outs = { dry, rev, dly };
    if (song.style === 'lofi') {
      const c = ctx.createBufferSource(); c.buffer = k.crackle; c.loop = true; c.start(now);
      const hp = bq(ctx, 'highpass', 900); const cg = gain(ctx, 0.2); c.connect(hp); hp.connect(cg); cg.connect(dry); this.extra.push(c);
    }
  }
  setLevel(level: number, tc = 0.3): void { const now = this.k.ctx.currentTime; for (const g of this.gains) g.gain.setTargetAtTime(level, now, tc); }
  /** Fade out, stop extras; returns time after which nodes can be dropped. */
  end(fade = 0.08): number {
    const now = this.k.ctx.currentTime;
    for (const g of this.gains) { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + fade); }
    for (const s of this.extra) { try { s.stop(now + fade + 0.05); } catch { /* already stopped */ } }
    return now + fade + 3;
  }
  disconnect(): void { for (const g of this.gains) g.disconnect(); this.tone.disconnect(); }
}

interface Host { kit: Kit; later(at: number, fn: () => void): void }

function scheduleSession(host: Host, s: Session, until: number, nextSong: ((s: Session) => void) | null, onNote: NoteHook | null): number {
  let count = 0;
  while (s.nextTime < until && count < 512) {
    if (s.step >= s.song.totalSteps) { if (!nextSong) break; nextSong(s); continue; }
    const sd = stepSeconds(s.song.bpm); const t = s.nextTime + (s.step % 2 === 1 ? (2 * s.song.swing - 1) * sd : 0);
    for (const e of songEvents(s.song, s.step)) { playNote(host.kit, s.outs, s.song.style, e, t, sd); onNote?.(e, t, s.song); count++; }
    s.step++; s.nextTime += sd;
  }
  return count;
}

export class Radio {
  readonly stations: readonly StationDef[] = STATIONS;
  station = 0; // index, -1 = off
  active = false;
  onNote: NoteHook | null = null;
  private session: Session | null = null; private sessionStation = -1;
  private readonly offsets: number[];
  constructor(private host: Host, private out: AudioNode, private fx: MusicFx, rand: () => number = Math.random) {
    this.offsets = STATIONS.map(() => rand() * 900);
  }
  get audible(): boolean { return this.active && this.station >= 0; }
  stationTime(i: number, now: number): number { return now + this.offsets[i]; }

  next(): string | null {
    this.station = this.station + 1 >= this.stations.length ? -1 : this.station + 1;
    return this.station >= 0 ? this.stations[this.station].name : null;
  }

  /** Bring the playing session in line with the current state (station/active). */
  sync(now: number, staticBurst = true): void {
    if (this.session && (!this.audible || this.sessionStation !== this.station)) this.stop();
    if (this.audible && !this.session) this.start(now, staticBurst);
  }

  private start(now: number, staticBurst: boolean): void {
    const i = this.station; const st = this.stations[i]; const t0 = now + 0.06;
    const loc = locate(st, this.stationTime(i, t0));
    const sd = stepSeconds(loc.song.bpm); const step = loc.step + 1; const nextTime = t0 + (sd - loc.stepOffset);
    const s = new Session(this.host.kit, this.out, this.fx, loc.song, step, nextTime, loc.index, 1, 0.35);
    this.session = s; this.sessionStation = i;
    this.fx.delay.delayTime.setValueAtTime(sd * 3, now);
    for (const e of heldAt(loc.song, step)) playNote(this.host.kit, s.outs, loc.song.style, e, nextTime, sd);
    if (staticBurst) this.tuneStatic(now);
  }

  stop(): void {
    const s = this.session; if (!s) return; this.session = null; this.sessionStation = -1;
    this.host.later(s.end(0.12), () => s.disconnect());
  }

  /** Short band-limited static between stations. */
  private tuneStatic(now: number): void {
    const k = this.host.kit; const n = noise(k, now, 0.3); const bp = bq(k.ctx, 'bandpass', 2400, 0.9); const g = gain(k.ctx, 0);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.05, now + 0.02); g.gain.setTargetAtTime(0, now + 0.12, 0.04); g.gain.setValueAtTime(0, now + 0.29);
    n.connect(bp); bp.connect(g); g.connect(this.out); this.host.later(now + 0.5, () => g.disconnect());
  }

  tick(now: number, ahead: number): number {
    const s = this.session; if (!s) return 0;
    if (s.nextTime < now - 1.5) { this.stop(); this.start(now, false); return 0; } // clock jumped (tab throttled); re-tune silently
    while (s.nextTime < now) { s.step++; s.nextTime += stepSeconds(s.song.bpm); if (s.step >= s.song.totalSteps) this.advance(s); }
    return scheduleSession(this.host, s, now + ahead, x => this.advance(x), this.onNote);
  }

  private advance(s: Session): void {
    s.segIndex++; s.song = stationSegment(this.stations[this.sessionStation], s.segIndex); s.step = 0;
    this.fx.delay.delayTime.setValueAtTime(stepSeconds(s.song.bpm) * 3, Math.max(this.host.kit.ctx.currentTime, s.nextTime));
  }

  get currentSong(): Song | null { return this.session?.song ?? null; }
}

export class MoodLayer {
  mood: 'none' | 'tension' | 'action' = 'none';
  onNote: NoteHook | null = null;
  private session: Session | null = null; private level = 0.45;
  constructor(private host: Host, private out: AudioNode, private fx: MusicFx) {}
  set(mood: 'none' | 'tension' | 'action', now: number): void {
    if (mood === this.mood) return; this.mood = mood;
    if (this.session) { const s = this.session; this.session = null; this.host.later(s.end(1.2), () => s.disconnect()); }
    if (mood !== 'none') this.session = new Session(this.host.kit, this.out, this.fx, makeMood(mood), 0, now + 0.1, 0, this.level, 2);
  }
  setLevel(level: number): void { if (Math.abs(level - this.level) < 1e-3) return; this.level = level; this.session?.setLevel(level, 0.5); }
  tick(now: number, ahead: number): number {
    const s = this.session; if (!s) return 0;
    if (s.nextTime < now) { const sd = stepSeconds(s.song.bpm); const skip = Math.ceil((now - s.nextTime) / sd); s.step += skip; s.nextTime += skip * sd; }
    return scheduleSession(this.host, s, now + ahead, null, this.onNote);
  }
}
