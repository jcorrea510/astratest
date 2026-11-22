import * as THREE from 'three';
/**
 * Traffic-signal lamp colours. With bloom the lamps are HDR (they glow); without it (Low) channels above 1 clip, so
 * HDR green (1, 14, 5.5) turned white: Round 7 uses saturated in-range colours there. Pure: used by tests.
 */
export function signalLampColors(bloom: boolean): { red: THREE.Color; yellow: THREE.Color; green: THREE.Color } {
  return bloom
    ? { red: new THREE.Color(14, 0.6, 0.5), yellow: new THREE.Color(14, 8, 0.6), green: new THREE.Color(1, 14, 5.5) }
    : { red: new THREE.Color(1, 0.06, 0.04), yellow: new THREE.Color(1, 0.62, 0.04), green: new THREE.Color(0.08, 1, 0.42) };
}
