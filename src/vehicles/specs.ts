/** Vehicle definitions: every type drives differently. Names and brands are original. */
export type VehicleKind = 'sedan' | 'taxi' | 'police' | 'hatch' | 'wagon' | 'coupe' | 'van';
export interface VehicleSpec {
  name: string; model: 'car_sedan' | 'car_taxi' | 'car_police' | 'car_hatchback' | 'car_stationwagon' | 'van';
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
  paints: string[]; bodyScale?: [number, number, number]; ride?: number;
}
const susp = { suspRest: 0.32, suspTravel: 0.25, stiffness: 32, compression: 2.6, relaxation: 3.0 };
export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  sedan: { name: 'Solano Sedan', model: 'car_sedan', mass: 1350, engine: 9200, brake: 11, topSpeed: 44, reverseSpeed: 9, maxSteer: 0.6, highSteer: 0.13, grip: 0.74, rearGrip: 0.8, traction: 0.95, peakSlip: 0.13, slide: 0.72, handbrakeGrip: 0.32, driftGrip: 0.78, tc: true, stability: 0.6, ...susp, comY: -0.35, downforce: 2.2, drive: 'rear', health: 1000, price: 0, paints: ['#5d8bb0', '#d9d4c7', '#3d3d42', '#8b2f2f', '#2f5d4f', '#c99a5b', '#6f6f78'] },
  taxi: { name: 'Meridian Cab', model: 'car_taxi', mass: 1400, engine: 9000, brake: 10.5, topSpeed: 42, reverseSpeed: 9, maxSteer: 0.6, highSteer: 0.13, grip: 0.72, rearGrip: 0.78, traction: 0.95, peakSlip: 0.13, slide: 0.72, handbrakeGrip: 0.32, driftGrip: 0.78, tc: true, stability: 0.6, suspRest: 0.34, suspTravel: 0.28, stiffness: 28, compression: 2.4, relaxation: 2.8, comY: -0.3, downforce: 2, drive: 'rear', health: 1000, price: 0, paints: ['#f2c14e'] },
  police: { name: 'MPD Interceptor', model: 'car_police', mass: 1450, engine: 13000, brake: 12.5, topSpeed: 54, reverseSpeed: 10, maxSteer: 0.6, highSteer: 0.12, grip: 0.84, rearGrip: 0.88, traction: 1.05, peakSlip: 0.12, slide: 0.74, handbrakeGrip: 0.3, driftGrip: 0.8, tc: true, stability: 0.55, suspRest: 0.3, suspTravel: 0.22, stiffness: 40, compression: 3.0, relaxation: 3.4, comY: -0.4, downforce: 3, drive: 'rear', health: 1300, price: 0, paints: [''] },
  hatch: { name: 'Pipit Hatch', model: 'car_hatchback', mass: 1050, engine: 6600, brake: 11, topSpeed: 40, reverseSpeed: 9, maxSteer: 0.66, highSteer: 0.15, grip: 0.78, rearGrip: 0.82, traction: 0.95, peakSlip: 0.13, slide: 0.74, handbrakeGrip: 0.3, driftGrip: 0.8, tc: true, stability: 0.5, suspRest: 0.3, suspTravel: 0.24, stiffness: 34, compression: 2.6, relaxation: 3.0, comY: -0.32, downforce: 1.8, drive: 'front', health: 800, price: 0, paints: ['#d94f45', '#f2efe6', '#3f88a6', '#e8a23b', '#7a9e5a', '#b05fa0'] },
  wagon: { name: 'Estero Wagon', model: 'car_stationwagon', mass: 1650, engine: 9600, brake: 10, topSpeed: 40, reverseSpeed: 8, maxSteer: 0.56, highSteer: 0.12, grip: 0.7, rearGrip: 0.76, traction: 0.92, peakSlip: 0.14, slide: 0.72, handbrakeGrip: 0.34, driftGrip: 0.8, tc: true, stability: 0.65, suspRest: 0.36, suspTravel: 0.3, stiffness: 24, compression: 2.2, relaxation: 2.5, comY: -0.25, downforce: 1.8, drive: 'rear', health: 1150, price: 0, paints: ['#3f7f5a', '#8a6a4a', '#5b6e8c', '#c9c3b5', '#2e3b3f'] },
  coupe: { name: 'Pipit GT', model: 'car_hatchback', mass: 1120, engine: 12500, brake: 13, topSpeed: 59, reverseSpeed: 10, maxSteer: 0.62, highSteer: 0.12, grip: 0.9, rearGrip: 0.86, traction: 0.82, peakSlip: 0.11, slide: 0.7, handbrakeGrip: 0.28, driftGrip: 0.74, tc: false, stability: 0.35, suspRest: 0.26, suspTravel: 0.16, stiffness: 46, compression: 3.4, relaxation: 3.8, comY: -0.42, downforce: 4, drive: 'rear', health: 750, price: 0, paints: ['#f26b3a', '#1f2a44', '#e8e2d0', '#2fa39a', '#ffcc4d'], bodyScale: [1.04, 0.9, 1.06] },
  van: { name: 'Dray Box Van', model: 'van', mass: 2600, engine: 12500, brake: 8.5, topSpeed: 33, reverseSpeed: 7, maxSteer: 0.52, highSteer: 0.11, grip: 0.64, rearGrip: 0.72, traction: 0.9, peakSlip: 0.15, slide: 0.75, handbrakeGrip: 0.4, driftGrip: 0.85, tc: true, stability: 0.8, suspRest: 0.4, suspTravel: 0.3, stiffness: 26, compression: 2.4, relaxation: 2.6, comY: -0.1, downforce: 1.5, drive: 'rear', health: 1600, price: 0, paints: ['#e9e4d8', '#3f6f8f', '#c4553a', '#5a7a4a'] },
};
export const TRAFFIC_MIX: { kind: VehicleKind; weight: number }[] = [
  { kind: 'sedan', weight: 5 }, { kind: 'hatch', weight: 4 }, { kind: 'wagon', weight: 3 }, { kind: 'taxi', weight: 2 }, { kind: 'van', weight: 1.4 }, { kind: 'coupe', weight: 0.8 },
];
