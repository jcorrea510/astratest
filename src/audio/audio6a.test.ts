import { describe, expect, it } from 'vitest';
import { MIN_RAMP, fadeOutParam, glideParam, worstStep, type AudioParamLike, type ParamEvent } from './declick';
import { VoicePool } from './voicepool';
import { ambienceLevels } from './ambience';

/** Records the automation a module schedules on a param so the schedule itself can be inspected. */
function fakeParam(initial: number) {
  const events: ParamEvent[] = [];
  const p: AudioParamLike = {
    value: initial,
    cancelScheduledValues() { events.push({ type: 'cancel', v: 0, t: 0 }); },
    setValueAtTime(v, t) { events.push({ type: 'set', v, t }); },
    linearRampToValueAtTime(v, t) { events.push({ type: 'ramp', v, t }); },
    setTargetAtTime(v, t, tc) { events.push({ type: 'target', v, t, tc }); },
  };
  return { p, events };
}

describe('declick (R6-A)', () => {
  it('fades never step the gain: set-to-current then a ramp of at least MIN_RAMP', () => {
    for (const dur of [0, 0.001, 0.005, 0.02, 0.15]) {
      const { p, events } = fakeParam(0.8);
      const end = fadeOutParam(p, 10, dur);
      expect(end - 10).toBeGreaterThanOrEqual(MIN_RAMP - 1e-12);
      const w = worstStep(events, 0.8);
      expect(w.step).toBe(0); // the only "set" holds the current value; the drop is the ramp
      expect(events.filter(e => e.type === 'ramp')).toHaveLength(1);
      expect(events.find(e => e.type === 'ramp')!.t - 10).toBeGreaterThanOrEqual(MIN_RAMP - 1e-12);
    }
  });
  it('detects an abrupt step when a schedule has one', () => {
    const w = worstStep([{ type: 'set', v: 0, t: 1 }], 0.9);
    expect(w.step).toBeCloseTo(0.9);
    const w2 = worstStep([{ type: 'set', v: 0.9, t: 1 }, { type: 'ramp', v: 0, t: 1.001 }], 0.9);
    expect(w2.step).toBeGreaterThan(0.5); expect(w2.dt).toBeLessThan(MIN_RAMP);
  });
  it('glides use a time constant that is never instantaneous', () => {
    const { p, events } = fakeParam(0);
    glideParam(p, 1, 0, 0);
    expect(events[0].tc).toBeGreaterThan(0);
  });
});

describe('voice cap (R6-A)', () => {
  it('never exceeds the pool maximum under a 500-voice storm, and stolen voices are always handed back for fading', () => {
    const pool = new VoicePool<number>(32, () => 8, () => 0);
    let stolen = 0, id = 0;
    for (let i = 0; i < 500; i++) {
      const key = ['a', 'b', 'c', 'd', 'e'][i % 5]; const now = i * 0.002;
      const r = pool.admit(key, 1 + (i % 7), now);
      stolen += r.steal.length;
      if (r.ok) pool.add({ key, start: now, end: now + 5, priority: 1 + (i % 7), handle: id++ });
      expect(pool.size).toBeLessThanOrEqual(32);
    }
    expect(stolen).toBeGreaterThan(0);
  });
});

describe('ambience additions (R6-A)', () => {
  it('crowd murmur follows the crowd input and far city noise needs traffic', () => {
    expect(ambienceLevels({ night: 0, water: 0, traffic: 0.5, park: 0, crowd: 0 }).crowd).toBe(0);
    expect(ambienceLevels({ night: 0, water: 0, traffic: 0.5, park: 0, crowd: 1 }).crowd).toBeGreaterThan(0.2);
    expect(ambienceLevels({ night: 0, water: 0, traffic: 0, park: 0 }).city).toBe(0);
    expect(ambienceLevels({ night: 0, water: 0, traffic: 1, park: 0 }).city).toBeGreaterThan(0.3);
    expect(ambienceLevels({ night: 0, water: 0, traffic: 1, park: 1 }).city).toBeLessThan(ambienceLevels({ night: 0, water: 0, traffic: 1, park: 0 }).city);
  });
  it('wind rises with altitude', () => {
    const lo = ambienceLevels({ night: 0, water: 0, traffic: 0.5, park: 0, altitude: 0 }).wind;
    const hi = ambienceLevels({ night: 0, water: 0, traffic: 0.5, park: 0, altitude: 1 }).wind;
    expect(hi).toBeGreaterThan(lo * 2);
  });
});

describe('new object sounds (R6-A)', () => {
  it('every surface has a footstep, and crash / door / bell / drawer sounds exist with metadata', async () => {
    const { ALL_META, EXTRA_RECIPES } = await import('./sfx');
    const { STEP_SURFACES } = await import('./sfx2');
    for (const s of STEP_SURFACES) { const k = `step${s[0].toUpperCase()}${s.slice(1)}`; expect(ALL_META[k as keyof typeof ALL_META]).toBeTruthy(); expect((EXTRA_RECIPES as Record<string, unknown>)[k]).toBeTruthy(); }
    for (const k of ['storeBell', 'registerDrawer', 'carDoorOpen', 'carDoorClose', 'crashLight', 'crashHeavy']) expect(ALL_META[k as keyof typeof ALL_META]).toBeTruthy();
  });
});
