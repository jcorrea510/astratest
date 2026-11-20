import { describe, expect, it } from 'vitest';
import { SCALES, chordFromDegree, degreeToMidi, inScale, midiToFreq, pitchClass, rng, voiceInRange, dbToGain, gainToDb, safe } from './theory';
import { VoicePool } from './voicepool';
import { CULL_DISTANCE, airCutoff, distance, dopplerRatio, echoSend, inverseGain, shouldCull, isFiniteVec } from './spatial';
import { IDENT_STEPS, PITCHED, STATIONS, STEPS_PER_BAR, heldAt, locate, makeIdent, makeMood, makeSong, songEvents, songSeconds, stationSegment, stepSeconds } from './composer';
import { ambienceLevels } from './ambience';
import { SFX_META, RECIPES } from './sfx';
import { ceilingCurve } from './dsp';
import { SlotGroup } from './core';

describe('music theory', () => {
  it('converts midi to frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
  });
  it('maps scale degrees across octaves', () => {
    expect(degreeToMidi(60, 'major', 0)).toBe(60);
    expect(degreeToMidi(60, 'major', 7)).toBe(72);
    expect(degreeToMidi(60, 'major', -1)).toBe(59);
    expect(degreeToMidi(57, 'minor', 2)).toBe(60); // A minor: C
  });
  it('builds diatonic chords', () => {
    expect(chordFromDegree(60, 'major', 0)).toEqual([60, 64, 67]); // C
    expect(chordFromDegree(60, 'major', 4, 4)).toEqual([67, 71, 74, 77]); // G7
    expect(chordFromDegree(57, 'minor', 5)).toEqual([65, 69, 72]); // F in A minor
    expect(chordFromDegree(62, 'dorian', 3, 4)).toEqual([67, 71, 74, 77]); // G7 in D dorian
  });
  it('knows what is in key', () => {
    expect(inScale(61, 60, 'major')).toBe(false);
    expect(inScale(71, 60, 'major')).toBe(true);
    expect(inScale(70, 62, 'dorian')).toBe(false);
    expect(pitchClass(-1)).toBe(11);
    for (const s of Object.values(SCALES)) expect(s).toHaveLength(7);
  });
  it('voices chords into a window and keeps pitch classes', () => {
    const v = voiceInRange([60, 64, 67], 65);
    expect(v.every(n => n >= 65 && n < 77)).toBe(true);
    expect(v.map(pitchClass).sort()).toEqual([0, 4, 7].sort());
  });
  it('has a deterministic rng and safe helpers', () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 10; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(gainToDb(dbToGain(-6))).toBeCloseTo(-6, 6);
    expect(safe(NaN, 0, 1, 0.5)).toBe(0.5);
    expect(safe(7, 0, 1, 0.5)).toBe(1);
  });
});

describe('voice pool', () => {
  it('limits voices per key by stealing the oldest', () => {
    const p = new VoicePool<string>(10, () => 2);
    for (const [i, h] of ['a', 'b'].entries()) { const r = p.admit('gun', 5, i * 0.1); expect(r.ok).toBe(true); p.add({ key: 'gun', start: i * 0.1, end: 5, priority: 5, handle: h }); }
    const r = p.admit('gun', 5, 0.3);
    expect(r).toEqual({ ok: true, steal: ['a'] });
    p.add({ key: 'gun', start: 0.3, end: 5, priority: 5, handle: 'c' });
    expect(p.voices.map(v => v.handle)).toEqual(['b', 'c']);
  });
  it('steals the lowest priority voice when full and rejects lower-priority newcomers', () => {
    const p = new VoicePool<string>(3, () => 5);
    p.add({ key: 'step', start: 0, end: 9, priority: 1, handle: 's' });
    p.add({ key: 'boom', start: 0.1, end: 9, priority: 9, handle: 'b' });
    p.add({ key: 'gun', start: 0.2, end: 9, priority: 6, handle: 'g' });
    expect(p.admit('gun', 6, 1)).toEqual({ ok: true, steal: ['s'] });
    p.add({ key: 'gun', start: 1, end: 9, priority: 6, handle: 'g2' });
    expect(p.admit('tick', 0, 1.1)).toEqual({ ok: false, steal: [] });
    expect(p.size).toBe(3);
  });
  it('frees ended voices and rate-limits spam', () => {
    const p = new VoicePool<number>(4, () => 4, () => 0.03);
    let started = 0;
    for (let i = 0; i < 100; i++) { // 100 shots in one second
      const t = i * 0.01; const r = p.admit('smg', 5, t);
      if (r.ok) { p.add({ key: 'smg', start: t, end: t + 0.2, priority: 5, handle: i }); started++; }
      expect(p.size).toBeLessThanOrEqual(4);
    }
    expect(started).toBeGreaterThan(20);
    expect(started).toBeLessThanOrEqual(34);
    p.prune(10); expect(p.size).toBe(0);
  });
});

describe('spatial math', () => {
  it('culls far sounds and handles bad input', () => {
    const o = { x: 0, y: 0, z: 0 };
    expect(shouldCull(o, { x: 100, y: 0, z: 0 })).toBe(false);
    expect(shouldCull(o, { x: CULL_DISTANCE + 1, y: 0, z: 0 })).toBe(true);
    expect(shouldCull(o, { x: NaN, y: 0, z: 0 })).toBe(true);
    expect(distance(o, { x: 3, y: 4, z: 0 })).toBe(5);
    expect(isFiniteVec({ x: 1, y: Infinity, z: 0 })).toBe(false);
  });
  it('rolls off, darkens and echoes with distance', () => {
    expect(inverseGain(1)).toBe(1);
    expect(inverseGain(50)).toBeLessThan(inverseGain(20));
    expect(airCutoff(0)).toBeGreaterThan(airCutoff(150));
    expect(airCutoff(1000)).toBeGreaterThan(1000);
    expect(echoSend(150)).toBeGreaterThan(echoSend(5));
    expect(echoSend(1e9)).toBeLessThanOrEqual(0.8);
  });
  it('shifts pitch for approaching / receding sources', () => {
    expect(dopplerRatio(-20)).toBeGreaterThan(1);
    expect(dopplerRatio(20)).toBeLessThan(1);
    expect(dopplerRatio(0)).toBe(1);
  });
});

describe('composer', () => {
  it('has three named stations with ~90 s songs', () => {
    expect(STATIONS.map(s => s.name)).toEqual(['Afterglow FM', 'Juniper 88.1', 'Breakwater Beat']);
    for (const st of STATIONS) for (let i = 0; i < 6; i++) {
      const s = makeSong(st.style, st.seed * 1000 + i); const len = songSeconds(s);
      expect(len).toBeGreaterThan(75); expect(len).toBeLessThan(110);
      expect(s.sections.map(x => x.name)).toContain('chorus');
    }
  });
  it('produces only in-key pitched notes over 30+ s for every station, with drums and enough density', () => {
    for (const st of STATIONS) for (let i = 0; i < 4; i++) {
      const song = makeSong(st.style, st.seed * 1000 + i);
      const steps = Math.ceil(32 / stepSeconds(song.bpm));
      let pitched = 0, drums = 0, silentBars = 0;
      for (let b = 0; b * 16 < steps; b++) {
        let n = 0;
        for (let s = b * 16; s < Math.min(steps, (b + 1) * 16); s++) for (const e of songEvents(song, s)) {
          n++;
          if (PITCHED.has(e.inst)) { pitched++; expect(inScale(e.midi, song.root, song.scale)).toBe(true); expect(e.midi).toBeGreaterThan(20); expect(e.midi).toBeLessThan(100); }
          else drums++;
          expect(e.vel).toBeGreaterThanOrEqual(0); expect(e.vel).toBeLessThanOrEqual(1); expect(e.dur).toBeGreaterThan(0);
        }
        if (n === 0) silentBars++;
      }
      expect(pitched).toBeGreaterThan(40); expect(drums).toBeGreaterThan(10); expect(silentBars).toBe(0);
    }
  });
  it('plays a lead melody in choruses only', () => {
    const song = makeSong('synthwave', 5);
    const chorus = song.sections.find(s => s.name === 'chorus')!; const verse = song.sections.find(s => s.name === 'verse')!;
    const leads = (sec: typeof chorus) => { let n = 0; for (let s = sec.startBar * 16; s < (sec.startBar + sec.bars) * 16; s++) n += songEvents(song, s).filter(e => e.inst === 'lead').length; return n; };
    expect(leads(chorus)).toBeGreaterThan(8); expect(leads(verse)).toBe(0);
  });
  it('idents are short, in key and musical', () => {
    for (const st of STATIONS) {
      const id = makeIdent(st); expect(songSeconds(id)).toBeCloseTo(IDENT_STEPS * stepSeconds(120), 6);
      let n = 0; for (let s = 0; s < id.totalSteps; s++) for (const e of songEvents(id, s)) { n++; if (PITCHED.has(e.inst)) expect(inScale(e.midi, id.root, id.scale)).toBe(true); }
      expect(n).toBeGreaterThan(4);
    }
  });
  it('locates the broadcast position deterministically (stations keep playing)', () => {
    const st = STATIONS[0];
    const a = locate(st, 0); expect(a.index).toBe(0); expect(a.step).toBe(0);
    const firstLen = songSeconds(stationSegment(st, 0));
    const b = locate(st, firstLen + 0.01); expect(b.index).toBe(1); expect(b.song.ident).toBe(true);
    const c = locate(st, 3600); expect(c.index).toBeGreaterThan(30); expect(c.step).toBeLessThan(c.song.totalSteps);
    expect(locate(st, 3600)).toEqual(c);
  });
  it('holds pads when tuning in mid-bar and loops the mood layer forever', () => {
    const song = makeSong('synthwave', 9); const step = song.sections[1].startBar * 16 + 5;
    expect(heldAt(song, step).some(e => e.inst === 'pad')).toBe(true);
    for (const m of ['tension', 'action'] as const) {
      const mood = makeMood(m); let n = 0;
      for (let s = 10000; s < 10000 + STEPS_PER_BAR * 4; s++) for (const e of songEvents(mood, s)) { n++; if (PITCHED.has(e.inst)) expect(inScale(e.midi, mood.root, mood.scale)).toBe(true); }
      expect(n).toBeGreaterThan(8);
    }
  });
});

describe('ambience levels', () => {
  it('birds by day in parks, crickets at night, waves near water', () => {
    const dayPark = ambienceLevels({ night: 0, water: 0, traffic: 0.1, park: 1 });
    const nightPark = ambienceLevels({ night: 1, water: 0, traffic: 0.1, park: 1 });
    const coast = ambienceLevels({ night: 0, water: 1, traffic: 0.2, park: 0 });
    const downtown = ambienceLevels({ night: 0, water: 0, traffic: 1, park: 0 });
    expect(dayPark.birds).toBeGreaterThan(0.5); expect(nightPark.birds).toBe(0);
    expect(nightPark.crickets).toBeGreaterThan(0.5); expect(dayPark.crickets).toBe(0);
    expect(coast.waves).toBeGreaterThan(0.25); expect(downtown.waves).toBe(0);
    expect(downtown.traffic).toBeGreaterThan(dayPark.traffic);
    expect(ambienceLevels({ night: 0, water: 0, traffic: 0, park: 0, indoors: 1 }).indoorsCut).toBeLessThan(1000);
    const bad = ambienceLevels({ night: NaN, water: Infinity, traffic: -3, park: 9 });
    for (const v of Object.values(bad)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('sfx table & limiter curve', () => {
  it('every SfxName has a recipe and metadata', () => {
    const names = Object.keys(SFX_META).sort();
    expect(Object.keys(RECIPES).sort()).toEqual(names);
    expect(names.length).toBe(43);
  });
  it('ceiling curve is transparent at low level and never exceeds the ceiling', () => {
    const c = ceilingCurve(0.72, 0.95, 4, 8193);
    const at = (x: number) => c[Math.round(((x / 4 + 1) / 2) * (c.length - 1))];
    expect(at(0.5)).toBeCloseTo(0.5, 2);
    expect(Math.max(...c)).toBeLessThanOrEqual(0.95);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(-0.95);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
});

describe('loop slot group', () => {
  it('keeps the nearest loops, parks the farthest and parks forgotten ones', () => {
    const parked: number[] = [];
    const mk = (id: number) => ({ id, park: () => { parked.push(id); } });
    const g = new SlotGroup<ReturnType<typeof mk>>(3);
    const v = [0, 1, 2, 3, 4].map(mk);
    expect(g.request(v[0], 50, 0)).toBe(true); expect(g.request(v[1], 40, 0)).toBe(true); expect(g.request(v[2], 30, 0)).toBe(true);
    expect(g.request(v[3], 48, 0)).toBe(false); // not clearly closer than the farthest (50)
    expect(g.request(v[4], 5, 0)).toBe(true); // steals the farthest
    expect(parked).toEqual([0]); expect(g.active.size).toBe(3); expect(g.active.has(v[4])).toBe(true);
    g.request(v[4], 5, 2);
    g.parkStale(2.5, 1.5);
    expect(parked.sort()).toEqual([0, 1, 2]); expect([...g.active.keys()]).toEqual([v[4]]);
  });
});

describe('weapon sound synthesis', () => {
  it('extra weapon foley has recipes and metadata', async () => {
    const { EXTRA_META, EXTRA_RECIPES } = await import('./sfx');
    expect(Object.keys(EXTRA_RECIPES).sort()).toEqual(Object.keys(EXTRA_META).sort());
  });
  it('gunshots are loud and full-bodied (energy in the mids, not a click), with class-dependent tails', async () => {
    const { GUNS, renderGun, analyse } = await import('./gunsynth');
    const r = rng(7);
    const res: Record<string, { dur: number; rms: number }> = {};
    for (const g of Object.keys(GUNS) as (keyof typeof GUNS)[]) {
      const d = renderGun(GUNS[g], 48000, r); const a = analyse(d, 48000);
      let onset = 0; for (let i = 0; i < 144; i++) onset = Math.max(onset, Math.abs(d[i]));
      expect(onset).toBeGreaterThan(0.5 * a.peak); // the bang arrives within 3 ms
      expect(a.peak).toBeGreaterThan(0.9);
      let rms = 0; const n = 4800; for (let i = 0; i < n; i++) rms += d[i] * d[i]; rms = Math.sqrt(rms / n);
      expect(rms).toBeGreaterThan(0.18); // dense first 100 ms (a click would be ~0.05)
      expect(a.lowFrac).toBeLessThan(0.75); // not all sub: small speakers must hear it
      expect(a.durMs40).toBeGreaterThanOrEqual(140); expect(a.durMs40).toBeLessThanOrEqual(1700);
      expect(d.every(Number.isFinite)).toBe(true);
      res[g] = { dur: a.durMs40, rms };
    }
    // classes sound different: shotguns and snipers ring longer than SMGs and pistols
    expect(res.shotgun.dur).toBeGreaterThan(res.smg.dur * 2);
    expect(res.sniper.dur).toBeGreaterThan(res.pistol.dur * 2);
    expect(res.shotgun.rms).toBeGreaterThan(res.compact.rms);
    // far voices: long rolling tail, dull
    const far = renderGun(GUNS.rifle, 48000, r, true); const fa = analyse(far, 48000);
    expect(fa.durMs40).toBeGreaterThan(1000);
  }, 30_000);
});
