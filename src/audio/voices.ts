/**
 * Pedestrian voices: spoken barks through the Web Speech API ("Hey!", "Watch it!", "Help!", "Don't shoot!") with a
 * per-person voice, pitch and rate, and synthesized screams/grunts (formant synthesis: a jittery glottal source
 * through vowel formant filters with a soft-clip rasp) routed through the game's SFX bus, so they are spatial and
 * follow the master/SFX volume. Everything is rate-limited and silently does nothing where speech or audio is
 * unavailable (headless browsers, tests, before the first user gesture).
 */
export type VoiceLine = 'hey' | 'watch' | 'what' | 'help' | 'dontShoot' | 'whoa' | 'gang' | 'cop' | 'scream' | 'oof' | 'panic';
export interface Speaker { pos: { x: number; y: number; z: number }; sex: 'm' | 'f'; voiceSeed: number }
/** What the audio engine lends to voices (see Audio.voiceBus). */
export interface VoiceBus { ctx: BaseAudioContext; out: AudioNode; volume: number }

export const LINES: Record<Exclude<VoiceLine, 'scream' | 'oof' | 'panic'>, string[]> = {
  hey: ['Hey!', 'Hey, hey!', 'Hey, what gives?', 'Ow, hey!'],
  watch: ['Watch it!', 'Watch where you\'re going!', 'Excuse you!', 'Easy, pal!', 'Look where you\'re going!'],
  what: ['What the—', 'What the heck?!', 'Are you crazy?!', 'Seriously?!', 'Whoa, what?!'],
  help: ['Help!', 'Somebody help!', 'Call the cops!', 'Run!', 'Get down!'],
  dontShoot: ['Don\'t shoot!', 'Whoa, whoa, put that down!', 'Please, don\'t!', 'Okay, okay! Easy!', 'I don\'t want any trouble!'],
  whoa: ['Whoa!', 'Jeez!', 'Slow down, maniac!', 'Learn to drive!'],
  gang: ['You want some?', 'Wrong street, pal!', 'Back off!', 'You lost?'],
  cop: ['Freeze!', 'Police! Stop right there!', 'Hands where I can see them!', 'Get on the ground!'],
};

/** Formant frequencies (F1, F2, F3) and bandwidth scale of the vowels used for screams and grunts. */
const VOWELS = { a: [850, 1350, 2650], e: [560, 1900, 2700], u: [400, 1000, 2400], o: [570, 900, 2500] } as const;

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class Voices {
  /** Seconds between spoken lines (globally) and per speaker. */
  minGap = 0.7; perSpeaker = 4.5;
  maxDistance = 38;
  enabled = true;
  private bus: (() => VoiceBus | null) | null = null;
  private listener: () => { x: number; y: number; z: number } = () => ({ x: 0, y: 0, z: 0 });
  private lastSpeech = -10;
  private lastBy = new WeakMap<object, number>();
  private screams = 0;
  private now = 0;
  /** Recent lines (for tests and the debug overlay). */
  log: { line: VoiceLine; text: string; t: number }[] = [];

  attach(bus: (() => VoiceBus | null) | null, listener: () => { x: number; y: number; z: number }) { this.bus = bus; this.listener = listener; }
  update(dt: number) { this.now += dt; }

  private distGain(sp: Speaker) {
    const l = this.listener();
    const d = Math.hypot(sp.pos.x - l.x, sp.pos.y - l.y, sp.pos.z - l.z);
    if (!(d < this.maxDistance)) return 0;
    return Math.min(1, 4 / Math.max(4, d)) * (1 - d / this.maxDistance) ** 0.5;
  }

  /** Makes `sp` say/scream a line. Returns true if it was voiced (false when rate-limited, far or unavailable). */
  say(sp: Speaker, line: VoiceLine, priority = false): boolean {
    if (!this.enabled) return false;
    const last = this.lastBy.get(sp) ?? -99;
    if (this.now - last < (priority ? 1.2 : this.perSpeaker)) return false;
    const g = this.distGain(sp); if (g <= 0) return false;
    if (line === 'scream' || line === 'oof' || line === 'panic') {
      if (!this.synth(sp, line, g)) return false;
    } else {
      if (this.now - this.lastSpeech < (priority ? 0.35 : this.minGap)) return false;
      const opts = LINES[line]; const text = opts[Math.floor(hash(sp.voiceSeed * 97 + this.now) * opts.length)];
      if (!this.speak(sp, text, g)) return false;
      this.lastSpeech = this.now;
      this.log.push({ line, text, t: this.now });
    }
    if (line === 'scream' || line === 'panic' || line === 'oof') this.log.push({ line, text: line, t: this.now });
    if (this.log.length > 30) this.log.shift();
    this.lastBy.set(sp, this.now);
    return true;
  }

  private speak(sp: Speaker, text: string, g: number): boolean {
    const w = typeof window !== 'undefined' ? window : null;
    const synth = w && 'speechSynthesis' in w ? w.speechSynthesis : null;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
    const bus = this.bus?.(); const vol = bus ? bus.volume : 0;
    if (vol <= 0.01) return false;
    const all = synth.getVoices().filter(v => /^en/i.test(v.lang));
    if (!all.length) return false; // no voices (headless) -> stay quiet
    const fem = /female|woman|samantha|victoria|karen|zira|susan|moira|tessa|fiona|serena|kate|allison|ava|joanna|salli|kimberly|libby|sonia|jenny|aria/i;
    const male = /\bmale\b|daniel|david|alex|fred|mark|george|guy|ryan|thomas|oliver|arthur|aaron|tom|james|matthew|joey|justin/i;
    const pool = all.filter(v => (sp.sex === 'f' ? fem.test(v.name) : male.test(v.name) && !fem.test(v.name)));
    const list = pool.length ? pool : all;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = list[Math.floor(hash(sp.voiceSeed) * list.length)];
    const base = pool.length ? 1 : sp.sex === 'f' ? 1.35 : 0.75; // fake the sex with pitch if no matching voice
    u.pitch = Math.max(0.1, Math.min(2, base * (0.85 + hash(sp.voiceSeed * 3.1) * 0.3)));
    u.rate = 1.05 + hash(sp.voiceSeed * 5.7) * 0.3;
    u.volume = Math.max(0, Math.min(1, g * vol));
    if (synth.speaking) synth.cancel(); // barks are short and urgent: never queue stale ones
    try { synth.speak(u); } catch { return false; }
    return true;
  }

  /** Synthesizes a scream (long, rising/falling, raspy), a panicked yelp or a grunt ("oof") at the speaker. */
  private synth(sp: Speaker, kind: 'scream' | 'oof' | 'panic', g: number): boolean {
    const bus = this.bus?.(); if (!bus || bus.volume <= 0.01) return false;
    if (this.screams >= 3) return false;
    const ctx = bus.ctx, t0 = ctx.currentTime + 0.01;
    const s = sp.voiceSeed, fem = sp.sex === 'f';
    const pitch = (fem ? 1.0 : 0.55) * (0.85 + hash(s * 7.3) * 0.3);
    const dur = kind === 'scream' ? 0.7 + hash(s + this.now) * 0.6 : kind === 'panic' ? 0.35 : 0.16;
    const f0 = kind === 'oof' ? 170 * pitch * 1.3 : kind === 'panic' ? 620 * pitch : 760 * pitch;
    // glottal source: sawtooth with vibrato, jitter and a pitch contour
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const fq = osc.frequency;
    if (kind === 'oof') { fq.setValueAtTime(f0 * 1.15, t0); fq.exponentialRampToValueAtTime(f0 * 0.8, t0 + dur); }
    else { fq.setValueAtTime(f0 * 0.8, t0); fq.exponentialRampToValueAtTime(f0 * 1.12, t0 + dur * 0.25); fq.exponentialRampToValueAtTime(f0 * 0.95, t0 + dur * 0.7); fq.exponentialRampToValueAtTime(f0 * 0.6, t0 + dur); }
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5 + hash(s * 2.2) * 2.5;
    const vibG = ctx.createGain(); vibG.gain.value = f0 * (kind === 'oof' ? 0.01 : 0.035);
    vib.connect(vibG); vibG.connect(fq);
    // breath / rasp noise
    const nb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (dur + 0.1)), ctx.sampleRate); const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = nb;
    const noiseG = ctx.createGain(); noiseG.gain.value = kind === 'oof' ? 0.5 : 0.22;
    const rasp = ctx.createWaveShaper(); const curve = new Float32Array(256);
    const drive = kind === 'scream' ? 3.2 : 1.6;
    for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
    rasp.curve = curve;
    const src = ctx.createGain(); src.gain.value = 0.5;
    osc.connect(src); noise.connect(noiseG); noiseG.connect(src); src.connect(rasp);
    // formants (parallel band-passes), vowel by kind; female formants ~15% higher
    const vowel = kind === 'oof' ? VOWELS.u : kind === 'panic' ? VOWELS.e : (hash(s * 9.1) < 0.6 ? VOWELS.a : VOWELS.e);
    const fs = fem ? 1.15 : 1;
    const mix = ctx.createGain(); mix.gain.value = 1;
    vowel.forEach((f, i) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * fs; bp.Q.value = [5, 8, 10][i];
      const fg = ctx.createGain(); fg.gain.value = [1.0, 0.6, 0.35][i] * 3;
      rasp.connect(bp); bp.connect(fg); fg.connect(mix);
    });
    // envelope, distance and position
    const env = ctx.createGain(); const lvl = (kind === 'scream' ? 0.55 : kind === 'panic' ? 0.4 : 0.45) * g;
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(lvl, t0 + (kind === 'oof' ? 0.015 : 0.04));
    env.gain.setValueAtTime(lvl, t0 + dur * 0.7); env.gain.linearRampToValueAtTime(0, t0 + dur);
    mix.connect(env);
    let tail: AudioNode = env;
    const l = this.listener();
    if (typeof (ctx as AudioContext).createStereoPanner === 'function') {
      const pan = (ctx as AudioContext).createStereoPanner();
      pan.pan.value = Math.max(-0.8, Math.min(0.8, (sp.pos.x - l.x) / 12));
      env.connect(pan); tail = pan;
    }
    tail.connect(bus.out);
    for (const n of [osc, vib, noise]) { n.start(t0); n.stop(t0 + dur + 0.05); }
    this.screams++;
    osc.onended = () => { this.screams--; for (const n of [osc, vib, noise, vibG, noiseG, src, rasp, mix, env, tail]) n.disconnect(); };
    return true;
  }
}

/** Shared instance: Population attaches it to the audio engine; any system may call VOICES.say(). */
export const VOICES = new Voices();
