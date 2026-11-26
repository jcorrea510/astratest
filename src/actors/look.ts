/**
 * What a person looks like: sex, height/build, skin, hair, facial hair and outfit.
 * Older code builds Looks with only the original fields (sleeves/legs/hairStyle/hatStyle); resolveLook() fills in the rest.
 */
import { Rng, clamp } from '../core/rng';

export type Sex = 'm' | 'f';
export type HairStyle =
  | 'short' | 'buzz' | 'long' | 'bun' | 'ponytail' | 'bald' | 'curly'
  | 'fade' | 'crew' | 'slick' | 'afro' | 'braids' | 'cornrows' | 'bob' | 'parted' | 'buns' | 'pixie';
export type FacialHair = 'none' | 'stubble' | 'beard' | 'moustache' | 'goatee';
export type HatStyle = 'none' | 'cap' | 'beanie' | 'police';
export type TopStyle = 'tee' | 'tank' | 'longsleeve' | 'hoodie' | 'jacket' | 'suit' | 'shirt' | 'polo' | 'dress' | 'uniform' | 'blouse';
export type BottomStyle = 'jeans' | 'trousers' | 'shorts' | 'skirt' | 'sweats';
export type ShoeStyle = 'sneakers' | 'boots' | 'formal';
export type Pattern = 'plain' | 'stripes' | 'plaid' | 'graphic' | 'twotone' | 'pinstripe' | 'camo' | 'houndstooth';

export interface Look {
  skin: string; top: string; bottom: string; shoes: string; hair: string; hat: string; detail: string;
  sleeves: 'short' | 'long' | 'tank'; legs: 'pants' | 'shorts';
  hairStyle: HairStyle; hatStyle: HatStyle;
  /** Height multiplier: 1 = 1.78 m. */
  height: number;
  /** Width multiplier (shoulders/hips), ~0.9-1.12. */
  build: number;
  sex?: Sex; facial?: FacialHair; topStyle?: TopStyle; bottomStyle?: BottomStyle; shoeStyle?: ShoeStyle;
  /** Secondary garment colour: inner shirt, hood lining, stripes, print, tie. */
  accent?: string;
  pattern?: Pattern;
  /** 0..1 belly / softness. */
  weight?: number;
  /** Eye (iris) tint. */
  eyes?: string;
  /** Head size multiplier (~0.96-1.04) and jaw width (-1..1). */
  headScale?: number; jaw?: number;
}
export type FullLook = Required<Look>;

export const SKIN_TONES = ['#f3d2bb', '#ecc4a6', '#e9bf9f', '#dfae8a', '#d39d76', '#c58b63', '#b07650', '#9a6342', '#8a5839', '#784a30', '#683f29', '#5a3623', '#4e2f1f'];
/** Relative frequency of each SKIN_TONES entry: light-to-medium tones most common, a smooth fall-off into the deepest. */
const SKIN_WEIGHTS = [6, 9, 11, 12, 11, 10, 9, 8, 6, 4, 3, 2, 1.5];
const HAIR_DARK = ['#16110f', '#1d1612', '#271b14', '#33241a'];
const HAIR_BROWN = ['#3f2b1e', '#4f3523', '#5f412a', '#6e4b2f'];
const HAIR_LIGHT = ['#7d6040', '#94724a', '#a98a5c'];
const HAIR_BLOND = ['#b99a62', '#cdb27a', '#d9c392'];
const HAIR_RED = ['#6e3220', '#84401f', '#9a5026'];
const HAIR_GREY = ['#7f7b76', '#9a9690', '#bdbab4'];
// Clothing palettes are real-world fabric colours: no neon, no pure white/black (HSV saturation <= 0.6, value 0.1..0.93).
const NEUTRAL = ['#202226', '#33363b', '#4a4d52', '#6b6e72', '#9a9a96', '#c8c6bf', '#e2dfd6', '#ece9e0'];
const NAVY = ['#1d2840', '#26334f', '#2f3f5e'];
const EARTH = ['#3a2e25', '#54402f', '#6f5a43', '#8e7a5c', '#b3a07e', '#c9baa0', '#4a4f33', '#5c6340', '#6b4a3a', '#7a5a45'];
/** Muted accent colours (the minority): dusty, never saturated. */
const MUTED = ['#3d5a80', '#6b8cae', '#8aa4b8', '#7a3b3f', '#a05a4e', '#b8785a', '#b99a52', '#5e7f6a', '#7e9a82', '#4f6b66', '#6b5a7a', '#a58a96', '#c9a9a3', '#8b8f6a'];
const DENIM = ['#1f2b45', '#2a3b5c', '#3a4f78', '#4a6492', '#6a82a8', '#8ea3bf', '#a9b8cc', '#2b2d33'];
const CHINO = ['#2a2c31', '#3a3f4a', '#4e4a44', '#6f6250', '#a39275', '#bfae8c', '#4a4f33', '#1d2433'];
const SUIT_COLOURS = ['#1f2126', '#2b2d33', '#262f45', '#3d3f45', '#4a4a4f', '#54483c'];
const SHIRT_WHITES = ['#e6e3da', '#d9e0e8', '#ece4d4', '#c9d3df'];
const SNEAKER = ['#e6e3da', '#d4d2cb', '#202226', '#3d3f45', '#8a8d91', '#26334f', '#6b4a3a'];
const BOOT = ['#3a2a1e', '#5a3d26', '#202226', '#6f4f33'];
const FORMAL = ['#18181a', '#2a1d15', '#3a2a1e', '#4a3322'];
const HATS = ['#202226', '#33363b', '#26334f', '#6b6e72', '#4a4f33', '#7a3b3f', '#c8c6bf'];

/** Fills in the optional fields from the classic ones. */
export function resolveLook(l: Look): FullLook {
  const sex: Sex = l.sex ?? (['long', 'bun', 'ponytail', 'bob', 'buns', 'pixie'].includes(l.hairStyle) ? 'f' : 'm');
  const topStyle: TopStyle = l.topStyle ?? (l.hatStyle === 'police' ? 'uniform' : l.sleeves === 'tank' ? 'tank' : l.sleeves === 'long' ? 'longsleeve' : 'tee');
  const bottomStyle: BottomStyle = l.bottomStyle ?? (l.legs === 'shorts' ? 'shorts' : 'jeans');
  return {
    ...l, sex, topStyle, bottomStyle,
    facial: l.facial ?? 'none', shoeStyle: l.shoeStyle ?? (topStyle === 'uniform' || topStyle === 'suit' ? 'formal' : 'sneakers'),
    accent: l.accent ?? (topStyle === 'uniform' ? '#d9b44a' : '#ecebe6'), pattern: l.pattern ?? 'plain', weight: l.weight ?? 0.2,
    eyes: l.eyes ?? '#4a3020', headScale: l.headScale ?? 1, jaw: l.jaw ?? 0,
  };
}

const gauss = (r: Rng) => { let s = 0; for (let i = 0; i < 4; i++) s += r.next(); return (s - 2) / 0.577; };

/** Weighted index pick for SKIN_TONES. */
function pickSkin(r: Rng): number {
  let t = r.next() * SKIN_WEIGHTS.reduce((x, y) => x + y, 0);
  for (let i = 0; i < SKIN_WEIGHTS.length; i++) { t -= SKIN_WEIGHTS[i]; if (t < 0) return i; }
  return SKIN_WEIGHTS.length - 1;
}
/** Everyday garment colour: mostly neutrals/navy/earth/denim, a minority of muted accents. */
function garment(r: Rng): string {
  const t = r.next();
  return t < 0.36 ? r.pick(NEUTRAL) : t < 0.46 ? r.pick(NAVY) : t < 0.68 ? r.pick(EARTH) : t < 0.78 ? r.pick(DENIM.slice(0, 7)) : r.pick(MUTED);
}

/** A random everyday pedestrian. Deterministic per seed. */
export function randomLook(seed: number): FullLook {
  const r = new Rng(Math.imul(seed + 1, 2654435761) ^ 0x5bd1e995);
  const sex: Sex = r.chance(0.5) ? 'f' : 'm';
  const toneI = pickSkin(r);
  const skin = SKIN_TONES[toneI];
  const dark = toneI / (SKIN_TONES.length - 1);
  const old = r.chance(0.14);
  const hair = old ? r.pick(HAIR_GREY)
    : dark > 0.45 ? (r.chance(0.88) ? r.pick(HAIR_DARK) : r.pick(HAIR_BROWN))
    : r.chance(0.06) ? r.pick(HAIR_RED) : r.chance(0.07) ? r.pick(HAIR_BLOND) : r.chance(0.28) ? r.pick(HAIR_LIGHT) : r.chance(0.5) ? r.pick(HAIR_BROWN) : r.pick(HAIR_DARK);
  const tight = dark > 0.55 && r.chance(0.6); // tightly curled hair textures
  const heightM = sex === 'm' ? clamp(1.765 + gauss(r) * 0.07, 1.6, 1.95) : clamp(1.635 + gauss(r) * 0.065, 1.52, 1.82);
  let hairStyle: HairStyle;
  if (sex === 'm') hairStyle = old && r.chance(0.4) ? 'bald' : tight ? r.pick(['fade', 'buzz', 'afro', 'cornrows', 'braids', 'fade', 'curly', 'bald'] as const) : r.pick(['short', 'parted', 'crew', 'fade', 'slick', 'buzz', 'curly', 'short', 'parted', 'bald', 'long', 'bun'] as const);
  else hairStyle = tight ? r.pick(['afro', 'braids', 'bun', 'cornrows', 'curly', 'ponytail', 'long', 'bob'] as const) : r.pick(['long', 'long', 'ponytail', 'bun', 'buns', 'bob', 'curly', 'parted', 'pixie', 'braids'] as const);
  const facial: FacialHair = sex === 'f' ? 'none' : r.pick(['none', 'none', 'none', 'stubble', 'stubble', 'beard', 'moustache', 'goatee'] as const);

  // Outfit: pick the top first, then a bottom and shoes that go with it.
  const topStyle: TopStyle = sex === 'm'
    ? r.pick(['tee', 'tee', 'tee', 'hoodie', 'hoodie', 'jacket', 'jacket', 'shirt', 'polo', 'longsleeve', 'suit', 'tank'] as const)
    : r.pick(['tee', 'tee', 'blouse', 'blouse', 'hoodie', 'jacket', 'dress', 'dress', 'longsleeve', 'tank', 'suit', 'shirt'] as const);
  let bottomStyle: BottomStyle;
  switch (topStyle) {
    case 'suit': bottomStyle = 'trousers'; break;
    case 'dress': bottomStyle = 'skirt'; break;
    case 'hoodie': bottomStyle = r.pick(['jeans', 'jeans', 'sweats', 'sweats', 'shorts'] as const); break;
    case 'tank': bottomStyle = r.pick(['jeans', 'shorts', 'shorts', 'sweats', 'skirt'] as const); break;
    case 'polo': case 'shirt': bottomStyle = r.pick(['trousers', 'trousers', 'jeans', 'jeans', 'shorts'] as const); break;
    case 'blouse': bottomStyle = r.pick(['skirt', 'trousers', 'jeans', 'jeans'] as const); break;
    case 'jacket': bottomStyle = r.pick(['jeans', 'jeans', 'trousers', 'sweats'] as const); break;
    default: bottomStyle = sex === 'f' ? r.pick(['jeans', 'jeans', 'skirt', 'trousers', 'shorts', 'sweats'] as const) : r.pick(['jeans', 'jeans', 'jeans', 'trousers', 'shorts', 'sweats'] as const);
  }
  // Formal shoes only with dressy outfits; shorts/sweats/hoodies/tanks are always casual footwear.
  const dressy = topStyle === 'suit' || topStyle === 'dress' || ((topStyle === 'shirt' || topStyle === 'polo' || topStyle === 'blouse') && bottomStyle === 'trousers');
  const casualOnly = bottomStyle === 'shorts' || bottomStyle === 'sweats' || topStyle === 'hoodie' || topStyle === 'tank';
  const shoeStyle: ShoeStyle = topStyle === 'suit' ? 'formal'
    : casualOnly ? r.pick(['sneakers', 'sneakers', 'sneakers', 'boots'] as const)
    : dressy ? r.pick(['formal', 'formal', 'sneakers', 'boots'] as const)
    : r.pick(['sneakers', 'sneakers', 'sneakers', 'boots'] as const);
  let top = topStyle === 'suit' ? r.pick(SUIT_COLOURS) : garment(r);
  const bottom = topStyle === 'suit' ? top : bottomStyle === 'jeans' ? r.pick(DENIM)
    : bottomStyle === 'sweats' ? r.pick(['#2b2d33', '#4a4d52', '#8a8d91', '#26334f'])
    : bottomStyle === 'skirt' ? (r.chance(0.6) ? r.pick([...NEUTRAL.slice(0, 6), ...NAVY]) : r.pick([...EARTH, ...MUTED]))
    : r.pick(CHINO);
  // Never a top identical to the trousers unless it is a suit/dress.
  if (topStyle !== 'suit' && topStyle !== 'dress' && top === bottom) top = r.pick(NEUTRAL.slice(4));
  const shoes = shoeStyle === 'sneakers' ? r.pick(SNEAKER) : shoeStyle === 'boots' ? r.pick(BOOT) : r.pick(FORMAL);
  const inner = topStyle === 'jacket' || topStyle === 'hoodie' || topStyle === 'suit';
  // Accent: the shirt under a jacket/suit, otherwise a plausible pair for the top (light/dark neutral or a muted tone).
  const accent = topStyle === 'suit' ? r.pick(SHIRT_WHITES) : inner ? r.pick([...NEUTRAL.slice(3), ...SHIRT_WHITES]) : r.chance(0.7) ? r.pick(NEUTRAL.slice(4)) : r.pick(MUTED);
  const hatStyle: HatStyle = ['afro', 'bun', 'buns', 'long', 'ponytail', 'braids', 'bob'].includes(hairStyle) || topStyle === 'suit' || topStyle === 'dress' ? 'none' : r.chance(0.14) ? r.pick(['cap', 'cap', 'beanie'] as const) : 'none';
  // Patterns are rare (~13% of tops) and only on garments where they read as real.
  let pattern: Pattern = 'plain';
  if (r.chance(0.13)) {
    if (topStyle === 'shirt') pattern = r.pick(['plaid', 'stripes', 'plaid'] as const);
    else if (topStyle === 'longsleeve' || topStyle === 'polo') pattern = 'stripes';
    else if (topStyle === 'tee') pattern = r.pick(['graphic', 'stripes', 'twotone'] as const);
    else if (topStyle === 'blouse' || topStyle === 'dress') pattern = r.pick(['stripes', 'twotone'] as const);
    else if (topStyle === 'hoodie') pattern = 'twotone';
    else if (topStyle === 'suit') pattern = 'pinstripe';
  }
  if (pattern === 'pinstripe') { const c = r.pick(['#262f45', '#33363b', '#202226']); top = c; }
  const finalBottom = topStyle === 'suit' ? top : bottom;
  const sleeves = topStyle === 'tank' ? 'tank' : ['tee', 'polo', 'blouse', 'dress'].includes(topStyle) && r.chance(0.8) ? 'short' : 'long';
  return {
    sex, skin, hair, hairStyle, facial, hatStyle, topStyle, bottomStyle, shoeStyle, pattern, accent,
    top, bottom: finalBottom, shoes, hat: r.pick(HATS), detail: r.pick(['#2a1d15', '#202226', '#5a3d26']),
    sleeves, legs: bottomStyle === 'shorts' ? 'shorts' : 'pants',
    height: heightM / 1.78, build: clamp((sex === 'm' ? 1.02 : 0.97) + gauss(r) * 0.04, 0.9, 1.12),
    weight: clamp(Math.abs(gauss(r)) * 0.35 + (old ? 0.2 : 0), 0, 1),
    eyes: dark > 0.3 ? r.pick(['#2a1a10', '#3a2416', '#4a3020']) : r.pick(['#3a5a7a', '#4a6a50', '#4a3020', '#6a5030', '#5a7a9a']),
    headScale: 0.97 + r.next() * 0.06, jaw: r.range(-1, 1),
  };
}

/** The player's default outfit: dark bomber jacket over a cream tee, slim black jeans, white sneakers, clean fade. */
export const PLAYER_DEFAULT_LOOK: FullLook = {
  sex: 'm', skin: '#b07650', hair: '#151110', hairStyle: 'fade', facial: 'stubble', hatStyle: 'none',
  topStyle: 'jacket', bottomStyle: 'jeans', shoeStyle: 'sneakers', pattern: 'plain', accent: '#ece6d6',
  top: '#66764a', bottom: '#2b2f38', shoes: '#f2f0ea', hat: '#1c1d21', detail: '#c9a54a',
  sleeves: 'long', legs: 'pants', height: 1.0, build: 1.04, weight: 0.05, eyes: '#2a1a10', headScale: 1, jaw: 0.3,
};
