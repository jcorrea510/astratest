/** Named places in Port Meridian (all on walkable ground, verified by tests). */
export interface Place { x: number; z: number; y?: number; yaw?: number; name: string }
export const PLACES = {
  safehouse: { x: -300, z: -106.6, yaw: Math.PI, name: 'Lantern Ave apartment' },
  juno: { x: -262, z: -106.6, yaw: Math.PI, name: 'Juno' },
  marlo: { x: -200, z: 306.6, yaw: 0, name: 'Marlo' },
  vesna: { x: -410, z: 412, yaw: 0, name: 'Vesna' },
  arms: { x: -300, z: 10.2, yaw: Math.PI, name: 'Tidewater Arms' },
  garage: { x: -200, z: 102, yaw: Math.PI / 2, name: 'Glow Garage' },
  snack: { x: -46.5, z: 455.5, y: 1.2, yaw: 0, name: 'Pier 9 Snacks' },
  clinic: { x: -60, z: -110, yaw: Math.PI, name: 'Juniper Clinic' },
  precinct: { x: 40, z: 108, yaw: 0, name: 'Meridian PD' },
} satisfies Record<string, Place>;
export type PlaceId = keyof typeof PLACES;

/**
 * Walk-in stores that can be held up. (x,z) = centre of the shop's footprint, yaw = direction the shop front faces
 * (front = (sin yaw, cos yaw)). Each one is a real interior (counter, register, shelves, fridges) entered through
 * a sliding door; cash = a full till. `standalone` shops have no building above (the gas station).
 */
export type StoreKind = 'convenience' | 'liquor' | 'gas' | 'diner' | 'pawn';
export interface Store { x: number; z: number; yaw: number; name: string; color: string; cash: number; kind: StoreKind; standalone?: boolean }
export const STORE_W = 10.4, STORE_D = 9.8, STORE_H = 4.4;
export const STORES: Store[] = [
  { x: -210.5, z: 17.5, yaw: Math.PI, name: 'Lucky Gull 24/7', color: '#d1495b', cash: 320, kind: 'convenience' },
  { x: -122.8, z: -113.9, yaw: 0, name: 'Harbor Liquor', color: '#29335c', cash: 600, kind: 'liquor' },
  { x: -206, z: 128, yaw: -Math.PI / 2, name: 'Fuel Stop', color: '#0f7b4f', cash: 380, kind: 'gas', standalone: true },
  { x: 131.5, z: 286.1, yaw: 0, name: 'Hot Plate Diner', color: '#8c1c22', cash: 450, kind: 'diner' },
  { x: -379, z: -213.9, yaw: 0, name: 'Goldleaf Pawn & Jewelry', color: '#141414', cash: 900, kind: 'pawn' },
];
/** Gas station forecourt (canopy + pumps) next to the Fuel Stop shop. */
export const GAS_STATION = { x: -224, z: 152, w: 14, d: 22, name: 'Fuel Stop gas station' };
/** True when a building lot centred at (x,z) is taken by a store (it then only gets the floors above). */
export function storeAt(x: number, z: number): Store | undefined { return STORES.find(s => Math.hypot(s.x - x, s.z - z) < 1); }

/** Metro Police precinct building (replaces the street lots it covers; rooftop helipad). Front faces north onto 5th St. */
export const POLICE_STATION = { x: 22.8, z: 113.9, w: 31.5, d: 10, yaw: Math.PI, name: 'Metro Police Precinct 4' };

/** Helicopter landing pads (y = deck height). Filled in for rooftop pads by the city build; ground pads are fixed. */
export interface HelipadSpot { x: number; y: number; z: number; name: string }
export const HELIPADS: HelipadSpot[] = [];

/** Hidden postcards (collectibles): sidewalks, park, pier, beach, docks. */
export const POSTCARDS: Place[] = [
  { x: -446, z: -300, name: 'Ridge corner' }, { x: 100, z: -350, name: 'Juniper Park' }, { x: -50, z: 545, y: 1.2, name: 'Pier end' },
  { x: 300, z: 432, name: 'East beach' }, { x: 470, z: 330, name: 'Quay crane' }, { x: 380, z: -150, name: 'Hillside lookout' },
  { x: 95, z: -150, name: 'Heights plaza' }, { x: -200, z: 150, name: 'Midtown plaza' }, { x: -400, z: 430, name: 'West beach' },
  { x: 245, z: 5, name: 'Sunset Blvd' }, { x: -350, z: -394, name: 'North Crest' }, { x: 470, z: -20, name: 'Harbor gate' },
];
/** Stunt ramps: position, heading (yaw of travel), length/height, and what a jump must reach to pay. */
export const RAMPS = [
  { x: 470, z: 210, yaw: Math.PI, len: 9, h: 2.2, w: 4.2, name: 'Quay launch', minDist: 18, minAir: 0.8 },
  // the promenade ramps face east along the beach: veer off eastbound Coastal Drive at speed, land on the sand with room to stop before the sea
  { x: -300, z: 411.5, yaw: 1.2, len: 6.5, h: 1.8, w: 6, name: 'Promenade hop', minDist: 11, minAir: 0.55 },
  { x: 200, z: 411.5, yaw: 1.2, len: 6.5, h: 1.8, w: 6, name: 'Strand flyer', minDist: 11, minAir: 0.55 },
];
