import * as THREE from 'three';
/**
 * Traffic-signal lamp colours. The lamps are unlit (toneMapped false) but the final pass still tone maps everything, and
 * the old HDR values (red 14, 0.6, 0.5) came out of the film curve as a pale pink/white blob in daylight (owner, Round 13:
 * "traffic lights look bad in the daytime"). A real LED signal reads as a deep, saturated colour by day and glows at night,
 * so the lit colour now scales with the darkness: moderate and saturated by day, brighter at night where bloom adds the halo.
 * Without bloom (Low) channels above 1 clip, so they stay in range there. Unlit lenses are tinted glass, not grey.
 * Pure: used by tests.
 */
export function signalLampColors(bloom: boolean, night = 1): { red: THREE.Color; yellow: THREE.Color; green: THREE.Color } {
  if (!bloom) return { red: new THREE.Color(1, 0.06, 0.04), yellow: new THREE.Color(1, 0.62, 0.04), green: new THREE.Color(0.08, 1, 0.42) };
  const k = THREE.MathUtils.lerp(1, 2.2, THREE.MathUtils.clamp(night, 0, 1));
  return { red: new THREE.Color(2.6 * k, 0.1 * k, 0.05 * k), yellow: new THREE.Color(2.5 * k, 1.05 * k, 0.05 * k), green: new THREE.Color(0.05 * k, 2.2 * k, 1.0 * k) };
}
/** Unlit lens glass (red, amber, green from top to bottom): dark and tinted, a touch brighter by day (sky reflection). */
export function signalOffColors(night = 0): [THREE.Color, THREE.Color, THREE.Color] {
  const k = THREE.MathUtils.lerp(1, 0.45, THREE.MathUtils.clamp(night, 0, 1));
  return [new THREE.Color(0.11 * k, 0.025 * k, 0.025 * k), new THREE.Color(0.1 * k, 0.065 * k, 0.02 * k), new THREE.Color(0.025 * k, 0.085 * k, 0.07 * k)];
}
