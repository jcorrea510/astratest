/** Barber shop and clothing store catalogue: what can be bought, what it costs, and the saved appearance. Pure (unit tested). */
import { type Look, type FullLook, type HairStyle, type FacialHair, type HatStyle, type TopStyle, type BottomStyle, type ShoeStyle, type Pattern, resolveLook } from '../actors/look';

export type ShopType = 'barber' | 'clothing';
export type GroomField = 'hairStyle' | 'hair' | 'facial' | 'topStyle' | 'top' | 'pattern' | 'accent' | 'bottomStyle' | 'bottom' | 'shoeStyle' | 'shoes' | 'hatStyle' | 'hat';
export interface GroomOption { id: string; label: string; price: number; swatch?: string }
export interface GroomTab { id: GroomField; label: string; kind: 'list' | 'colour'; options: GroomOption[] }

const HAIR_LABEL: Record<HairStyle, string> = {
  short: 'Short crop', buzz: 'Buzz cut', long: 'Long', bun: 'Top knot', ponytail: 'Ponytail', bald: 'Shaved bald', curly: 'Curls', fade: 'Skin fade',
  crew: 'Crew cut', slick: 'Slick back', afro: 'Afro', braids: 'Braids', cornrows: 'Cornrows', bob: 'Bob', parted: 'Side part', buns: 'Twin buns', pixie: 'Pixie',
};
/** Cuts offered to a male / female player (the body model decides which sex the player is; both can pick any common cut). */
const HAIR_M: HairStyle[] = ['short', 'fade', 'crew', 'buzz', 'slick', 'parted', 'curly', 'afro', 'cornrows', 'long', 'bun', 'ponytail', 'bald'];
const HAIR_F: HairStyle[] = ['long', 'ponytail', 'bun', 'buns', 'bob', 'pixie', 'parted', 'curly', 'afro', 'cornrows', 'short', 'buzz', 'bald'];
export const HAIR_COLOURS: [string, string][] = [
  ['Jet black', '#151110'], ['Black brown', '#2a1d15'], ['Chestnut', '#4f3523'], ['Auburn', '#7b3a1e'], ['Copper', '#a95a2e'], ['Dark blond', '#8a6a43'],
  ['Honey blond', '#c9a56a'], ['Platinum', '#e6d2a4'], ['Silver', '#a9a59f'], ['White', '#e8e6e0'], ['Midnight blue', '#1f3a7a'], ['Teal', '#1fa89a'],
  ['Violet', '#7a3fb0'], ['Hot pink', '#e0508a'], ['Crimson', '#b3202c'],
];
const FACIAL_LABEL: Record<FacialHair, string> = { none: 'Clean shaven', stubble: 'Stubble', beard: 'Full beard', moustache: 'Moustache', goatee: 'Goatee' };

const TOP_LABEL: Record<TopStyle, string> = { tee: 'T-shirt', tank: 'Tank top', longsleeve: 'Long sleeve', hoodie: 'Hoodie', jacket: 'Bomber jacket', suit: 'Suit jacket', shirt: 'Button shirt', polo: 'Polo', dress: 'Dress', uniform: 'Uniform', blouse: 'Blouse' };
const TOP_PRICE: Partial<Record<TopStyle, number>> = { tee: 30, tank: 25, longsleeve: 40, hoodie: 60, jacket: 120, suit: 220, shirt: 55, polo: 45, dress: 90, blouse: 50 };
const TOPS_M: TopStyle[] = ['tee', 'tank', 'longsleeve', 'polo', 'shirt', 'hoodie', 'jacket', 'suit'];
const TOPS_F: TopStyle[] = ['tee', 'tank', 'longsleeve', 'blouse', 'dress', 'shirt', 'hoodie', 'jacket', 'suit'];
const BOTTOM_LABEL: Record<BottomStyle, string> = { jeans: 'Jeans', trousers: 'Trousers', shorts: 'Shorts', skirt: 'Skirt', sweats: 'Sweatpants' };
const BOTTOM_PRICE: Record<BottomStyle, number> = { jeans: 60, trousers: 75, shorts: 40, skirt: 55, sweats: 45 };
const SHOE_LABEL: Record<ShoeStyle, string> = { sneakers: 'Sneakers', boots: 'Boots', formal: 'Dress shoes' };
const SHOE_PRICE: Record<ShoeStyle, number> = { sneakers: 70, boots: 95, formal: 85 };
const HAT_LABEL: Record<Exclude<HatStyle, 'police'>, string> = { none: 'No hat', cap: 'Ball cap', beanie: 'Beanie' };
const HAT_PRICE: Record<Exclude<HatStyle, 'police'>, number> = { none: 0, cap: 30, beanie: 25 };
const PATTERN_LABEL: Record<Pattern, string> = { plain: 'Plain', stripes: 'Breton stripes', plaid: 'Flannel plaid', graphic: 'Graphic print', twotone: 'Two-tone sleeves', pinstripe: 'Pinstripe', camo: 'Woodland camo', houndstooth: 'Houndstooth' };

export const CLOTH_COLOURS: [string, string][] = [
  ['Black', '#1c1d21'], ['Charcoal', '#3d3f45'], ['Gray', '#8a8d91'], ['Cream', '#ecebe6'], ['White', '#f6f4ee'], ['Navy', '#1f3a5f'], ['Denim blue', '#3f6e9a'], ['Sky', '#8fb3c9'],
  ['Wine', '#7a1f2b'], ['Red', '#b3202c'], ['Rust', '#b5523b'], ['Orange', '#d07a3a'], ['Mustard', '#d9a441'], ['Olive', '#66764a'], ['Forest', '#2f6b4f'], ['Teal', '#3b7f6e'],
  ['Purple', '#5c3f73'], ['Pink', '#e3a3a8'], ['Tan', '#a08560'], ['Brown', '#5a4636'],
  // Round 9: more shades
  ['Ivory', '#e9e1cf'], ['Heather gray', '#9b9a96'], ['Slate', '#4f5b66'], ['Royal blue', '#2c4fa3'], ['Burgundy', '#5e1a24'], ['Camel', '#b08a5a'], ['Sage', '#8fa088'], ['Lilac', '#a893c4'],
];
const DENIM_COLOURS: [string, string][] = [['Raw denim', '#2a3b5c'], ['Indigo', '#33497a'], ['Mid wash', '#4a6492'], ['Light wash', '#8aa0c0'], ['Black', '#1c1d21'], ['Charcoal', '#3a3f4a'], ['Khaki', '#b4a07c'], ['Stone', '#c9b993'], ['Olive', '#4b5131'], ['Brown', '#5a4636']];
const SHOE_COLOURS: [string, string][] = [['White', '#f2f0ea'], ['Black', '#1c1d21'], ['Gray', '#8a8d91'], ['Red', '#9c2f35'], ['Blue', '#2d4f7c'], ['Tan', '#7a5a3a'], ['Brown', '#3a2a1e']];

const swatches = (cs: [string, string][], price: number): GroomOption[] => cs.map(([label, hex]) => ({ id: hex, label, price, swatch: hex }));

export function barberTabs(sex: 'm' | 'f'): GroomTab[] {
  return [
    { id: 'hairStyle', label: 'Haircut', kind: 'list', options: (sex === 'f' ? HAIR_F : HAIR_M).map(id => ({ id, label: HAIR_LABEL[id], price: id === 'bald' || id === 'buzz' ? 15 : id === 'braids' || id === 'cornrows' ? 55 : 30 })) },
    { id: 'hair', label: 'Hair color', kind: 'colour', options: swatches(HAIR_COLOURS, 35) },
    { id: 'facial', label: 'Facial hair', kind: 'list', options: (sex === 'f' ? ['none'] as FacialHair[] : ['none', 'stubble', 'moustache', 'goatee', 'beard'] as FacialHair[]).map(id => ({ id, label: FACIAL_LABEL[id], price: id === 'none' ? 10 : 18 })) },
  ];
}
export function clothingTabs(sex: 'm' | 'f'): GroomTab[] {
  return [
    { id: 'topStyle', label: 'Tops', kind: 'list', options: (sex === 'f' ? TOPS_F : TOPS_M).map(id => ({ id, label: TOP_LABEL[id], price: TOP_PRICE[id] ?? 40 })) },
    { id: 'top', label: 'Top color', kind: 'colour', options: swatches(CLOTH_COLOURS, 12) },
    { id: 'pattern', label: 'Pattern', kind: 'list', options: (Object.keys(PATTERN_LABEL) as Pattern[]).map(id => ({ id, label: PATTERN_LABEL[id], price: id === 'plain' ? 0 : id === 'pinstripe' || id === 'houndstooth' ? 35 : 15 })) },
    { id: 'accent', label: 'Accent color', kind: 'colour', options: swatches(CLOTH_COLOURS, 8) },
    { id: 'bottomStyle', label: 'Pants', kind: 'list', options: (Object.keys(BOTTOM_LABEL) as BottomStyle[]).filter(b => sex === 'f' || b !== 'skirt').map(id => ({ id, label: BOTTOM_LABEL[id], price: BOTTOM_PRICE[id] })) },
    { id: 'bottom', label: 'Pants color', kind: 'colour', options: swatches(DENIM_COLOURS, 10) },
    { id: 'shoeStyle', label: 'Shoes', kind: 'list', options: (Object.keys(SHOE_LABEL) as ShoeStyle[]).map(id => ({ id, label: SHOE_LABEL[id], price: SHOE_PRICE[id] })) },
    { id: 'shoes', label: 'Shoe color', kind: 'colour', options: swatches(SHOE_COLOURS, 8) },
    { id: 'hatStyle', label: 'Hats', kind: 'list', options: (Object.keys(HAT_LABEL) as (keyof typeof HAT_LABEL)[]).map(id => ({ id, label: HAT_LABEL[id], price: HAT_PRICE[id] })) },
    { id: 'hat', label: 'Hat color', kind: 'colour', options: swatches(CLOTH_COLOURS, 6) },
  ];
}
export const tabsFor = (type: ShopType, sex: 'm' | 'f') => type === 'barber' ? barberTabs(sex) : clothingTabs(sex);
export const GROOM_FIELDS: GroomField[] = [...barberTabs('m'), ...clothingTabs('m')].map(t => t.id);

/** Price of one option when the current value differs (0 when nothing changes). Hat/pattern colours only count when they show. */
export function optionPrice(tab: GroomTab, id: string, cur: FullLook): number {
  if ((cur as unknown as Record<string, string>)[tab.id] === id) return 0;
  return tab.options.find(o => o.id === id)?.price ?? 0;
}
/** What the pending look costs relative to the one the player owns now. `type` limits the fields (a barber only sells hair). */
export function lookCost(type: ShopType, owned: FullLook, pending: FullLook): number {
  let sum = 0;
  for (const t of tabsFor(type, owned.sex)) {
    const o = owned as unknown as Record<string, string>, p = pending as unknown as Record<string, string>;
    if (o[t.id] === p[t.id]) continue;
    if (t.id === 'hat' && p.hatStyle === 'none') continue; // colour of no hat
    sum += t.options.find(x => x.id === p[t.id])?.price ?? 0;
  }
  return sum;
}
/** True when `pending` differs from `owned` in a field the shop sells. */
export const lookChanged = (type: ShopType, owned: FullLook, pending: FullLook) => tabsFor(type, owned.sex).some(t => (owned as unknown as Record<string, string>)[t.id] !== (pending as unknown as Record<string, string>)[t.id]);

export type Appearance = Partial<Pick<Look, GroomField>>;
/** The fields of `look` that differ from `base` (what is written to the save). Empty when nothing was changed. */
export function appearanceDiff(base: FullLook, look: FullLook): Appearance {
  const out: Record<string, string> = {};
  for (const f of GROOM_FIELDS) if ((base as unknown as Record<string, string>)[f] !== (look as unknown as Record<string, string>)[f]) out[f] = (look as unknown as Record<string, string>)[f];
  return out as Appearance;
}
const HEX = /^#[0-9a-fA-F]{6}$/;
const ALLOWED: Partial<Record<GroomField, Set<string>>> = (() => {
  const m: Partial<Record<GroomField, Set<string>>> = {};
  for (const t of [...barberTabs('f'), ...barberTabs('m'), ...clothingTabs('f'), ...clothingTabs('m')]) if (t.kind === 'list') { const s = m[t.id] ?? (m[t.id] = new Set()); for (const o of t.options) s.add(o.id); }
  return m;
})();
/** Validates a saved appearance object (hand-edited or old saves never break the player model). */
export function parseAppearance(v: unknown): Appearance | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const f of GROOM_FIELDS) {
    const x = (v as Record<string, unknown>)[f];
    if (typeof x !== 'string') continue;
    const allowed = ALLOWED[f];
    if (allowed ? allowed.has(x) : HEX.test(x)) out[f] = x;
  }
  return Object.keys(out).length ? out as Appearance : undefined;
}
export const dressed = (base: Look, a?: Appearance): FullLook => resolveLook({ ...base, ...(a ?? {}) });
