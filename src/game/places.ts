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

/** Street kiosks that can be held up (yaw = direction the counter faces; cash = a full till). */
export interface Store { x: number; z: number; yaw: number; name: string; color: string; cash: number }
export const STORES: Store[] = [
  { x: -232, z: 130, yaw: -Math.PI / 2, name: 'Lucky Gull 24/7', color: '#d1495b', cash: 320 },
  { x: 67, z: -118, yaw: -Math.PI / 2, name: 'Sundial Deli', color: '#2f8f8a', cash: 600 },
  { x: 100, z: -318, yaw: 0, name: 'Juniper Snack Hut', color: '#6a994e', cash: 220 },
  { x: -120, z: 414, yaw: Math.PI, name: 'Promenade Pops', color: '#ef8354', cash: 260 },
  { x: 486, z: 60, yaw: -Math.PI / 2, name: 'Dockside Bait & Tackle', color: '#3d5a80', cash: 420 },
];

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
