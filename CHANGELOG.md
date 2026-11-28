# Changelog

## 2026-11-28: Crash and impact system
- Refined crash physics with damage by impact angle, wall scraping with sparks, camera kick on severe crashes, shattering
  windscreens and stuck horns.
- Fixes: a light nudge no longer counts as a crash (cars stopped with hazards on after small bumps), and cars no longer
  lose most of their power next to walls and buildings they are not touching.

## 2026-11-27: Firefights, landmarks and the full-screen map

- Foot movement, shooting and large firefights overhauled: tighter sprinting and turning, a tactical combat roll with evasion
  (crouch while moving), shoulder camera swapping while aiming (T, or B while aiming), subtle ADS aim assist, color-coded tracers, near-miss
  suppression effects, chain-reacting fuel drums and gas pumps, and coordinated police squad roles (flankers, suppressors,
  breachers) with anti-camping grenades.
- New landmarks: Meridian Harbor Lighthouse, Juniper Grand Fountain, the illuminated Pier 9 gateway arch and overhead
  highway gantries. 10 upgraded stunt ramps across the map.
- Interactive full-screen map: clickable category filters, POI hover snapping and tooltips, quick Center / Zoom / Clear GPS
  controls and richer coastal cartography.
- Smoother heavy firefights and chases: no per-frame allocations in particles, ballistics, police/NPC loops, helicopter
  ray scans and minimap drawing.
- Fixes: car wheels no longer log a console warning on every build (it failed the automated browser checks on every
  recent commit). Bike racks and benches no longer block shop doors. The stunt ramps draw as a handful of
  meshes, guns carried by people far away no longer draw, and distant people and cars skip small details, so busy
  corners stay inside the draw-call budget. People walking past you while you stand still now step aside instead of turning back, and a car waiting to turn left no longer pulls out on a red.
