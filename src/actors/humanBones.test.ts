import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { R, regionOfBone, ubcBoneName } from './humanAssets';

// Round 14 regression (owner: "men have dark/blue nails"): the fingertip leaf bones were not renamed, so their vertices
// fell into the torso region and were painted with the shirt or trouser colour.
describe('UBC body bones', () => {
  for (const sex of ['Male', 'Female']) {
    it(`${sex}: every skinned joint maps to a rig bone, fingertips are arm/hand skin`, () => {
      const j = JSON.parse(readFileSync(`public/assets/ubc/Superhero_${sex}_FullBody.gltf`, 'utf8'));
      const names: string[] = j.skins[0].joints.map((i: number) => j.nodes[i].name);
      const unmapped = names.filter(n => !ubcBoneName(n).startsWith('DEF-') && !/^(root|ik_|interaction|center)/i.test(n));
      expect(unmapped).toEqual([]);
      const tips = names.filter(n => /_04_leaf_/.test(n));
      expect(tips.length).toBe(10);
      for (const n of tips) expect(regionOfBone(ubcBoneName(n))).toBe(R.ARM);
    });
  }
});
