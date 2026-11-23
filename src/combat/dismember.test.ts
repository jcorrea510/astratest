import { describe, it, expect } from 'vitest';
import { WEAPONS } from './weapons';
import { MAX_PIECES, LIMB_HP, jointFor, jointKind, nearestJoint, severChance, shouldSever, addLimbDamage, resetLimbs, type Seg } from './dismember';
import { zoneDamage } from './hitzones';

describe('dismemberment rules (Round 9)', () => {
  it('maps the part hit to the joint it comes off at', () => {
    expect(jointFor('arm', true, 'L')).toBe('shoulderL');
    expect(jointFor('arm', false, 'R')).toBe('elbowR');
    expect(jointFor('leg', true, 'R')).toBe('hipR');
    expect(jointFor('leg', false, 'L')).toBe('kneeL');
    expect(jointKind('kneeL')).toBe('leg'); expect(jointKind('elbowR')).toBe('arm');
  });
  it('picks the nearest segment of the limb', () => {
    const segs: Seg[] = [
      { id: 'shoulderL', ax: 0, ay: 1.4, az: 0, bx: 0, by: 1.1, bz: 0 }, { id: 'elbowL', ax: 0, ay: 1.1, az: 0, bx: 0, by: 0.85, bz: 0 },
      { id: 'shoulderR', ax: 0.5, ay: 1.4, az: 0, bx: 0.5, by: 1.1, bz: 0 }, { id: 'elbowR', ax: 0.5, ay: 1.1, az: 0, bx: 0.5, by: 0.85, bz: 0 },
    ];
    expect(nearestJoint(0.02, 1.3, 0, segs)).toBe('shoulderL');
    expect(nearestJoint(0.52, 0.9, 0, segs)).toBe('elbowR');
  });
  it('heavy rounds sever in one hit in range, pistols and SMGs do not', () => {
    expect(severChance(WEAPONS.shotgun, 5)).toBe(1);
    expect(severChance(WEAPONS.shotgun, 30)).toBe(0);
    expect(severChance(WEAPONS.sniper, 60)).toBe(1);
    expect(severChance(WEAPONS.revolver, 20)).toBe(1);
    expect(severChance(WEAPONS.rifle, 20)).toBeGreaterThan(0);
    expect(severChance(WEAPONS.pistol, 2)).toBe(0);
    expect(severChance(WEAPONS.smg, 2)).toBe(0);
    expect(severChance(WEAPONS.bat, 1)).toBe(0);
    expect(shouldSever(WEAPONS.shotgun, 4, 0)).toBe(true);
    expect(shouldSever(WEAPONS.pistol, 4, 10)).toBe(false);
  });
  it('pistols and SMGs wear a limb down: a few hits, then it comes off', () => {
    for (const [id, zone, max] of [['pistol', 'arm', 2], ['pistol', 'leg', 2], ['smg', 'arm', 5], ['machinePistol', 'leg', 5]] as const) {
      const w = WEAPONS[id], key = {}; let n = 0, off = false;
      while (!off && n < 20) { n++; off = shouldSever(w, 6, addLimbDamage(key, 'elbowL', zoneDamage(w, zone, 6, { isPlayer: false, vest: false }).damage)); }
      expect(off).toBe(true); expect(n).toBeGreaterThan(1); expect(n).toBeLessThanOrEqual(max);
    }
    const k = {}; addLimbDamage(k, 'hipL', LIMB_HP - 1); expect(addLimbDamage(k, 'hipR', 5)).toBe(5); resetLimbs(k); expect(addLimbDamage(k, 'hipL', 1)).toBe(1);
  });
  it('keeps the live piece cap small', () => { expect(MAX_PIECES).toBeLessThanOrEqual(10); expect(MAX_PIECES).toBeGreaterThanOrEqual(6); });
});
