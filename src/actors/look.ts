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
const HAIR_DARK = ['#151110', '#1d1612', '#2a1d15', '#33241a'];
const HAIR_BROWN = ['#3f2b1e', '#4f3523', '#5f412a', '#6e4b2f'];
const HAIR_LIGHT = ['#8a6a43', '#a8834f', '#c9a56a', '#dcc08a', '#e6d2a4'];
const HAIR_RED = ['#7b3a1e', '#93451f', '#a95a2e'];
const HAIR_GREY = ['#8b8782', '#a9a59f', '#cfccc6'];
const NEUTRAL = ['#1c1d21', '#3d3f45', '#5b5e63', '#8a8d91', '#b9b7b0', '#c9c8c3', '#ecebe6', '#f6f4ee'];
const EARTH = ['#3a2e25', '#5a4636', '#7a6248', '#a08560', '#c2a982', '#d8c8a8', '#4b5131', '#5f6a3a', '#6b4a3a'];
const COLOUR = ['#1f3a5f', '#2d4f7c', '#3f6e9a', '#6f8fb0', '#7a1f2b', '#9c2f35', '#b5523b', '#d07a3a', '#d9a441', '#2f6b4f', '#3b7f6e', '#5c3f73', '#b36a8a', '#e3a3a8', '#8fb3c9', '#cfa93e'];
const DENIM = ['#2a3b5c', '#33497a', '#3f5a8c', '#4a6492', '#6f87ad', '#8aa0c0', '#2b2d33'];
const CHINO = ['#2a2c31', '#3a3f4a', '#5a5048', '#7d6c55', '#b4a07c', '#c9b993', '#4b5131', '#1d2433'];

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

/** A random everyday pedestrian. Deterministic per seed. */
export function randomLook(seed: number): FullLook {
  const r = new Rng(Math.imul(seed + 1, 2654435761) ^ 0x5bd1e995);
  const sex: Sex = r.chance(0.5) ? 'f' : 'm';
  const toneI = Math.min(SKIN_TONES.length - 1, Math.floor(r.next() * SKIN_TONES.length));
  const skin = SKIN_TONES[toneI];
  const dark = toneI / (SKIN_TONES.length - 1);
  const old = r.chance(0.14);
  const hair = old ? r.pick(HAIR_GREY)
    : dark > 0.45 ? (r.chance(0.85) ? r.pick(HAIR_DARK) : r.pick(HAIR_BROWN))
    : r.chance(0.12) ? r.pick(HAIR_RED) : r.chance(0.3) ? r.pick(HAIR_LIGHT) : r.chance(0.5) ? r.pick(HAIR_BROWN) : r.pick(HAIR_DARK);
  const tight = dark > 0.55 && r.chance(0.6); // tightly curled hair textures
  const heightM = sex === 'm' ? clamp(1.765 + gauss(r) * 0.07, 1.6, 1.95) : clamp(1.635 + gauss(r) * 0.065, 1.52, 1.82);
  let hairStyle: HairStyle;
  if (sex === 'm') hairStyle = old && r.chance(0.4) ? 'bald' : tight ? r.pick(['fade', 'buzz', 'afro', 'cornrows', 'braids', 'fade', 'curly', 'bald'] as const) : r.pick(['short', 'parted', 'crew', 'fade', 'slick', 'buzz', 'curly', 'short', 'parted', 'bald', 'long', 'bun'] as const);
  else hairStyle = tight ? r.pick(['afro', 'braids', 'bun', 'cornrows', 'curly', 'ponytail', 'long', 'bob'] as const) : r.pick(['long', 'long', 'ponytail', 'bun', 'buns', 'bob', 'curly', 'parted', 'pixie', 'braids'] as const);
  const facial: FacialHair = sex === 'f' ? 'none' : r.pick(['none', 'none', 'none', 'stubble', 'stubble', 'beard', 'moustache', 'goatee'] as const);
  // Outfit
  const topStyle: TopStyle = sex === 'm'
    ? r.pick(['tee', 'tee', 'tee', 'hoodie', 'jacket', 'shirt', 'polo', 'longsleeve', 'suit', 'tank'] as const)
    : r.pick(['tee', 'tee', 'blouse', 'hoodie', 'jacket', 'dress', 'dress', 'longsleeve', 'tank', 'suit', 'shirt'] as const);
  const bottomStyle: BottomStyle = topStyle === 'suit' ? 'trousers' : topStyle === 'dress' ? 'skirt'
    : sex === 'f' ? r.pick(['jeans', 'jeans', 'skirt', 'trousers', 'shorts', 'sweats'] as const)
    : r.pick(['jeans', 'jeans', 'jeans', 'trousers', 'shorts', 'sweats'] as const);
  const top = topStyle === 'suit' ? r.pick(['#1c1d21', '#2b2d33', '#2a3346', '#4a4a4f', '#5a4636']) : r.chance(0.45) ? r.pick(NEUTRAL) : r.chance(0.4) ? r.pick(EARTH) : r.pick(COLOUR);
  const bottom = topStyle === 'suit' ? top : bottomStyle === 'jeans' ? r.pick(DENIM) : bottomStyle === 'sweats' ? r.pick(['#2b2d33', '#5b5e63', '#8a8d91', '#1f3a5f']) : bottomStyle === 'skirt' ? r.pick([...NEUTRAL.slice(0, 5), ...COLOUR]) : r.pick(CHINO);
  const shoeStyle: ShoeStyle = topStyle === 'suit' ? 'formal' : r.pick(['sneakers', 'sneakers', 'sneakers', 'boots', 'formal'] as const);
  const shoes = shoeStyle === 'sneakers' ? r.pick(['#f2f0ea', '#e8e6e0', '#1c1d21', '#3d3f45', '#9c2f35', '#2d4f7c']) : shoeStyle === 'boots' ? r.pick(['#3a2a1e', '#5a3d26', '#1c1d21', '#7a5a3a']) : r.pick(['#141416', '#2a1d15', '#3a2a1e']);
  const accent = topStyle === 'suit' ? r.pick(['#f6f4ee', '#dfe7ef', '#f2ece0']) : r.pick([...NEUTRAL, ...COLOUR]);
  const hatStyle: HatStyle = ['afro', 'bun', 'buns', 'long', 'ponytail', 'braids', 'bob'].includes(hairStyle) || topStyle === 'suit' ? 'none' : r.chance(0.16) ? r.pick(['cap', 'cap', 'beanie'] as const) : 'none';
  const pattern: Pattern = ['tee', 'longsleeve', 'shirt', 'blouse', 'dress', 'hoodie'].includes(topStyle) ? r.pick(['plain', 'plain', 'plain', 'stripes', 'plaid', 'graphic', 'twotone'] as const) : 'plain';
  const sleeves = topStyle === 'tank' ? 'tank' : ['tee', 'polo', 'blouse', 'dress'].includes(topStyle) && r.chance(0.8) ? 'short' : 'long';
  return {
    sex, skin, hair, hairStyle, facial, hatStyle, topStyle, bottomStyle, shoeStyle, pattern, accent,
    top, bottom, shoes, hat: r.pick(['#1c1d21', '#2d4f7c', '#9c2f35', '#3b7f6e', '#c9c8c3', '#d07a3a']), detail: r.pick(['#2a1d15', '#1c1d21', '#5a3d26']),
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
