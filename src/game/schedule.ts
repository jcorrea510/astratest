/** Time-of-day schedules shared by the near and far crowds (hour = 0..24). Pure functions, unit-tested. */
import type { District } from '../world/citymap';

const lerpTable = (t: [number, number][], h: number) => {
  h = ((h % 24) + 24) % 24;
  for (let i = 1; i < t.length; i++) if (h <= t[i][0]) { const [h0, v0] = t[i - 1], [h1, v1] = t[i]; return v0 + (v1 - v0) * (h - h0) / (h1 - h0 || 1); }
  return t[t.length - 1][1];
};
/** Pedestrian multiplier (peak = 1 so the quality preset stays the upper bound): dead at 3 AM, commuter rushes at 8 and 17-19, lively evenings. */
export function pedActivity(hour: number): number {
  return lerpTable([[0, 0.45], [3, 0.2], [5, 0.3], [7, 0.8], [8.5, 1.25], [11, 1], [13, 1.15], [16, 1], [18, 1.3], [20, 1.05], [22, 0.75], [24, 0.45]], hour) / 1.3;
}
/** Traffic multiplier (peak = 1): rush hours at 7-9 and 16-19, thin overnight. */
export function carActivity(hour: number): number {
  return lerpTable([[0, 0.5], [3, 0.3], [5, 0.4], [7, 1], [8.5, 1.3], [11, 1], [15, 1.05], [17.5, 1.35], [20, 1], [23, 0.7], [24, 0.5]], hour) / 1.35;
}
export const isNight = (hour: number) => hour >= 19.5 || hour < 5.5;
const NIGHTLIFE: District[] = ['strand', 'oldtown', 'midtown', 'brickline', 'heights'];
/** Pedestrian spawn weight for a district at an hour: bars and clubs keep their streets busy at night, offices empty out. */
export function districtNightFactor(d: District, hour: number): number {
  const late = hour >= 21 || hour < 4;
  if (!late) return 1;
  return NIGHTLIFE.includes(d) ? 1.5 : d === 'financial' || d === 'cannery' ? 0.2 : 0.45;
}
