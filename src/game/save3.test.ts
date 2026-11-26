import { describe, expect, it, vi } from 'vitest';
import { SAVE_KEY, SAVE_VERSION, lastSaved, onSaved, parseSave, parseVehicle, readSave, slotKey, vehicleSpawn, writeSave, type SaveData } from './save';

const v2 = { version: 2, savedAt: 5, mode: 'regular', money: 900, cars: [{ kind: 'coupe', paint: 1 }], pos: { x: 10, z: 20, yaw: 1 } };

describe('save v3', () => {
  it('migrates a v2 save to v3 with no vehicle', () => {
    const s = parseSave(JSON.stringify(v2))!;
    expect(s.version).toBe(SAVE_VERSION); expect(s.mode).toBe('regular'); expect(s.money).toBe(900); expect(s.cars).toHaveLength(1);
    expect(s.vehicle).toBeUndefined();
  });
  it('still loads v1 and rejects future / garbage versions', () => {
    expect(parseSave(JSON.stringify({ ...v2, version: 1 }))!.mode).toBe('sandbox');
    expect(parseSave(JSON.stringify({ ...v2, version: 9 }))).toBeNull();
    expect(parseSave('nope')).toBeNull();
  });
  it('round-trips the vehicle and drops invalid ones', () => {
    const raw = { ...v2, version: 3, vehicle: { kind: 'coupe', paint: 2.7, x: 12, z: 22, yaw: 0.5, health: 640 }, playSeconds: 123.9 };
    const s = parseSave(JSON.stringify(raw))!;
    expect(s.vehicle).toEqual({ kind: 'coupe', paint: 2, x: 12, z: 22, yaw: 0.5, health: 640 });
    expect(s.playSeconds).toBe(123);
    expect(parseVehicle({ kind: 'constructor', x: 1, z: 1 })).toBeUndefined();
    expect(parseVehicle({ kind: 'coupe', x: NaN, z: 1 })).toBeUndefined();
    expect(parseSave(JSON.stringify({ ...raw, vehicle: { kind: 'bogus', x: 1, z: 1 } }))!.vehicle).toBeUndefined();
  });
  it('places the saved car where it was when near on a road, else beside the player', () => {
    const sv = { kind: 'coupe' as const, paint: 0, x: 15, z: 20, yaw: 2 };
    const player = { x: 10, z: 20, yaw: 0 };
    expect(vehicleSpawn(sv, player, () => 'road')).toEqual({ x: 15, z: 20, yaw: 2 });
    const far = vehicleSpawn({ ...sv, x: 900 }, player, () => 'road');
    expect(Math.hypot(far.x - player.x, far.z - player.z)).toBeLessThan(5);
    const lot = vehicleSpawn(sv, player, (x, z) => (x === 15 && z === 20 ? 'lot' : 'road'));
    expect(lot.x).not.toBe(15);
  });
  it('writes version 3, supports slots, and notifies listeners with lastSaved', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    const d = parseSave(JSON.stringify(v2)) as SaveData;
    const fn = vi.fn(); const off = onSaved(fn);
    expect(writeSave(st, { ...d, version: 2 })).toBe(true);
    expect(JSON.parse(mem.get(SAVE_KEY)!).version).toBe(3);
    expect(lastSaved()).toBeGreaterThan(0); expect(fn).toHaveBeenCalledWith(expect.objectContaining({ ok: true, slot: 1 }));
    writeSave(st, d, 2); expect(mem.has(slotKey(2))).toBe(true); expect(readSave(st, 2)!.money).toBe(900); expect(readSave(st, 3)).toBeNull();
    off(); writeSave(st, d); expect(fn).toHaveBeenCalledTimes(2);
    expect(writeSave({ setItem: () => { throw new Error('quota'); } }, d)).toBe(false);
  });
});
