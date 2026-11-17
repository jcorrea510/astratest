/** Vehicle definitions: every type drives differently. Names and brands are original. */
export type VehicleKind = 'sedan' | 'taxi' | 'police' | 'hatch' | 'wagon' | 'coupe' | 'van';
export interface VehicleSpec {
  name: string; model: 'car_sedan' | 'car_taxi' | 'car_police' | 'car_hatchback' | 'car_stationwagon' | 'van';
  mass: number; engine: number; brake: number; topSpeed: number; reverseSpeed: number;
  maxSteer: number; steerSpeedFalloff: number; grip: number; rearGrip: number; handbrakeGrip: number; sideStiffness: number;
  suspRest: number; suspTravel: number; stiffness: number; compression: number; relaxation: number;
  comY: number; downforce: number; drive: 'rear' | 'front' | 'all'; health: number; price: number;
  paints: string[]; bodyScale?: [number, number, number]; ride?: number;
}
export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  sedan: { name: 'Solano Sedan', model: 'car_sedan', mass: 1350, engine: 7600, brake: 90, topSpeed: 40, reverseSpeed: 9, maxSteer: 0.55, steerSpeedFalloff: 0.62, grip: 2.4, rearGrip: 2.3, handbrakeGrip: 0.85, sideStiffness: 1.0, suspRest: 0.32, suspTravel: 0.25, stiffness: 32, compression: 2.6, relaxation: 3.0, comY: -0.35, downforce: 2.2, drive: 'rear', health: 1000, price: 0, paints: ['#5d8bb0', '#d9d4c7', '#3d3d42', '#8b2f2f', '#2f5d4f', '#c99a5b', '#6f6f78'] },
  taxi: { name: 'Meridian Cab', model: 'car_taxi', mass: 1400, engine: 7400, brake: 88, topSpeed: 38, reverseSpeed: 9, maxSteer: 0.55, steerSpeedFalloff: 0.62, grip: 2.3, rearGrip: 2.2, handbrakeGrip: 0.85, sideStiffness: 1.0, suspRest: 0.34, suspTravel: 0.28, stiffness: 28, compression: 2.4, relaxation: 2.8, comY: -0.3, downforce: 2, drive: 'rear', health: 1000, price: 0, paints: ['#f2c14e'] },
  police: { name: 'MPD Interceptor', model: 'car_police', mass: 1450, engine: 10400, brake: 110, topSpeed: 50, reverseSpeed: 10, maxSteer: 0.55, steerSpeedFalloff: 0.58, grip: 2.8, rearGrip: 2.7, handbrakeGrip: 0.95, sideStiffness: 1.1, suspRest: 0.3, suspTravel: 0.22, stiffness: 40, compression: 3.0, relaxation: 3.4, comY: -0.4, downforce: 3, drive: 'rear', health: 1300, price: 0, paints: [''] },
  hatch: { name: 'Pipit Hatch', model: 'car_hatchback', mass: 1050, engine: 6000, brake: 80, topSpeed: 35, reverseSpeed: 9, maxSteer: 0.62, steerSpeedFalloff: 0.55, grip: 2.5, rearGrip: 2.5, handbrakeGrip: 0.8, sideStiffness: 1.05, suspRest: 0.3, suspTravel: 0.24, stiffness: 34, compression: 2.6, relaxation: 3.0, comY: -0.32, downforce: 1.8, drive: 'front', health: 800, price: 0, paints: ['#d94f45', '#f2efe6', '#3f88a6', '#e8a23b', '#7a9e5a', '#b05fa0'] },
  wagon: { name: 'Estero Wagon', model: 'car_stationwagon', mass: 1650, engine: 7600, brake: 92, topSpeed: 36, reverseSpeed: 8, maxSteer: 0.5, steerSpeedFalloff: 0.66, grip: 2.2, rearGrip: 2.0, handbrakeGrip: 0.8, sideStiffness: 0.95, suspRest: 0.36, suspTravel: 0.3, stiffness: 24, compression: 2.2, relaxation: 2.5, comY: -0.25, downforce: 1.8, drive: 'rear', health: 1150, price: 0, paints: ['#3f7f5a', '#8a6a4a', '#5b6e8c', '#c9c3b5', '#2e3b3f'] },
  coupe: { name: 'Pipit GT', model: 'car_hatchback', mass: 1120, engine: 10800, brake: 115, topSpeed: 56, reverseSpeed: 10, maxSteer: 0.6, steerSpeedFalloff: 0.55, grip: 3.0, rearGrip: 2.5, handbrakeGrip: 0.75, sideStiffness: 1.15, suspRest: 0.26, suspTravel: 0.16, stiffness: 46, compression: 3.4, relaxation: 3.8, comY: -0.42, downforce: 4, drive: 'rear', health: 750, price: 0, paints: ['#f26b3a', '#1f2a44', '#e8e2d0', '#2fa39a', '#ffcc4d'], bodyScale: [1.04, 0.9, 1.06] },
  van: { name: 'Dray Box Van', model: 'van', mass: 2600, engine: 9800, brake: 120, topSpeed: 30, reverseSpeed: 7, maxSteer: 0.48, steerSpeedFalloff: 0.7, grip: 2.2, rearGrip: 2.0, handbrakeGrip: 0.9, sideStiffness: 0.9, suspRest: 0.4, suspTravel: 0.3, stiffness: 26, compression: 2.4, relaxation: 2.6, comY: -0.1, downforce: 1.5, drive: 'rear', health: 1600, price: 0, paints: ['#e9e4d8', '#3f6f8f', '#c4553a', '#5a7a4a'] },
};
export const TRAFFIC_MIX: { kind: VehicleKind; weight: number }[] = [
  { kind: 'sedan', weight: 5 }, { kind: 'hatch', weight: 4 }, { kind: 'wagon', weight: 3 }, { kind: 'taxi', weight: 2 }, { kind: 'van', weight: 1.4 }, { kind: 'coupe', weight: 0.8 },
];
