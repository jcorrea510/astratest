/** Surface kinds baked per vertex (attribute aKind) and read by the car shader. */
export const K = {
  PAINT: 0, CHROME: 1, TRIM: 2, RUBBER: 3, RIM: 4, INTERIOR: 5, HEAD: 6, TAIL: 7, IND: 8, REV: 9,
  GRILLE: 10, PLATE: 11, SEAM: 12, BAR_RED: 13, BAR_BLUE: 14, UNDER: 15, PLASTIC: 16, DECAL: 17, MIRROR: 18,
  TRACK: 19, CANVAS: 20, METAL: 21, PAINT2: 22, LIGHT: 23,
} as const;
/** Bones: 0 body (sprung), 1.. wheels, then doors, then turret / gun. */
export const BONE_BODY = 0;
