/** Versioned save data (localStorage). Pure functions are unit tested. */
import type { WeaponId, WeaponState } from '../combat/weapons';
import type { GameMode, OwnedCar } from './modes';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import { parseAppearance, type Appearance } from './grooming';
import type { SaleLog } from './garage';

export const SAVE_KEY = 'meridian-afterglow.save.v1';
export interface SaveData {
  /** 2 = game modes + owned cars (v1 saves migrate to a Sandbox game); 3 adds the current vehicle + play time. Writers may still stamp 2: parsing always yields 3. */
  version: 2 | 3; savedAt: number;
  mode: GameMode; cars: OwnedCar[]; milestones: string[]; robberies: number;
  money: number; health: number; armor: number;
  weapons: Record<WeaponId, WeaponState>; current: WeaponId; medkits: number;
  missions: string[]; collectibles: number[]; jumps: number[];
  pos: { x: number; z: number; yaw: number }; hour: number;
  stats: { kills: number; distance: number; crashes: number };
  /** Sandbox tool toggles (the game is sandbox-only; `missions` is kept for old saves and a possible story return). */
  tools?: SandboxTools;
  /** Barber / clothing purchases: only the fields that differ from the starting outfit. */
  appearance?: Appearance;
  /** Round 9: garage sale cooldowns (seconds left, per garage) and recent sales (kind, seconds ago) */
  garage?: SaleLog;
  /** v3: the car the player was driving / had parked beside them (kind, paint index into the kind's palette, position). */
  vehicle?: SavedVehicle;
  /** v3: seconds played (all sessions). */
  playSeconds?: number;
}
export interface SavedVehicle { kind: VehicleKind; paint: number; x: number; z: number; yaw: number; health?: number }
export const SAVE_VERSION = 3;
export interface SandboxTools { god: boolean; ammo: boolean; never: boolean; clock: boolean }
export function serialize(d: SaveData): string { return JSON.stringify(d); }
export function parseSave(raw: string | null): SaveData | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (![1, 2, 3].includes(d.version as number)) return null;
    if (typeof d.money !== 'number' || !d.pos || typeof d.pos.x !== 'number' || !Number.isFinite(d.pos.x) || !Number.isFinite(d.pos.z)) return null;
    return {
      version: SAVE_VERSION, savedAt: typeof d.savedAt === 'number' && Number.isFinite(d.savedAt) ? d.savedAt : 0,
      // v1 saves predate the modes: they were all sandbox games
      mode: (d.version as number) >= 2 && d.mode === 'regular' ? 'regular' : 'sandbox',
      cars: parseCars(d.cars), milestones: Array.isArray(d.milestones) ? d.milestones.filter(x => typeof x === 'string') : [], robberies: Math.max(0, Math.floor(Number(d.robberies) || 0)), money: Math.max(0, Math.floor(d.money)), health: clamp(d.health ?? 100, 1, 100), armor: clamp(d.armor ?? 0, 0, 100),
      weapons: d.weapons as SaveData['weapons'], current: d.current ?? 'fists', medkits: Math.max(0, d.medkits ?? 0),
      missions: Array.isArray(d.missions) ? d.missions.filter(x => typeof x === 'string') : [],
      collectibles: Array.isArray(d.collectibles) ? d.collectibles.filter(x => typeof x === 'number') : [],
      jumps: Array.isArray(d.jumps) ? d.jumps.filter(x => typeof x === 'number') : [],
      pos: { x: d.pos.x, z: d.pos.z, yaw: d.pos.yaw ?? 0 }, hour: clamp(d.hour ?? 17.5, 0, 24),
      stats: { kills: d.stats?.kills ?? 0, distance: d.stats?.distance ?? 0, crashes: d.stats?.crashes ?? 0 },
      ...(parseVehicle(d.vehicle) ? { vehicle: parseVehicle(d.vehicle) } : {}),
      ...(Number.isFinite(d.playSeconds) && (d.playSeconds as number) > 0 ? { playSeconds: Math.floor(d.playSeconds as number) } : {}),
      ...(parseSales(d.garage) ? { garage: parseSales(d.garage) } : {}),
      ...(parseAppearance(d.appearance) ? { appearance: parseAppearance(d.appearance) } : {}),
      ...(d.tools && typeof d.tools === 'object' ? { tools: { god: !!d.tools.god, ammo: !!d.tools.ammo, never: !!d.tools.never, clock: d.tools.clock !== false } } : {}),
    };
  } catch { return null; }
}
/** Validates a saved vehicle (unknown kinds / non-finite coordinates are dropped, so a bad blob never spawns a broken car). */
export function parseVehicle(v: unknown): SavedVehicle | undefined {
  const d = v as Partial<SavedVehicle> | null | undefined;
  if (!d || typeof d !== 'object' || typeof d.kind !== 'string' || !Object.hasOwn(VEHICLES, d.kind)) return undefined;
  if (typeof d.x !== 'number' || typeof d.z !== 'number' || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return undefined;
  const out: SavedVehicle = { kind: d.kind as VehicleKind, paint: typeof d.paint === 'number' && Number.isFinite(d.paint) ? Math.max(0, Math.floor(d.paint)) : 0, x: d.x, z: d.z, yaw: Number.isFinite(d.yaw) ? (d.yaw as number) : 0 };
  if (typeof d.health === 'number' && Number.isFinite(d.health)) out.health = clamp(d.health, 1, 1000);
  return out;
}
/**
 * Where to put the saved car on load: beside the player's resume spot (same ground rules as the player) so you wake up next to
 * it, or exactly where it was when that spot is valid ground and within `maxDist` of the player. Pure.
 */
export function vehicleSpawn(sv: SavedVehicle, player: { x: number; z: number; yaw: number }, surface: (x: number, z: number) => string, maxDist = 60): { x: number; z: number; yaw: number } {
  const fallback = { x: player.x + Math.cos(player.yaw + Math.PI / 2) * 3.5, z: player.z + Math.sin(player.yaw + Math.PI / 2) * 3.5, yaw: player.yaw };
  if (Math.hypot(sv.x - player.x, sv.z - player.z) <= maxDist && SAFE_SURFACES.has(surface(sv.x, sv.z)) && surface(sv.x, sv.z) !== 'sidewalk') return { x: sv.x, z: sv.z, yaw: sv.yaw };
  const p = safeSavePos(fallback, surface, player, 20);
  return { x: p.x, z: p.z, yaw: p.yaw };
}
function parseSales(v: unknown): SaleLog | undefined {
  const d = v as Partial<SaleLog> | undefined;
  if (!d || !Array.isArray(d.cool) || !Array.isArray(d.sold)) return undefined;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, x) : 0);
  return {
    cool: d.cool.slice(0, 8).map(num),
    sold: d.sold.filter(x => x && typeof x.kind === 'string' && Object.hasOwn(VEHICLES, x.kind)).slice(0, 60).map(x => ({ kind: x.kind as VehicleKind, age: num(x.age) })),
  };
}
function parseCars(v: unknown): OwnedCar[] {
  if (!Array.isArray(v)) return [];
  const out: OwnedCar[] = [];
  for (const c of v as { kind?: unknown; paint?: unknown }[]) {
    if (!c || typeof c.kind !== 'string' || !Object.hasOwn(VEHICLES, c.kind)) continue;
    out.push({ kind: c.kind as VehicleKind, paint: typeof c.paint === 'number' && Number.isFinite(c.paint) ? Math.max(0, Math.floor(c.paint)) : 0 });
    if (out.length >= 8) break;
  }
  return out;
}
/** One-line description of a save for the title's Continue button. */
export function saveSummary(d: SaveData, now = Date.now()): string {
  const m = Math.floor(Math.max(0, now - d.savedAt) / 60000), h = Math.floor(m / 60);
  const when = !d.savedAt ? 'earlier' : m < 2 ? 'just now' : m < 60 ? `${m} min ago` : h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
  return `${d.mode === 'regular' ? 'Regular' : 'Sandbox'}, $${d.money.toLocaleString('en-US')}, ${when}`;
}
const clamp = (v: number, a: number, b: number) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a);
// ---------------- slots + save notifications ----------------
/** Slot 1 is the original key; slots 2 and 3 are suffixed. */
export const SAVE_SLOTS = 3;
export const slotKey = (slot = 1): string => (slot <= 1 || !Number.isFinite(slot) ? SAVE_KEY : `${SAVE_KEY}.slot${Math.min(SAVE_SLOTS, Math.floor(slot))}`);
export function readSave(storage: Pick<Storage, 'getItem'> | null, slot = 1): SaveData | null {
  try { return parseSave(storage?.getItem(slotKey(slot)) ?? null); } catch { return null; }
}
export type SavedListener = (info: { savedAt: number; slot: number; ok: boolean }) => void;
const listeners = new Set<SavedListener>();
let lastSavedAt = 0;
/** Timestamp (ms) of the last successful write this session, 0 = none yet. A HUD "saving" icon can poll or subscribe. */
export function lastSaved(): number { return lastSavedAt; }
/** Subscribe to every write attempt (ok = it reached storage). Returns an unsubscribe function. */
export function onSaved(fn: SavedListener): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function writeSave(storage: Pick<Storage, 'setItem'> | null, d: SaveData, slot = 1): boolean {
  let ok = false;
  try { storage?.setItem(slotKey(slot), serialize({ ...d, version: SAVE_VERSION })); ok = !!storage; } catch { ok = false; }
  if (ok) lastSavedAt = Date.now();
  for (const fn of listeners) { try { fn({ savedAt: lastSavedAt, slot, ok }); } catch { /* a bad listener must not break saving */ } }
  return ok;
}
/** Ground kinds a player may be saved on / loaded onto (everything else: roofs and building lots, water, off-map). */
const SAFE_SURFACES = new Set(['road', 'sidewalk', 'park', 'beach']);
export interface SafePos { x: number; z: number; yaw: number; moved: boolean }
/**
 * A save position that is valid ground: the spot itself when it is street / pavement / park, else the nearest such spot found by
 * searching outward in rings (so a game saved on a roof or inside a lot resumes on the pavement outside), else `fallback`
 * (the safehouse). `surface` is the city's surface lookup. Pure, so it is unit tested.
 */
export function safeSavePos(pos: { x: number; z: number; yaw: number }, surface: (x: number, z: number) => string, fallback: { x: number; z: number; yaw: number }, maxR = 160): SafePos {
  const ok = (x: number, z: number) => Number.isFinite(x) && Number.isFinite(z) && SAFE_SURFACES.has(surface(x, z));
  if (ok(pos.x, pos.z)) return { ...pos, moved: false };
  for (let r = 3; r <= maxR; r += 3) {
    const n = Math.max(12, Math.round(r / 1.5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      if (ok(x, z) && surface(x, z) !== 'beach') return { x, z, yaw: pos.yaw, moved: true };
    }
  }
  return { x: fallback.x, z: fallback.z, yaw: fallback.yaw, moved: true };
}
