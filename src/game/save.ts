/** Versioned save data (localStorage). Pure functions are unit tested. */
import type { WeaponId, WeaponState } from '../combat/weapons';

export const SAVE_KEY = 'meridian-afterglow.save.v1';
export interface SaveData {
  version: 1; savedAt: number;
  money: number; health: number; armor: number;
  weapons: Record<WeaponId, WeaponState>; current: WeaponId; medkits: number;
  missions: string[]; collectibles: number[]; jumps: number[];
  pos: { x: number; z: number; yaw: number }; hour: number;
  stats: { kills: number; distance: number; crashes: number };
  /** Sandbox tool toggles (the game is sandbox-only; `missions` is kept for old saves and a possible story return). */
  tools?: SandboxTools;
}
export interface SandboxTools { god: boolean; ammo: boolean; never: boolean; clock: boolean }
export function serialize(d: SaveData): string { return JSON.stringify(d); }
export function parseSave(raw: string | null): SaveData | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (d.version !== 1 || typeof d.money !== 'number' || !d.pos || typeof d.pos.x !== 'number' || !Number.isFinite(d.pos.x) || !Number.isFinite(d.pos.z)) return null;
    return {
      version: 1, savedAt: d.savedAt ?? 0, money: Math.max(0, Math.floor(d.money)), health: clamp(d.health ?? 100, 1, 100), armor: clamp(d.armor ?? 0, 0, 100),
      weapons: d.weapons as SaveData['weapons'], current: d.current ?? 'fists', medkits: Math.max(0, d.medkits ?? 0),
      missions: Array.isArray(d.missions) ? d.missions.filter(x => typeof x === 'string') : [],
      collectibles: Array.isArray(d.collectibles) ? d.collectibles.filter(x => typeof x === 'number') : [],
      jumps: Array.isArray(d.jumps) ? d.jumps.filter(x => typeof x === 'number') : [],
      pos: { x: d.pos.x, z: d.pos.z, yaw: d.pos.yaw ?? 0 }, hour: clamp(d.hour ?? 17.5, 0, 24),
      stats: { kills: d.stats?.kills ?? 0, distance: d.stats?.distance ?? 0, crashes: d.stats?.crashes ?? 0 },
      ...(d.tools && typeof d.tools === 'object' ? { tools: { god: !!d.tools.god, ammo: !!d.tools.ammo, never: !!d.tools.never, clock: d.tools.clock !== false } } : {}),
    };
  } catch { return null; }
}
const clamp = (v: number, a: number, b: number) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a);
export function readSave(storage: Pick<Storage, 'getItem'> | null): SaveData | null {
  try { return parseSave(storage?.getItem(SAVE_KEY) ?? null); } catch { return null; }
}
export function writeSave(storage: Pick<Storage, 'setItem'> | null, d: SaveData): boolean {
  try { storage?.setItem(SAVE_KEY, serialize(d)); return !!storage; } catch { return false; }
}
export function clearSave(storage: Pick<Storage, 'removeItem'> | null) { try { storage?.removeItem(SAVE_KEY); } catch { /* ignore */ } }
