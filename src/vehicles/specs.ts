/** Vehicle definitions: every model drives differently. Makes and models are original (fictional 2000s cars). */
export type VehicleKind =
  | 'hatch' | 'sedan' | 'fullsize' | 'luxury' | 'wagon' | 'coupe' | 'muscle' | 'super' | 'convertible'
  | 'pickup' | 'suv' | 'minivan' | 'van' | 'race' | 'taxi' | 'police' | 'fbi' | 'swat' | 'army' | 'tank';
export type VehicleClass = 'compact' | 'sedan' | 'luxury' | 'sports' | 'muscle' | 'super' | 'utility' | 'service' | 'emergency' | 'military';
export interface VehicleSpec {
  name: string; cls: VehicleClass;
  /** kg */ mass: number;
  /** peak drive force (N) */ engine: number;
  /** full-brake deceleration (m/s²) */ brake: number;
  /** m/s */ topSpeed: number; reverseSpeed: number;
  /** road-wheel lock at parking speed and at highway speed (rad) */ maxSteer: number; highSteer: number;
  /** lateral friction coefficients front / rear (world gravity is 20 m/s²) */ grip: number; rearGrip: number;
  /** longitudinal friction coefficient for drive and brakes */ traction: number;
  /** slip angle of peak grip (rad) and the share of grip left when sliding */ peakSlip: number; slide: number;
  /** rear lateral grip multiplier with the handbrake pulled, and while a drift is held */ handbrakeGrip: number; driftGrip: number;
  /** traction control (no power wheelspin) and yaw stability assist strength 0..1 */ tc: boolean; stability: number;
  suspRest: number; suspTravel: number; stiffness: number; compression: number; relaxation: number;
  comY: number; downforce: number; drive: 'rear' | 'front' | 'all'; health: number; price: number;
  paints: string[];
  /** engine sound family */ sound?: 'car' | 'truck';
}
type Tune = Omit<VehicleSpec, 'name' | 'cls' | 'paints' | 'price'>;
const car: Tune = { mass: 1350, engine: 9200, brake: 11, topSpeed: 44, reverseSpeed: 9, maxSteer: 0.66, highSteer: 0.16, grip: 0.8, rearGrip: 0.8, traction: 0.95, peakSlip: 0.13, slide: 0.72, handbrakeGrip: 0.32, driftGrip: 0.78, tc: true, stability: 0.55, suspRest: 0.32, suspTravel: 0.25, stiffness: 32, compression: 2.6, relaxation: 3.0, comY: -0.35, downforce: 2.2, drive: 'rear', health: 1000 };
const t = (o: Partial<Tune>): Tune => ({ ...car, ...o });
const bigT = t({ mass: 1750, engine: 11800, brake: 10.5, topSpeed: 47, grip: 0.78, rearGrip: 0.78, stiffness: 28, compression: 2.4, relaxation: 2.8, comY: -0.3, health: 1250 });
const truckT = t({ mass: 2300, engine: 15500, brake: 9.5, topSpeed: 42, reverseSpeed: 8, maxSteer: 0.62, highSteer: 0.15, grip: 0.74, rearGrip: 0.74, traction: 0.92, peakSlip: 0.15, slide: 0.75, handbrakeGrip: 0.38, driftGrip: 0.84, stability: 0.75, suspRest: 0.38, suspTravel: 0.3, stiffness: 26, compression: 2.4, relaxation: 2.6, comY: -0.25, downforce: 1.5, health: 1600, sound: 'truck' });
const spec = (name: string, cls: VehicleClass, tune: Tune, paints: string[]): VehicleSpec => ({ name, cls, ...tune, price: 0, paints });
const CIVIL = ['#c8ccd0', '#1d1f22', '#f1f0ec', '#7a1f24', '#26385a', '#5c6670', '#2f4a3a', '#8a8f94', '#b8a98c', '#4a1e2c', '#9c9fa3', '#2b2e33'];

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  hatch: spec('Pipit Hopper', 'compact', t({ mass: 1020, engine: 6300, brake: 11, topSpeed: 39, maxSteer: 0.7, highSteer: 0.18, grip: 0.84, rearGrip: 0.84, stability: 0.5, suspRest: 0.3, suspTravel: 0.24, stiffness: 34, comY: -0.32, downforce: 1.8, drive: 'front', health: 800 }),
    ['#c43a31', '#f1efe9', '#2f6f9a', '#e0a33b', '#6f8f4e', '#9a9da1', '#1f2226', '#7c4a8a']),
  sedan: spec('Solano Vista', 'sedan', t({ drive: 'front' }), CIVIL),
  fullsize: spec('Brandt Corvalis', 'sedan', bigT, ['#1c1d20', '#e9e7e1', '#4a1b20', '#2c3a52', '#7f8489', '#3b4537', '#a39c8c', '#5c2a1c']),
  luxury: spec('Regent Duvall', 'luxury', t({ ...bigT, mass: 1950, engine: 13500, topSpeed: 50, grip: 0.76, rearGrip: 0.78, stiffness: 22, compression: 2.0, relaxation: 2.3, stability: 0.7, health: 1300 }),
    ['#101114', '#efece4', '#5e1620', '#20304d', '#b9b4a8', '#3d3f43', '#4d5a4b']),
  wagon: spec('Solano Estero', 'sedan', t({ mass: 1600, engine: 9400, brake: 10, topSpeed: 41, grip: 0.77, rearGrip: 0.78, stability: 0.65, suspRest: 0.34, suspTravel: 0.28, stiffness: 26, compression: 2.3, relaxation: 2.6, comY: -0.28, downforce: 1.8, health: 1150 }),
    ['#3f6a52', '#8b6b4a', '#5b6e8c', '#c9c3b5', '#2e3b3f', '#6e2a2a', '#a8abaf']),
  coupe: spec('Vantor 360 GT', 'sports', t({ mass: 1280, engine: 13800, brake: 13, topSpeed: 62, maxSteer: 0.66, highSteer: 0.15, grip: 0.95, rearGrip: 0.9, traction: 0.85, peakSlip: 0.11, slide: 0.7, handbrakeGrip: 0.28, driftGrip: 0.74, tc: false, stability: 0.35, suspRest: 0.27, suspTravel: 0.17, stiffness: 46, compression: 3.4, relaxation: 3.8, comY: -0.42, downforce: 4, health: 850 }),
    ['#c21f1f', '#e8e6e1', '#1d2a44', '#f0b429', '#1b1c1f', '#7d8288', '#2e7d6f']),
  muscle: spec('Ardent Vortex 440', 'muscle', t({ mass: 1650, engine: 15500, brake: 11.5, topSpeed: 60, maxSteer: 0.64, highSteer: 0.15, grip: 0.86, rearGrip: 0.82, traction: 0.78, peakSlip: 0.12, slide: 0.7, handbrakeGrip: 0.27, driftGrip: 0.74, tc: false, stability: 0.3, suspRest: 0.3, suspTravel: 0.2, stiffness: 36, compression: 2.8, relaxation: 3.2, comY: -0.38, downforce: 2.5, health: 1150 }),
    ['#d0661d', '#1a1b1e', '#b8152a', '#f2c230', '#2a4f8a', '#e9e6df', '#3c6e3a']),
  super: spec('Vantor Zephyra', 'super', t({ mass: 1450, engine: 19500, brake: 14, topSpeed: 75, maxSteer: 0.62, highSteer: 0.14, grip: 1.04, rearGrip: 1.0, traction: 0.95, peakSlip: 0.1, slide: 0.72, handbrakeGrip: 0.3, driftGrip: 0.76, tc: true, stability: 0.4, suspRest: 0.24, suspTravel: 0.14, stiffness: 52, compression: 3.6, relaxation: 4.0, comY: -0.45, downforce: 5.5, drive: 'all', health: 800 }),
    ['#f2c40f', '#d1291c', '#ff7a00', '#e8e8e8', '#151517', '#3fa34d', '#2e5bd8']),
  convertible: spec('Solano Seaspray', 'sports', t({ mass: 1450, engine: 11000, topSpeed: 52, grip: 0.86, rearGrip: 0.86, stability: 0.5, comY: -0.38, health: 950 }),
    ['#e9e6df', '#b5121b', '#244a7a', '#151619', '#c9b38a', '#4f8a9b']),
  pickup: spec('Brandt Ranchhand', 'utility', t({ ...truckT, mass: 2150, engine: 14500, topSpeed: 44, health: 1500 }),
    ['#9a1e1e', '#1d2b45', '#e8e6e0', '#2d2f33', '#6b6f73', '#4a5a3e', '#8d6e47']),
  suv: spec('Brandt Outrider', 'utility', t({ ...truckT, mass: 2250, engine: 15000, topSpeed: 46, drive: 'all', health: 1500 }),
    ['#1b1c1f', '#e8e6e0', '#3b4a5c', '#5e6a3f', '#7e1e22', '#9b9ea2', '#6b5440']),
  minivan: spec('Solano Homestead', 'utility', t({ mass: 1900, engine: 10200, brake: 10, topSpeed: 40, grip: 0.77, rearGrip: 0.8, stability: 0.75, suspRest: 0.34, suspTravel: 0.28, stiffness: 25, compression: 2.3, relaxation: 2.5, comY: -0.25, drive: 'front', health: 1250 }),
    ['#a7abb0', '#3b4f6b', '#6d1f23', '#e7e5df', '#4b5e4a', '#c2b59b']),
  van: spec('Dray Box Van', 'service', t({ ...truckT, mass: 2900, engine: 14500, brake: 8.5, topSpeed: 34, reverseSpeed: 7, maxSteer: 0.6, health: 1800 }),
    ['#f1efe9', '#e9e5d8', '#3f6f8f', '#c4553a', '#5a7a4a']),
  race: spec('Vantor Apex R', 'sports', t({ mass: 1180, engine: 17500, brake: 15, topSpeed: 70, maxSteer: 0.64, highSteer: 0.15, grip: 1.1, rearGrip: 1.05, traction: 1.0, peakSlip: 0.1, slide: 0.74, handbrakeGrip: 0.28, driftGrip: 0.76, tc: false, stability: 0.4, suspRest: 0.22, suspTravel: 0.12, stiffness: 58, compression: 3.8, relaxation: 4.2, comY: -0.45, downforce: 7, health: 900 }),
    ['#0f5fd8', '#e33b1f', '#f4f2ee', '#1a1a1c', '#18a058']),
  taxi: spec('Corvalis Cab', 'service', { ...bigT, topSpeed: 44, engine: 11000 }, ['#f2b90f']),
  police: spec('Corvalis Interceptor', 'emergency', t({ ...bigT, mass: 1800, engine: 15500, brake: 12.5, topSpeed: 58, grip: 0.88, rearGrip: 0.88, traction: 1.05, peakSlip: 0.12, slide: 0.74, handbrakeGrip: 0.3, driftGrip: 0.8, stability: 0.55, stiffness: 38, compression: 3.0, relaxation: 3.4, comY: -0.4, downforce: 3, health: 1400 }), ['#111214']),
  fbi: spec('Outrider Federal', 'emergency', t({ ...truckT, mass: 2300, engine: 17500, brake: 11, topSpeed: 53, grip: 0.84, rearGrip: 0.84, drive: 'all', health: 1900 }), ['#0c0d0f']),
  swat: spec('Dray Bastion', 'emergency', t({ ...truckT, mass: 4200, engine: 23000, brake: 9, topSpeed: 40, reverseSpeed: 7, maxSteer: 0.58, grip: 0.78, rearGrip: 0.78, stability: 0.85, suspRest: 0.42, stiffness: 30, comY: -0.35, drive: 'all', health: 3800 }), ['#1d2430']),
  army: spec('Gorman Mule 6x6', 'military', t({ ...truckT, mass: 6200, engine: 30000, brake: 8, topSpeed: 30, reverseSpeed: 6, maxSteer: 0.56, highSteer: 0.14, grip: 0.8, rearGrip: 0.8, stability: 0.9, suspRest: 0.45, suspTravel: 0.32, stiffness: 30, comY: -0.4, drive: 'all', health: 4200 }), ['#6a7050']),
  tank: spec('Gorman Bulwark', 'military', t({ ...truckT, mass: 14000, engine: 70000, brake: 9, topSpeed: 17, reverseSpeed: 6, maxSteer: 0.8, highSteer: 0.4, grip: 0.95, rearGrip: 0.95, traction: 1.0, peakSlip: 0.2, slide: 0.85, handbrakeGrip: 0.6, driftGrip: 0.9, tc: true, stability: 1, suspRest: 0.4, suspTravel: 0.2, stiffness: 40, compression: 3.5, relaxation: 3.5, comY: -0.6, downforce: 0, drive: 'all', health: 9000 }), ['#6d7352']),
};
/** Civilian traffic: realistic share of everyday cars, a few trucks, rare exotics. */
export const TRAFFIC_MIX: { kind: VehicleKind; weight: number }[] = [
  { kind: 'sedan', weight: 6 }, { kind: 'hatch', weight: 4.5 }, { kind: 'fullsize', weight: 3 }, { kind: 'suv', weight: 3 }, { kind: 'minivan', weight: 2.2 },
  { kind: 'pickup', weight: 2.5 }, { kind: 'wagon', weight: 1.8 }, { kind: 'taxi', weight: 2 }, { kind: 'van', weight: 1.2 }, { kind: 'luxury', weight: 1.2 },
  { kind: 'coupe', weight: 1 }, { kind: 'convertible', weight: 0.8 }, { kind: 'muscle', weight: 0.8 }, { kind: 'super', weight: 0.25 },
];
/** Parked cars along the curbs. */
export const PARKED_MIX: VehicleKind[] = ['sedan', 'sedan', 'hatch', 'hatch', 'fullsize', 'suv', 'wagon', 'pickup', 'minivan', 'coupe', 'muscle', 'luxury', 'convertible', 'van'];
