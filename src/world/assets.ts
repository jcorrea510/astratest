/** Loads all runtime assets with progress reporting. Paths are relative to the deployed base URL. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const KAYKIT_MODELS = [
  'building_A_withoutBase', 'building_B_withoutBase', 'building_C_withoutBase', 'building_D_withoutBase',
  'building_E_withoutBase', 'building_F_withoutBase', 'building_G_withoutBase', 'building_H_withoutBase',
  'car_sedan', 'car_taxi', 'car_police', 'car_hatchback', 'car_stationwagon',
  'streetlight', 'trafficlight_A', 'firehydrant', 'bench', 'trash_A', 'dumpster', 'bush', 'watertower',
] as const;
export type KayKitName = (typeof KAYKIT_MODELS)[number];

export interface Assets {
  kaykit: Record<KayKitName, GLTF>;
  human: GLTF;
  atlas: THREE.Texture;
  audio: Record<string, ArrayBuffer>;
}
export const AUDIO_FILES = { engine: 'assets/vehicles/audio/engine.ogg', engineBike: 'assets/vehicles/audio/engine-motorcycle.ogg', impact: 'assets/vehicles/audio/impact.ogg', skid: 'assets/vehicles/audio/skid.ogg' };

export function assetUrl(path: string) { return import.meta.env.BASE_URL + path; }

export async function loadAssets(onProgress: (fraction: number, label: string) => void): Promise<Assets> {
  const loader = new GLTFLoader();
  const jobs: { weight: number; done: number }[] = [];
  const report = (label: string) => {
    const total = jobs.reduce((a, j) => a + j.weight, 0), done = jobs.reduce((a, j) => a + j.done * j.weight, 0);
    onProgress(total ? done / total : 0, label);
  };
  const track = <T>(weight: number, label: string, p: (onP: (f: number) => void) => Promise<T>): Promise<T> => {
    const job = { weight, done: 0 }; jobs.push(job);
    return p(f => { job.done = f; report(label); }).then(r => { job.done = 1; report(label); return r; });
  };
  const gltf = (path: string, weight: number, label: string) => track(weight, label, onP => loader.loadAsync(assetUrl(path), e => { if (e.total) onP(e.loaded / e.total); }));

  const kaykitEntries = KAYKIT_MODELS.map(n => gltf(`assets/kaykit/${n}.gltf`, 1, 'Raising the skyline').then(g => [n, g] as const));
  const human = gltf('assets/ual/AnimationLibrary_Godot_Standard.gltf', 12, 'Waking up the locals');
  const audio = Object.entries(AUDIO_FILES).map(([k, p]) => track(1.5, 'Tuning engines', async () => {
    const r = await fetch(assetUrl(p)); if (!r.ok) throw new Error(`Failed to load ${p}`); return [k, await r.arrayBuffer()] as const;
  }));
  const [kk, h, au] = await Promise.all([Promise.all(kaykitEntries), human, Promise.all(audio)]);
  const kaykit = Object.fromEntries(kk) as Record<KayKitName, GLTF>;
  let atlas: THREE.Texture | null = null;
  kaykit.building_A_withoutBase.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.map && !atlas) atlas = m.map; });
  if (!atlas) throw new Error('City atlas texture missing');
  onProgress(1, 'Ready');
  return { kaykit, human: h, atlas, audio: Object.fromEntries(au) };
}
