/**
 * Title-screen flyover: scripted camera shots over the live city (the running game renders behind the menu).
 * Each shot is a slow dolly from `from` to `to` at a fixed hour; the UI dips to black between shots.
 */
type V3 = [number, number, number];
export interface AttractShot {
  /** caption shown bottom-right while the shot runs */
  name: string; caption: string;
  hour: number; duration: number; fov: number;
  /** ground point the (hidden) player stands on so traffic and people spawn into the shot */
  focus: [number, number];
  from: { pos: V3; look: V3 }; to: { pos: V3; look: V3 };
}

export const ATTRACT_SHOTS: AttractShot[] = [
  { name: 'Hillside', caption: 'Lookout  ·  17:55', hour: 17.9, duration: 11, fov: 46, focus: [350, -200],
    from: { pos: [430, 72, -270], look: [0, 10, 150] }, to: { pos: [330, 80, -240], look: [-100, 10, 150] } },
  { name: 'Meridian Blvd', caption: 'Midtown  ·  19:24', hour: 19.4, duration: 10, fov: 52, focus: [-42, 100],
    from: { pos: [-50, 16, 160], look: [-50, 8, 40] }, to: { pos: [-50, 9, 90], look: [-50, 5, -30] } },
  { name: 'East River Bridge', caption: 'Eastbank Crossing  ·  18:42', hour: 18.7, duration: 11, fov: 50, focus: [540, 100],
    from: { pos: [598, 16, 235], look: [625, 14, 100] }, to: { pos: [650, 22, 220], look: [620, 13, 100] } },
  { name: 'Meridian Heights', caption: 'Skyline  ·  20:12', hour: 20.2, duration: 10, fov: 50, focus: [150, -150],
    from: { pos: [390, 150, 70], look: [100, 40, -150] }, to: { pos: [340, 130, -270], look: [100, 40, -140] } },
  { name: 'Saltwater Strand', caption: 'Pier 9  ·  19:06', hour: 19.1, duration: 11, fov: 46, focus: [-60, 940],
    from: { pos: [-125, 11, 948], look: [-50, 4, 1040] }, to: { pos: [-95, 10, 952], look: [-40, 6, 1040] } },
  { name: 'Juniper Park', caption: 'Park Loop  ·  19:40', hour: 19.65, duration: 10, fov: 50, focus: [100, -340],
    from: { pos: [60, 15, -392], look: [115, 38, -190] }, to: { pos: [95, 18, -372], look: [120, 42, -180] } },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Camera for shot `s` at `t` seconds: a gentle ease in and out, never fully stopping. */
export function shotCamera(s: AttractShot, t: number): { pos: V3; look: V3; fov: number } {
  const u = Math.max(0, Math.min(1, t / s.duration));
  const e = 0.15 * u + 0.85 * (u * u * (3 - 2 * u));
  return { pos: lerp3(s.from.pos, s.to.pos, e), look: lerp3(s.from.look, s.to.look, e), fov: s.fov };
}
