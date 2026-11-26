import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mats, type Mat } from './materials';
import { BUILDERS } from './index';
import { Kit } from './kit';

const PATCHED: Mat[] = ['steel', 'polymer', 'wood', 'tan', 'chrome', 'lens', 'olive', 'glass', 'cloth', 'brass'];

describe('gun materials', () => {
  it('has all 11 shared materials', () => {
    const M = mats();
    for (const k of [...PATCHED, 'bore'] as Mat[]) { expect(M[k]).toBeTruthy(); expect(M[k].userData.shared).toBe(true); }
  });
  it('patches the shader with its marker and a cache key', () => {
    const M = mats();
    for (const k of PATCHED) {
      const m = M[k] as THREE.MeshStandardMaterial;
      expect(m.customProgramCacheKey()).toContain(k);
      const sh = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <opaque_fragment>' };
      m.onBeforeCompile(sh as never, null as never);
      expect(sh.fragmentShader).toContain(`GM_${k.toUpperCase()}`);
      expect(sh.fragmentShader).toContain('gmNoise');
      expect(sh.vertexShader).toContain('gmP = position');
      expect(sh.fragmentShader).not.toContain('#include <common>\n#include <common>');
    }
  });
  it('triangle budget across guns', () => {
    let tris = 0;
    for (const b of Object.values(BUILDERS)) {
      const k = new Kit(); b!(k); const g = k.build('t');
      g.traverse(o => { const me = o as THREE.Mesh; if (me.isMesh) tris += me.geometry.attributes.position.count / 3; });
    }
    console.log('TOTAL_TRIS', tris);
    expect(tris).toBeLessThan(60000);
  });
});
