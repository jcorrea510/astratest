/** Weapon wheel entries: one slot per category (melee, pistols, SMGs, shotguns, rifles, heavy, throwables) + first aid. */
import type { WheelSlot } from '../ui/contracts';
import { CATEGORY_NAME, CATEGORY_ORDER, WEAPONS, type Inventory, type WeaponCat } from './weapons';

export const CAT_PREFIX = 'cat:';
/** Slots for the wheel. A category shows the weapon it would equip (scroll while highlighted to change it). */
/** Categories a gun can be used from a car seat (drive-by): Round 7 in-car wheel. */
export const CAR_CATS: ReadonlySet<WeaponCat> = new Set(['melee', 'pistol', 'smg', 'shotgun', 'rifle'] as WeaponCat[]);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
function weaponWheelStats(id: keyof typeof WEAPONS): WheelSlot['stats'] {
  const w = WEAPONS[id];
  if (w.melee) return [{ label: 'Damage', value: clamp01(w.damage / 80) }, { label: 'Speed', value: clamp01(0.5 / w.interval) }];
  if (w.cat === 'throw') return [{ label: 'Blast', value: clamp01(w.damage / 160) }, { label: 'Range', value: clamp01(w.range / 50) }];
  return [
    { label: 'Damage', value: clamp01((w.damage * Math.min(w.pellets, 4)) / 120) },
    { label: 'Fire rate', value: clamp01(0.14 / w.interval) },
    { label: 'Range', value: clamp01(w.range / 260) },
    { label: 'Magazine', value: clamp01(w.clip / 60) },
  ];
}
export function wheelSlots(inv: Inventory, canHeal: boolean, inCar = false): WheelSlot[] {
  const slots: WheelSlot[] = CATEGORY_ORDER.map(cat => {
    const id = inv.categoryPick(cat); const list = inv.inCategory(cat);
    if (inCar && !CAR_CATS.has(cat)) return { id: CAT_PREFIX + cat, label: CATEGORY_NAME[cat], icon: cat === 'throw' ? 'grenade' : 'lmg', detail: 'Not in a car', enabled: false };
    if (!id) return { id: CAT_PREFIX + cat, label: CATEGORY_NAME[cat], icon: cat === 'melee' ? 'fists' : cat === 'throw' ? 'grenade' : cat === 'heavy' ? 'lmg' : (cat as 'pistol' | 'smg' | 'shotgun' | 'rifle'), detail: 'Empty', enabled: false };
    const w = WEAPONS[id], st = inv.weapons[id];
    const more = list.length > 1 ? `  · ${list.indexOf(id) + 1}/${list.length}` : ''; // scroll the mouse wheel over the slot to switch
    const detail = w.melee ? `Melee${more}` : w.cat === 'throw' ? `x${inv.total(id)}${more}` : `${st.clip} / ${st.reserve}${more}`;
    return { id: CAT_PREFIX + cat, label: w.name, icon: w.icon, detail, enabled: true, stats: weaponWheelStats(id) };
  });
  slots.push({ id: 'medkit', label: 'First-aid kit', icon: 'medkit', detail: `x${inv.medkits}`, enabled: inv.medkits > 0 && canHeal && !inCar });
  return slots;
}
/** The current weapon's slot id (for highlighting when the wheel opens). */
export function currentSlot(inv: Inventory): string { return CAT_PREFIX + WEAPONS[inv.current].cat; }
/** Equips the weapon a chosen slot stands for. Returns true when the weapon changed. */
export function selectSlot(inv: Inventory, slotId: string): boolean {
  if (!slotId.startsWith(CAT_PREFIX)) return inv.select(slotId as never);
  const id = inv.categoryPick(slotId.slice(CAT_PREFIX.length) as WeaponCat);
  return !!id && inv.select(id);
}
/** Scrolls the weapon shown in a category slot. */
export function scrollSlot(inv: Inventory, slotId: string, dir: 1 | -1): boolean {
  if (!slotId.startsWith(CAT_PREFIX)) return false;
  return !!inv.cycleCategory(slotId.slice(CAT_PREFIX.length) as WeaponCat, dir);
}
