/**
 * Pure procedural composer for the in-car radio and mission underscore. Produces deterministic note events per
 * 16th-note step; the Web Audio side (instruments.ts / radio.ts) turns them into sound. No Web Audio here.
 */
import { type ScaleName, chordFromDegree, degreeToMidi, voiceInRange, rng, pick } from './theory';

export type StyleId = 'synthwave' | 'lofi' | 'funk' | 'tension' | 'action';
export type Inst = 'pad' | 'arp' | 'bass' | 'lead' | 'keys' | 'bell' | 'kick' | 'snare' | 'clap' | 'hat' | 'ohat' | 'rim' | 'clav' | 'stab' | 'drone';
export const PITCHED: ReadonlySet<Inst> = new Set<Inst>(['pad', 'arp', 'bass', 'lead', 'keys', 'bell', 'clav', 'stab', 'drone']);

export interface NoteEv { inst: Inst; midi: number; /** duration in 16th steps */ dur: number; vel: number; pan?: number }
export type SectionName = 'intro' | 'verse' | 'chorus' | 'break' | 'outro' | 'ident' | 'loop';
export interface SectionInst { name: SectionName; startBar: number; bars: number; prog: number[] }
export interface MotifNote { step: number; dur: number; deg: number }
export interface Song {
  style: StyleId; ident: boolean; seed: number; bpm: number; root: number; scale: ScaleName; swing: number;
  sections: SectionInst[]; totalSteps: number; motif: MotifNote[]; variant: number;
}

export const STEPS_PER_BAR = 16;
export function stepSeconds(bpm: number): number { return 60 / bpm / 4; }
export function songSeconds(s: Song): number { return s.totalSteps * stepSeconds(s.bpm); }

// ---------------- Stations ----------------
export interface StationDef { name: string; style: 'synthwave' | 'lofi' | 'funk'; seed: number; identRoot: number; identScale: ScaleName }
export const STATIONS: readonly StationDef[] = [
  { name: 'Afterglow FM', style: 'synthwave', seed: 1187, identRoot: 45, identScale: 'minor' },
  { name: 'Juniper 88.1', style: 'lofi', seed: 2741, identRoot: 53, identScale: 'major' },
  { name: 'Breakwater Beat', style: 'funk', seed: 3313, identRoot: 50, identScale: 'dorian' },
];

interface StyleSpec {
  bpms: number[]; roots: number[]; scales: ScaleName[]; swing: number;
  form: [SectionName, number][]; verse: number[][]; chorus: number[][];
}
const STYLE: Record<'synthwave' | 'lofi' | 'funk', StyleSpec> = {
  synthwave: {
    bpms: [92, 96, 100, 104], roots: [45, 50, 52, 53, 55], scales: ['minor'], swing: 0.5,
    form: [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['outro', 4]],
    verse: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 4, 5, 3], [0, 3, 5, 6]], chorus: [[5, 6, 0, 0], [3, 5, 6, 0], [5, 2, 6, 0], [5, 6, 4, 0]],
  },
  lofi: {
    bpms: [72, 76, 80, 84], roots: [48, 50, 51, 53, 55], scales: ['major'], swing: 0.6,
    form: [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['outro', 4]],
    verse: [[1, 4, 0, 0], [1, 4, 0, 5], [3, 2, 1, 4], [0, 5, 1, 4]], chorus: [[3, 4, 2, 5], [3, 2, 1, 4], [5, 3, 1, 4], [0, 3, 1, 4]],
  },
  funk: {
    bpms: [108, 112, 116, 120], roots: [45, 47, 50, 52], scales: ['dorian', 'mixolydian'], swing: 0.54,
    form: [['intro', 4], ['verse', 8], ['chorus', 8], ['break', 4], ['verse', 8], ['chorus', 8], ['outro', 4]],
    verse: [[0, 0, 3, 3], [0, 3, 0, 3], [0, 0, 6, 3]], chorus: [[2, 3, 6, 0], [6, 3, 0, 0], [2, 3, 4, 0], [3, 3, 6, 0]],
  },
};

const RHYTHMS: [number, number][][] = [
  [[0, 3], [4, 2], [6, 2], [8, 4], [12, 4], [16, 3], [20, 2], [22, 2], [24, 8]],
  [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4], [16, 2], [18, 2], [20, 4], [24, 4], [28, 4]],
  [[0, 6], [6, 2], [8, 4], [14, 2], [16, 4], [20, 4], [24, 8]],
  [[2, 2], [4, 2], [6, 4], [12, 4], [18, 2], [20, 2], [22, 4], [26, 6]],
];

function makeMotif(r: () => number, sparse: boolean): MotifNote[] {
  const rhythm = pick(r, RHYTHMS); let deg = pick(r, [0, 2, 4]); const out: MotifNote[] = [];
  rhythm.forEach(([step, dur], i) => {
    if (sparse && i % 2 === 1 && r() < 0.6) return;
    const strong = step % 8 === 0;
    if (i === rhythm.length - 1) deg = 0;
    else if (strong) deg = pick(r, [0, 2, 4, 7].filter(d => Math.abs(d - deg) <= 4)) ?? 0;
    else deg = Math.max(-2, Math.min(9, deg + pick(r, [-1, 1, 1, -2, 2])));
    out.push({ step, dur: Math.max(1, dur - (sparse ? 0 : 1)), deg });
  });
  return out;
}

/** A full song for a station, deterministic from `seed`. */
export function makeSong(style: 'synthwave' | 'lofi' | 'funk', seed: number): Song {
  const r = rng(seed); const sp = STYLE[style];
  const verse = pick(r, sp.verse), chorus = pick(r, sp.chorus);
  let bar = 0; const sections: SectionInst[] = [];
  for (const [name, bars] of sp.form) {
    const prog = name === 'chorus' ? chorus : name === 'break' ? [chorus[0], chorus[1]] : verse;
    sections.push({ name, startBar: bar, bars, prog }); bar += bars;
  }
  return {
    style, ident: false, seed, bpm: pick(r, sp.bpms), root: pick(r, sp.roots), scale: pick(r, sp.scales), swing: sp.swing,
    sections, totalSteps: bar * STEPS_PER_BAR, motif: makeMotif(r, style === 'lofi'), variant: Math.floor(r() * 3),
  };
}

export const IDENT_STEPS = 24;
export function makeIdent(st: StationDef): Song {
  return {
    style: st.style, ident: true, seed: st.seed, bpm: 120, root: st.identRoot, scale: st.identScale, swing: 0.5,
    sections: [{ name: 'ident', startBar: 0, bars: 2, prog: [0] }], totalSteps: IDENT_STEPS, motif: [], variant: 0,
  };
}

/** Looping mission underscore. */
export function makeMood(mood: 'tension' | 'action'): Song {
  return {
    style: mood, ident: false, seed: mood === 'tension' ? 7 : 11, bpm: mood === 'tension' ? 84 : 124, root: 50, scale: 'minor', swing: 0.5,
    sections: [{ name: 'loop', startBar: 0, bars: 4, prog: mood === 'tension' ? [0, 0, 5, 4] : [0, 5, 6, 0] }], totalSteps: Infinity, motif: [], variant: 0,
  };
}

// ---------------- Station timeline (stations keep "playing" while you are away) ----------------
export interface Segment { song: Song; start: number; dur: number; index: number }
/** Segment `i` of a station: even = song, odd = ident jingle. */
export function stationSegment(st: StationDef, i: number): Song {
  return i % 2 === 1 ? makeIdent(st) : makeSong(st.style, st.seed * 1000 + i / 2);
}
/** Find which segment is playing `t` seconds into the station's (endless) broadcast. */
export function locate(st: StationDef, t: number): Segment & { step: number; stepOffset: number } {
  let start = 0; const tt = Math.max(0, t);
  for (let i = 0; i < 100000; i++) {
    const song = stationSegment(st, i); const dur = songSeconds(song);
    if (tt < start + dur) {
      const sd = stepSeconds(song.bpm); const into = tt - start; const step = Math.floor(into / sd);
      return { song, start, dur, index: i, step, stepOffset: into - step * sd };
    }
    start += dur;
  }
  const song = stationSegment(st, 0); return { song, start: tt, dur: songSeconds(song), index: 0, step: 0, stepOffset: 0 };
}

// ---------------- Events ----------------
function sectionAt(song: Song, bar: number): SectionInst {
  const s = song.sections; if (song.totalSteps === Infinity) return s[0];
  for (let i = s.length - 1; i >= 0; i--) if (bar >= s[i].startBar) return s[i];
  return s[0];
}

/** Note events that start on 16th step `step` of `song`. */
export function songEvents(song: Song, step: number): NoteEv[] {
  if (step < 0 || step >= song.totalSteps) return [];
  const bar = Math.floor(step / STEPS_PER_BAR); const s = step % STEPS_PER_BAR;
  const sec = sectionAt(song, bar); const barIn = bar - sec.startBar;
  const deg = sec.prog[barIn % sec.prog.length];
  const ev: NoteEv[] = [];
  const ctx: Ctx = { song, step, bar, s, sec, barIn, deg, ev, r: rng(song.seed * 7919 + bar * 104729 + 13) };
  if (song.ident) identEvents(ctx);
  else if (song.style === 'synthwave') synthwave(ctx);
  else if (song.style === 'lofi') lofi(ctx);
  else if (song.style === 'funk') funk(ctx);
  else moodEvents(ctx);
  return ev;
}

/** Sustained notes (pads/keys) that would already be sounding at `step` — used when tuning in mid-bar. */
export function heldAt(song: Song, step: number): NoteEv[] {
  const s = step % STEPS_PER_BAR; if (s === 0 || song.ident) return [];
  const barStart = step - s;
  return songEvents(song, barStart).filter(e => (e.inst === 'pad' || e.inst === 'keys' || e.inst === 'drone') && e.dur > s).map(e => ({ ...e, dur: e.dur - s, vel: e.vel * 0.85 }));
}

interface Ctx { song: Song; step: number; bar: number; s: number; sec: SectionInst; barIn: number; deg: number; ev: NoteEv[]; r: () => number }
const chord = (c: Ctx, size = 3, degOverride?: number) => chordFromDegree(c.song.root, c.song.scale, degOverride ?? c.deg, size);
const bassNote = (c: Ctx) => voiceInRange([chord(c)[0]], 33)[0];
/** Volume shape over a section (fade the outro, swell the intro). */
function shape(c: Ctx): number {
  if (c.sec.name === 'outro') return 1 - (c.barIn + c.s / 16) / (c.sec.bars + 0.5);
  if (c.sec.name === 'intro') return 0.7 + 0.3 * (c.barIn / c.sec.bars);
  return 1;
}
function lead(c: Ctx, inst: Inst, vel: number, octaveRoot: number) {
  const phraseStep = (c.barIn % 2) * 16 + c.s; const second = c.barIn % 4 >= 2;
  for (const m of c.song.motif) {
    if (m.step !== phraseStep) continue;
    let d = m.deg; if (second && m === c.song.motif[c.song.motif.length - 2]) d = d + 1;
    const midi = degreeToMidi(octaveRoot, c.song.scale, c.deg + d);
    c.ev.push({ inst, midi, dur: m.dur, vel });
  }
}

function synthwave(c: Ctx) {
  const { s, sec, ev } = c; const v = shape(c); const ch = chord(c);
  const full = sec.name === 'verse' || sec.name === 'chorus';
  if (s === 0) for (const m of voiceInRange(ch, 55)) ev.push({ inst: 'pad', midi: m, dur: 16, vel: 0.55 * v });
  const arpNotes = voiceInRange(ch, 64); const seq = [...arpNotes, ...arpNotes.map(n => n + 12)];
  const order = c.song.variant === 0 ? [0, 1, 2, 3, 4, 5, 4, 3] : c.song.variant === 1 ? [0, 2, 1, 3, 5, 4, 3, 1] : [0, 1, 2, 1, 3, 4, 5, 4];
  if (sec.name !== 'outro' || c.barIn < sec.bars - 1) ev.push({ inst: 'arp', midi: seq[order[s % 8]], dur: 1, vel: (s % 4 === 0 ? 0.6 : 0.42) * v, pan: s % 2 ? 0.35 : -0.35 });
  if (full || sec.name === 'outro') {
    if (s % 2 === 0) { const b = bassNote(c); ev.push({ inst: 'bass', midi: s === 6 || s === 14 ? b + 12 : b, dur: 1.6, vel: 0.7 * v }); }
  }
  if (full) {
    const chorus = sec.name === 'chorus';
    if (chorus ? s % 4 === 0 : (s === 0 || s === 8 || (s === 10 && c.barIn % 2 === 1))) ev.push({ inst: 'kick', midi: 0, dur: 1, vel: 0.95 });
    if (s === 4 || s === 12) ev.push({ inst: 'snare', midi: 0, dur: 1, vel: 0.85 });
    if (chorus ? true : s % 2 === 0) ev.push({ inst: 'hat', midi: 0, dur: 1, vel: s % 4 === 2 ? 0.55 : 0.3, pan: 0.25 });
    if (chorus) lead(c, 'lead', 0.75, c.song.root + 24);
  } else if (sec.name === 'intro' && c.barIn >= 2 && s % 4 === 2) ev.push({ inst: 'hat', midi: 0, dur: 1, vel: 0.25, pan: 0.25 });
}

function lofi(c: Ctx) {
  const { s, sec, ev, r } = c; const v = shape(c); const ch = chord(c, 4);
  const pat = r(); // per-bar decision
  const groove = sec.name === 'verse' || sec.name === 'chorus';
  if (s === 0) for (const m of voiceInRange(ch, 55)) ev.push({ inst: 'keys', midi: m, dur: groove ? 7 : 13, vel: 0.55 * v });
  if (s === (pat < 0.5 ? 7 : 10) && sec.name !== 'outro') for (const m of voiceInRange(ch, 55).slice(1)) ev.push({ inst: 'keys', midi: m, dur: groove ? 5 : 6, vel: 0.35 * v });
  if (groove) {
    const b = bassNote(c) + 12;
    if (s === 0) ev.push({ inst: 'bass', midi: b, dur: 6, vel: 0.75 });
    if (s === 10) ev.push({ inst: 'bass', midi: voiceInRange([ch[2]], b - 5)[0], dur: 4, vel: 0.6 });
    if (s === 0 || s === 10 || (s === 7 && pat > 0.6)) ev.push({ inst: 'kick', midi: 0, dur: 1, vel: s === 0 ? 0.85 : 0.65 });
    if (s === 4 || s === 12) ev.push({ inst: 'snare', midi: 0, dur: 1, vel: 0.6 });
    if (s % 2 === 0) ev.push({ inst: 'hat', midi: 0, dur: 1, vel: s % 4 === 0 ? 0.35 : 0.22, pan: 0.2 });
    if (s === 14 && pat > 0.75) ev.push({ inst: 'rim', midi: 0, dur: 1, vel: 0.3 });
    if (sec.name === 'chorus') lead(c, 'bell', 0.6, c.song.root + 24);
  } else if (c.barIn >= 1 && s % 4 === 2 && (sec.name === 'intro' || c.barIn < sec.bars - 1)) ev.push({ inst: 'hat', midi: 0, dur: 1, vel: 0.32, pan: 0.2 });
}

function funk(c: Ctx) {
  const { s, sec, ev, barIn } = c; const v = shape(c); const ch = chord(c, 4);
  const groove = sec.name === 'verse' || sec.name === 'chorus' || sec.name === 'break';
  // bass: index into [root, third, fifth, seventh, octave]
  const BASS: (number | null)[][] = [
    [0, null, null, 0, null, null, 4, null, 0, null, 2, null, 3, null, 4, null],
    [0, null, 0, null, null, 4, null, 0, null, null, 0, 2, null, 3, 4, null],
    [0, null, null, 4, null, 0, null, null, 2, null, 0, null, 3, 2, 0, null],
  ];
  if (sec.name !== 'break' || barIn % 2 === 1) {
    const idx = BASS[c.song.variant][s];
    if (idx !== null && sec.name !== 'intro') {
      const b = bassNote(c); const tones = [b, voiceInRange([ch[1]], b)[0], voiceInRange([ch[2]], b)[0], voiceInRange([ch[3]], b)[0], b + 12];
      ev.push({ inst: 'bass', midi: tones[idx], dur: idx === 4 ? 1 : 1.5, vel: (s % 4 === 0 ? 0.85 : 0.7) * v });
    }
  }
  const CLAV = [2, 6, 7, 10, 14];
  if (CLAV.includes(s) && sec.name !== 'outro') for (const m of voiceInRange(ch.slice(1), 62)) ev.push({ inst: 'clav', midi: m, dur: 0.5, vel: 0.5 * v, pan: -0.3 });
  if (sec.name === 'chorus' && (s === 0 || (s === 11 && barIn % 2 === 1))) for (const m of voiceInRange(ch.slice(0, 3), 60)) ev.push({ inst: 'stab', midi: m, dur: s === 0 ? 3 : 2, vel: 0.6 });
  if (sec.name === 'intro' || sec.name === 'outro') { if (s === 0) for (const m of voiceInRange(ch, 57)) ev.push({ inst: 'pad', midi: m, dur: 16, vel: 0.4 * v }); }
  if (groove || sec.name === 'intro') {
    const kickSteps = c.song.variant === 1 ? [0, 3, 8, 10] : [0, 7, 10];
    if (kickSteps.includes(s) && sec.name !== 'intro') ev.push({ inst: 'kick', midi: 0, dur: 1, vel: 0.9 });
    if ((s === 4 || s === 12) && sec.name !== 'intro') ev.push({ inst: 'clap', midi: 0, dur: 1, vel: 0.8 });
    if (s === 6 || s === 14) ev.push({ inst: 'ohat', midi: 0, dur: 1, vel: 0.35, pan: 0.3 });
    else ev.push({ inst: 'hat', midi: 0, dur: 1, vel: s % 2 === 0 ? 0.4 : 0.22, pan: 0.3 });
  }
  if (sec.name === 'chorus') lead(c, 'lead', 0.65, c.song.root + 24);
}

function identEvents(c: Ctx) {
  const { s, step, ev, song } = c; const root = song.root; const sc = song.scale;
  const ch = chordFromDegree(root, sc, 0, song.style === 'lofi' ? 4 : 3);
  if (song.style === 'synthwave') {
    const up = [...voiceInRange(ch, 64), ...voiceInRange(ch, 76)];
    if (step < 6) ev.push({ inst: 'arp', midi: up[step], dur: 1, vel: 0.6, pan: step % 2 ? 0.3 : -0.3 });
    if (step === 6) {
      for (const m of voiceInRange(ch, 55)) ev.push({ inst: 'pad', midi: m, dur: 16, vel: 0.6 });
      ev.push({ inst: 'bass', midi: root - 12, dur: 10, vel: 0.7 }, { inst: 'snare', midi: 0, dur: 1, vel: 0.8 }, { inst: 'kick', midi: 0, dur: 1, vel: 0.9 });
      ev.push({ inst: 'lead', midi: degreeToMidi(root + 24, sc, 4), dur: 10, vel: 0.6 });
    }
  } else if (song.style === 'lofi') {
    if (step === 0) for (const m of voiceInRange(ch, 55)) ev.push({ inst: 'keys', midi: m, dur: 14, vel: 0.55 });
    const mel: Record<number, number> = { 2: 4, 6: 2, 10: 7 };
    if (mel[step] !== undefined) ev.push({ inst: 'bell', midi: degreeToMidi(root + 24, sc, mel[step]), dur: 6, vel: 0.6 });
    if (step === 0) ev.push({ inst: 'bass', midi: root - 12 + 12, dur: 12, vel: 0.6 });
  } else {
    if (step === 0 || step === 2) ev.push({ inst: 'bass', midi: step === 0 ? root - 12 : root, dur: 1.5, vel: 0.85 });
    if (step === 4 || step === 6) for (const m of voiceInRange(chordFromDegree(root, sc, step === 4 ? 6 : 0, 3), 60)) ev.push({ inst: 'stab', midi: m, dur: step === 4 ? 1.5 : 10, vel: 0.7 });
    if (step === 4 || step === 6) ev.push({ inst: 'clap', midi: 0, dur: 1, vel: 0.7 });
    if (step === 6) ev.push({ inst: 'kick', midi: 0, dur: 1, vel: 0.9 });
  }
  void s;
}

function moodEvents(c: Ctx) {
  const { s, ev, song } = c; const ch = chord(c);
  if (song.style === 'tension') {
    if (s % 2 === 0) ev.push({ inst: 'bass', midi: bassNote(c), dur: 1.2, vel: s % 8 === 0 ? 0.55 : 0.35 });
    if (s === 0 || s === 3) ev.push({ inst: 'kick', midi: 0, dur: 1, vel: s === 0 ? 0.55 : 0.4 });
    if (s === 0 && c.barIn % 2 === 0) for (const m of [degreeToMidi(song.root + 12, song.scale, 0), degreeToMidi(song.root + 12, song.scale, 4)]) ev.push({ inst: 'drone', midi: m, dur: 32, vel: 0.4 });
    if (s % 4 === 2) ev.push({ inst: 'hat', midi: 0, dur: 1, vel: 0.15, pan: 0.2 });
  } else {
    ev.push({ inst: 'bass', midi: s % 4 === 2 ? bassNote(c) + 12 : bassNote(c), dur: 0.8, vel: s % 4 === 0 ? 0.75 : 0.5 });
    if (s % 4 === 0) ev.push({ inst: 'kick', midi: 0, dur: 1, vel: 0.85 });
    if (s === 4 || s === 12) ev.push({ inst: 'snare', midi: 0, dur: 1, vel: 0.6 });
    ev.push({ inst: 'hat', midi: 0, dur: 1, vel: s % 2 ? 0.18 : 0.3, pan: 0.25 });
    if (s === 0 || s === 10) for (const m of voiceInRange(ch, 57)) ev.push({ inst: 'stab', midi: m, dur: s === 0 ? 3 : 2, vel: 0.45 });
  }
}
