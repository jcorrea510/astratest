/**
 * Shared gun materials (one set for every weapon model; NPCs holding guns share them). Per-gun files only pick a
 * material name; they never make their own materials.
 */
import * as THREE from 'three';

export type Mat = 'steel' | 'polymer' | 'wood' | 'tan' | 'chrome' | 'lens' | 'bore' | 'olive' | 'glass' | 'cloth' | 'brass';
let MATS: Record<Mat, THREE.Material> | null = null;
export function mats(): Record<Mat, THREE.Material> {
  if (MATS) return MATS;
  const std = (color: string, metalness: number, roughness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  MATS = {
    steel: std('#2b2e33', 0.85, 0.34), polymer: std('#1c1d20', 0.05, 0.62), wood: std('#6e4628', 0.05, 0.55), tan: std('#9b8664', 0.05, 0.7),
    chrome: std('#b8bcc2', 0.95, 0.2), lens: std('#1b3550', 0.4, 0.05, { emissive: new THREE.Color('#0c2236'), emissiveIntensity: 0.6 }), bore: std('#050505', 0, 1),
    olive: std('#4d5638', 0.1, 0.65), glass: std('#5f8a6a', 0.1, 0.08, { transparent: true, opacity: 0.75 }), cloth: std('#c9b48a', 0, 0.95), brass: std('#b8893a', 0.9, 0.3),
  };
  for (const m of Object.values(MATS)) m.userData.shared = true;
  return MATS;
}

