/**
 * The audio engine proper, bound to one BaseAudioContext (realtime or offline). Owns the mix graph:
 *
 *   one-shots ─▶ [air LP ─▶ panner] ─▶ sfxIn ─▶ slowMo LP ─┐
 *            └▶ echo send ─▶ street convolver ─▶ sfxIn      │
 *   ambience ─▶ ambIn ──────────────────────────────────────┼▶ world ─▶ pause LP ─▶ pause gain ─┐
 *   radio / mood ─▶ musicIn ─▶ slow-mo duck ────────────────┘                                  │
 *   UI stings ─▶ uiIn ──────────────────────────────────────────────────────────────────────────┼▶ master ─▶ compressor ─▶ ceiling shaper ─▶ out
 */
import type { SfxName, Vec3Like } from '../ui/contracts';
import { type Kit, makeKit, bq, gain, impulseResponse, ceilingCurve } from './dsp';
import { SFX_META, renderSfx } from './sfx';
import { VoicePool } from './voicepool';
import { CULL_DISTANCE, MAX_DISTANCE, REF_DISTANCE, ROLLOFF, airCutoff, distance, echoSend, inverseGain, isFiniteVec } from './spatial';
import { Ambience, type AmbienceState } from './ambience';
import { MoodLayer, MusicFx, Radio } from './music';
import { safe } from './theory';

export const CEILING = 0.95; // absolute output ceiling (-0.45 dBFS)
const CEIL_RANGE = 4;
const AMB_TRIM = 0.55;

interface OneShot { nodes: AudioNode[]; out: GainNode; end: number }

/** Caps how many continuous loops of a kind are rendered; the farthest gets parked when a closer one needs a slot. */
export class SlotGroup<T extends { park(): void }> {
  readonly active = new Map<T, number>();
  private touched = new Map<T, number>();
  constructor(readonly max: number) {}
  request(owner: T, dist: number, now = 0): boolean {
    const ok = this.claim(owner, dist); if (ok) this.touched.set(owner, now); return ok;
  }
  private claim(owner: T, dist: number): boolean {
    if (this.active.has(owner)) { this.active.set(owner, dist); return true; }
    if (this.active.size < this.max) { this.active.set(owner, dist); return true; }
    let far: T | null = null, fd = -1;
    for (const [o, d] of this.active) if (d > fd) { fd = d; far = o; }
    if (far && fd > dist + 4) { this.release(far); far.park(); this.active.set(owner, dist); return true; }
    return false;
  }
  release(owner: T): void { this.active.delete(owner); this.touched.delete(owner); }
  /** Park voices the game stopped updating (forgotten stop() calls must not leak loops). */
  parkStale(now: number, maxAge: number): void {
    for (const [o, t] of [...this.touched]) if (now - t > maxAge) { this.release(o); o.park(); }
  }
}

export class AudioCore {
  readonly kit: Kit;
  readonly out: AudioNode;
  readonly master: GainNode; readonly comp: DynamicsCompressorNode;
  readonly world: GainNode; readonly pauseLp: BiquadFilterNode; readonly pauseGain: GainNode;
  readonly sfxIn: GainNode; readonly slowLp: BiquadFilterNode; readonly slowGain: GainNode; readonly echoIn: GainNode;
  readonly uiIn: GainNode; readonly ambIn: GainNode; readonly musicIn: GainNode; readonly musicDuck: GainNode;
  readonly radio: Radio; readonly mood: MoodLayer; readonly ambience: Ambience;
  readonly listener = { x: 0, y: 0, z: 0 };
  readonly pool: VoicePool<OneShot>;
  readonly live = new Set<OneShot>();
  readonly engines = new SlotGroup<{ park(): void }>(6);
  readonly sirens = new SlotGroup<{ park(): void }>(3);
  readonly skids = new SlotGroup<{ park(): void }>(4);
  pitchMul = 1; slowMo = 0; paused = false;
  private laterQ: { at: number; fn: () => void }[] = [];
  private vols = { master: 1, music: 0.7, sfx: 1 };

  constructor(readonly ctx: BaseAudioContext, rand: () => number = Math.random) {
    const k = this.kit = makeKit(ctx, rand);
    // master chain
    this.master = gain(ctx, 0.8);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -9; this.comp.knee.value = 6; this.comp.ratio.value = 10; this.comp.attack.value = 0.002; this.comp.release.value = 0.2;
    const pre = gain(ctx, 1 / CEIL_RANGE); const clip = ctx.createWaveShaper(); clip.curve = ceilingCurve(0.72, CEILING, CEIL_RANGE); clip.oversample = 'none';
    this.master.connect(this.comp); this.comp.connect(pre); pre.connect(clip); clip.connect(ctx.destination); this.out = clip;
    // world (everything except UI) with pause muffle
    this.world = gain(ctx, 1); this.pauseLp = bq(ctx, 'lowpass', 20000, 0.6); this.pauseGain = gain(ctx, 1);
    this.world.connect(this.pauseLp); this.pauseLp.connect(this.pauseGain); this.pauseGain.connect(this.master);
    // sfx with slow-mo filter and street echo
    this.sfxIn = gain(ctx, 1); this.slowLp = bq(ctx, 'lowpass', 20000, 0.8); this.slowGain = gain(ctx, 1);
    this.sfxIn.connect(this.slowLp); this.slowLp.connect(this.slowGain); this.slowGain.connect(this.world);
    this.echoIn = gain(ctx, 1); const echo = ctx.createConvolver(); echo.normalize = true;
    echo.buffer = impulseResponse(ctx, 1.5, 2.6, [[0.085, 0.55], [0.17, 0.4], [0.29, 0.3], [0.47, 0.18], [0.66, 0.1]], rand, 0.8);
    const echoOut = gain(ctx, 0.5); this.echoIn.connect(echo); echo.connect(echoOut); echoOut.connect(this.sfxIn);
    // UI (unaffected by slow-mo / pause)
    this.uiIn = gain(ctx, 1); this.uiIn.connect(this.master);
    // ambience
    this.ambIn = gain(ctx, AMB_TRIM); this.ambIn.connect(this.world);
    this.ambience = new Ambience(k, this.ambIn, (at, fn) => this.later(at, fn));
    // music
    this.musicIn = gain(ctx, 0.7); this.musicDuck = gain(ctx, 1); this.musicIn.connect(this.musicDuck); this.musicDuck.connect(this.world);
    const fx = new MusicFx(k, this.musicIn);
    const host = { kit: k, later: (at: number, fn: () => void) => this.later(at, fn) };
    this.radio = new Radio(host, this.musicIn, fx, rand);
    this.mood = new MoodLayer(host, this.musicIn, fx);
    this.pool = new VoicePool<OneShot>(32, key => SFX_META[key as SfxName]?.perKey ?? 2, key => SFX_META[key as SfxName]?.minInterval ?? 0);
    this.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  }

  get now(): number { return this.ctx.currentTime; }

  later(at: number, fn: () => void): void { this.laterQ.push({ at, fn }); }

  /** Housekeeping + lookahead scheduling. Call every ~25 ms in realtime. */
  tick(ahead = 0.12): void {
    const now = this.ctx.currentTime;
    if (this.laterQ.length) {
      const due = this.laterQ.filter(q => q.at <= now); this.laterQ = this.laterQ.filter(q => q.at > now);
      for (const q of due) { try { q.fn(); } catch { /* node already gone */ } }
    }
    for (const v of this.live) if (v.end + 0.15 < now) this.freeVoice(v);
    this.pool.prune(now);
    this.engines.parkStale(now, 1.5); this.sirens.parkStale(now, 1.5); this.skids.parkStale(now, 1.5);
    this.radio.tick(now, ahead); this.mood.tick(now, ahead); this.ambience.tick(now, ahead);
  }

  /** Disconnect everything still pending (tests / teardown). */
  flush(): void { for (const q of this.laterQ) { try { q.fn(); } catch { /* ignore */ } } this.laterQ = []; for (const v of this.live) this.freeVoice(v); }

  private freeVoice(v: OneShot): void { this.live.delete(v); this.pool.remove(v); for (const n of v.nodes) { try { n.disconnect(); } catch { /* ignore */ } } }

  get activeVoices(): number { return this.live.size; }
  get pendingLater(): number { return this.laterQ.length; }

  // ---------------- volumes / global state ----------------
  setVolumes(master: number, music: number, sfx: number): void {
    const v = (x: number) => { const c = safe(x, 0, 1, 1); return c * c; };
    this.vols = { master: v(master), music: v(music), sfx: v(sfx) };
    const now = this.ctx.currentTime, tc = 0.05;
    this.master.gain.setTargetAtTime(0.8 * this.vols.master, now, tc);
    this.musicIn.gain.setTargetAtTime(0.7 * this.vols.music, now, tc);
    this.sfxIn.gain.setTargetAtTime(this.vols.sfx, now, tc);
    this.uiIn.gain.setTargetAtTime(this.vols.sfx, now, tc);
    this.ambIn.gain.setTargetAtTime(AMB_TRIM * this.vols.sfx, now, tc);
  }

  setSlowMo(amount: number): void {
    const a = safe(amount, 0, 1, 0); this.slowMo = a; this.pitchMul = 1 - 0.22 * a;
    const now = this.ctx.currentTime;
    this.slowLp.frequency.setTargetAtTime(20000 * Math.pow(650 / 20000, a), now, 0.06);
    this.musicDuck.gain.setTargetAtTime(1 - 0.55 * a, now, 0.08);
    this.slowGain.gain.setTargetAtTime(1 - 0.4 * a, now, 0.06);
  }

  setPaused(p: boolean): void {
    this.paused = !!p; const now = this.ctx.currentTime;
    this.pauseLp.frequency.setTargetAtTime(p ? 480 : 20000, now, 0.08);
    this.pauseGain.gain.setTargetAtTime(p ? 0.5 : 1, now, 0.08);
  }

  setAmbience(a: AmbienceState): void { this.ambience.set(a); }

  setRadioActive(active: boolean): void { this.radio.active = !!active; this.syncMusic(); }
  radioNext(): string | null { const n = this.radio.next(); this.syncMusic(); return n; }
  setMood(m: 'none' | 'tension' | 'action'): void { this.mood.set(m, this.ctx.currentTime); this.syncMusic(); }
  private syncMusic(): void { this.radio.sync(this.ctx.currentTime); this.mood.setLevel(this.radio.audible ? 0.25 : 0.45); }

  // ---------------- listener / panners ----------------
  setListener(pos: Vec3Like, fwd: Vec3Like): void {
    if (!isFiniteVec(pos)) return;
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    let fx = 0, fy = 0, fz = -1;
    if (isFiniteVec(fwd)) { const l = Math.hypot(fwd.x, fwd.y, fwd.z); if (l > 1e-6) { fx = fwd.x / l; fy = fwd.y / l; fz = fwd.z / l; } }
    const L = this.ctx.listener; const now = this.ctx.currentTime; const tc = 0.012;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, now, tc); L.positionY.setTargetAtTime(pos.y, now, tc); L.positionZ.setTargetAtTime(pos.z, now, tc);
      L.forwardX.setTargetAtTime(fx, now, tc); L.forwardY.setTargetAtTime(fy, now, tc); L.forwardZ.setTargetAtTime(fz, now, tc);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  makePanner(hrtf: boolean): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = REF_DISTANCE; p.maxDistance = MAX_DISTANCE; p.rolloffFactor = ROLLOFF;
    return p;
  }

  placePanner(p: PannerNode, pos: Vec3Like, tc = 0): void {
    if (p.positionX) {
      if (tc > 0) { const now = this.ctx.currentTime; p.positionX.setTargetAtTime(pos.x, now, tc); p.positionY.setTargetAtTime(pos.y, now, tc); p.positionZ.setTargetAtTime(pos.z, now, tc); }
      else { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  distanceTo(pos: Vec3Like): number { return distance(this.listener, pos); }

  // ---------------- one-shots ----------------
  /** Plays a sound effect. `when` (context time) is for offline rendering; defaults to now. Returns false if culled/dropped. */
  play(name: SfxName, opts?: { pos?: Vec3Like; volume?: number; pitch?: number }, when?: number): boolean {
    const meta = SFX_META[name]; if (!meta) return false;
    const ctx = this.ctx; const now = ctx.currentTime; const t = Math.max(now, when ?? now);
    const world = meta.cat === 'world';
    const pos = world && opts?.pos && isFiniteVec(opts.pos) ? opts.pos : null;
    const dist = pos ? distance(this.listener, pos) : 0;
    if (pos && !(dist <= CULL_DISTANCE)) return false;
    const vol = safe(opts?.volume ?? 1, 0, 4, 1);
    if (vol <= 0.001) return false;
    const r = this.kit.rand;
    const prio = meta.priority - Math.min(3, dist / 80);
    const adm = this.pool.admit(name, prio, t);
    if (!adm.ok) return false;
    for (const s of adm.steal) this.stealVoice(s, now);

    const pitch = safe(opts?.pitch ?? 1, 0.25, 4, 1) * (1 + (r() * 2 - 1) * meta.jitter) * (world ? this.pitchMul : 1);
    const level = vol * meta.gain * (world ? 1 + (r() * 2 - 1) * 0.08 : 1);
    const out = gain(ctx, level); const nodes: AudioNode[] = [out];
    if (!world) out.connect(this.uiIn);
    else if (pos) {
      const p = this.makePanner(false); this.placePanner(p, pos); nodes.push(p);
      if (dist > 15) { const lp = bq(ctx, 'lowpass', airCutoff(dist), 0.5); out.connect(lp); lp.connect(p); nodes.push(lp); } else out.connect(p);
      p.connect(this.sfxIn);
    } else out.connect(this.sfxIn);
    if (world && meta.echo > 0) {
      const amt = pos ? echoSend(dist, meta.echo) * Math.sqrt(inverseGain(dist)) : meta.echo; const sg = gain(ctx, amt); out.connect(sg); sg.connect(this.echoIn); nodes.push(sg);
    }
    const end = renderSfx(name, { kit: this.kit, out, t, p: pitch });
    const v: OneShot = { nodes, out, end };
    this.pool.add({ key: name, start: t, end, priority: prio, handle: v });
    this.live.add(v);
    return true;
  }

  private stealVoice(v: OneShot, now: number): void {
    v.out.gain.cancelScheduledValues(now); v.out.gain.setValueAtTime(v.out.gain.value, now); v.out.gain.linearRampToValueAtTime(0, now + 0.015);
    v.end = Math.min(v.end, now + 0.03);
  }
}

