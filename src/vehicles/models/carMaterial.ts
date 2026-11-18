/**
 * Car materials. One physical material per vehicle drives every surface kind of the merged, skinned body (paint with
 * clearcoat and metallic flake, chrome, rubber with tread, lamps with emissive lenses, grilles, plates, liveries,
 * grime, burn); one glass material per vehicle hides broken panes. Programs are shared across vehicles.
 */
import * as THREE from 'three';
import { nightUniform } from '../../render/materials';
import { K } from './kinds';
import { GROUND } from '../shapes';

let atlas: THREE.CanvasTexture | null = null;
/** Decal atlas: livery texts (top row), number plates (row 2), taxi / race numbers (row 3). */
export function decalAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const text = (t: string, x: number, y: number, w: number, h: number, color: string, font: string, stroke?: string) => {
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (stroke) { g.lineWidth = h * 0.08; g.strokeStyle = stroke; g.strokeText(t, x + w / 2, y + h / 2, w * 0.94); }
    g.fillStyle = color; g.fillText(t, x + w / 2, y + h / 2, w * 0.94);
  };
  // row 0 (v 0.875..1): POLICE | TACTICAL UNIT
  g.fillStyle = 'rgba(0,0,0,0)';
  text('POLICE', 0, 0, 512, 64, '#10141c', '900 54px "Barlow Condensed", Arial Narrow, sans-serif');
  text('TACTICAL UNIT', 512, 0, 512, 64, '#e8e8e8', '800 46px "Barlow Condensed", Arial Narrow, sans-serif');
  // row 1 (v 0.75..0.875): eight number plates
  const letters = ['4MRD271', '7KQP508', '2BXL944', '6TNE113', '8HRA662', '3CVW735', '5PLM019', '1ZDK480'];
  for (let i = 0; i < 8; i++) {
    const x = i * 128, y = 64;
    g.fillStyle = '#f3f0e6'; g.fillRect(x + 2, y + 2, 124, 60);
    g.fillStyle = '#2d4f86'; g.fillRect(x + 2, y + 2, 124, 13);
    text('PORT MERIDIAN', x, y + 2, 128, 13, '#f3f0e6', '700 11px Arial, sans-serif');
    text(letters[i], x, y + 18, 128, 44, '#1d2f5c', '700 38px "Barlow Condensed", Arial Narrow, sans-serif');
    g.strokeStyle = '#5a5a5a'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, 122, 58);
  }
  // row 2 (v 0.625..0.75): TAXI | 27 | 08 | MPD crest
  g.fillStyle = '#ffd84a'; g.fillRect(0, 128, 256, 64);
  text('TAXI', 0, 128, 256, 64, '#141414', '900 56px "Barlow Condensed", Arial Narrow, sans-serif');
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(256 + 64, 160, 30, 0, Math.PI * 2); g.fill();
  text('27', 256, 128, 128, 64, '#111', '900 44px "Barlow Condensed", Arial Narrow, sans-serif');
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(384 + 64, 160, 30, 0, Math.PI * 2); g.fill();
  text('08', 384, 128, 128, 64, '#111', '900 44px "Barlow Condensed", Arial Narrow, sans-serif');
  // crest
  g.fillStyle = '#c9a43a'; g.beginPath(); g.moveTo(576, 132); g.lineTo(610, 142); g.lineTo(604, 178); g.lineTo(576, 190); g.lineTo(548, 178); g.lineTo(542, 142); g.closePath(); g.fill();
  g.fillStyle = '#20304d'; g.beginPath(); g.arc(576, 160, 16, 0, Math.PI * 2); g.fill();
  text('PORT MERIDIAN', 640, 128, 384, 64, '#10141c', '700 30px "Barlow Condensed", Arial Narrow, sans-serif');
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  return atlas;
}
/** Atlas cells [u0, v0, u1, v1] (texture v grows upwards). */
export const CELL = {
  police: [0, 0.875, 0.5, 1], tactical: [0.5, 0.875, 1, 1], taxi: [0, 0.625, 0.25, 0.75], n27: [0.25, 0.625, 0.375, 0.75], n08: [0.375, 0.625, 0.5, 0.75],
  crest: [0.5, 0.625, 0.625, 0.75], city: [0.625, 0.625, 1, 0.75],
} as const;

export interface CarUniforms {
  uPaint: { value: THREE.Color }; uPaint2: { value: THREE.Color }; uMetal: { value: number }; uLivery: { value: number };
  uBurn: { value: number }; uFlash: { value: number }; uDirt: { value: number };
  uHead: { value: number }; uTail: { value: number }; uInd: { value: THREE.Vector2 }; uRev: { value: number }; uBar: { value: THREE.Vector2 }; uLight: { value: number };
  uGrille: { value: number }; uTrack: { value: THREE.Vector2 };
  /** half width, belt y, door z min, door z max */ uBody: { value: THREE.Vector4 };
  /** roof y, front z, rear z, seed */ uBody2: { value: THREE.Vector4 };
}
const hdr = (k: Record<string, number>) => Object.entries(k).map(([n, v]) => `#define K_${n} ${v}.0`).join('\n');
/** Body material (one per vehicle; the program is shared). */
export function carMaterial(): THREE.MeshPhysicalMaterial & { userData: { u: CarUniforms } } {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.DoubleSide, shadowSide: THREE.FrontSide, envMapIntensity: 1.15 });
  const u: CarUniforms = {
    uPaint: { value: new THREE.Color(0.5, 0.5, 0.5) }, uPaint2: { value: new THREE.Color(1, 1, 1) }, uMetal: { value: 0.5 }, uLivery: { value: 0 },
    uBurn: { value: 0 }, uFlash: { value: 0 }, uDirt: { value: 0 },
    uHead: { value: 0 }, uTail: { value: 0 }, uInd: { value: new THREE.Vector2() }, uRev: { value: 0 }, uBar: { value: new THREE.Vector2() }, uLight: { value: 0 },
    uGrille: { value: 0 }, uTrack: { value: new THREE.Vector2() },
    uBody: { value: new THREE.Vector4(0.9, 1, -1, 1) }, uBody2: { value: new THREE.Vector4(1.4, 2.3, -2.3, 0) },
  };
  m.userData.u = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u); sh.uniforms.uNight = nightUniform; sh.uniforms.uDecal = { value: decalAtlas() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 color; attribute float aKind;
        varying vec4 vCol; varying float vKind; varying vec3 vObj; varying vec2 vDec; varying vec3 vObjN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCol = color; vKind = aKind; vObj = position; vDec = uv; vObjN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${hdr(K)}
        varying vec4 vCol; varying float vKind; varying vec3 vObj; varying vec2 vDec; varying vec3 vObjN;
        uniform vec3 uPaint, uPaint2; uniform float uMetal, uLivery, uBurn, uFlash, uDirt, uHead, uTail, uRev, uLight, uGrille, uNight;
        uniform vec2 uInd, uBar, uTrack; uniform vec4 uBody, uBody2; uniform sampler2D uDecal;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        bool isK(float k) { return abs(vKind - k) < 0.5; }
        vec4 decal(vec4 cell, vec2 uv) { if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0); return texture2D(uDecal, mix(cell.xy, cell.zw, uv)); }
        vec2 sideUV(float z0, float z1, float y0, float y1) { float u = (vObj.z - z0) / (z1 - z0); if (vObj.x > 0.0) u = 1.0 - u; return vec2(u, (vObj.y - y0) / (y1 - y0)); }
        float gRough = 0.5, gMetal = 0.0, gCoat = 0.0; vec3 gEmis = vec3(0.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 col = vCol.rgb;
        float side = step(uBody.x - 0.32, abs(vObj.x)) * step(0.5, abs(vObjN.x));
        float hy = vObj.y - (${GROUND.toFixed(3)});
        if (isK(K_PAINT) || isK(K_PAINT2)) {
          col = isK(K_PAINT2) ? uPaint2 : uPaint; gRough = 0.3; gMetal = uMetal * 0.55; gCoat = 1.0;
          float liv = uLivery;
          if (abs(liv - 1.0) < 0.5) { // police: white doors and roof, door text, crest
            float doors = side * step(vObj.z, uBody.w + 0.06) * step(uBody.z - 0.06, vObj.z) * step(vObj.y, uBody.y - 0.02);
            float roof = step(uBody2.x - 0.12, vObj.y);
            col = mix(col, vec3(0.92), max(doors, roof));
            vec4 t = decal(vec4(0.0, 0.875, 0.5, 1.0), sideUV(uBody.z + 0.25, uBody.w - 0.15, uBody.y - 0.4, uBody.y - 0.16));
            col = mix(col, t.rgb, t.a * side);
            vec2 cuv = sideUV(uBody.w - 0.05, uBody.w + 0.45, uBody.y - 0.38, uBody.y - 0.02); vec4 cr = decal(vec4(0.5, 0.625, 0.625, 0.75), cuv);
            col = mix(col, cr.rgb, cr.a * side * step(cuv.x, 1.0));
          } else if (abs(liv - 2.0) < 0.5) { // taxi: checker band
            float band = side * step(uBody.y - 0.17, vObj.y) * step(vObj.y, uBody.y - 0.07);
            float ch = mod(floor(vObj.z * 20.0) + floor(vObj.y * 20.0), 2.0);
            col = mix(col, vec3(ch * 0.9 + 0.03), band);
          } else if (abs(liv - 3.0) < 0.5) { // race: stripes, side band and roundel
            float top = step(uBody.y - 0.12, vObj.y) * step(0.3, vObjN.y);
            float st = top * (step(0.1, abs(vObj.x)) * step(abs(vObj.x), 0.24));
            col = mix(col, uPaint2, st);
            float sb = side * step(0.3 + 0.0, hy) * step(hy, 0.42);
            col = mix(col, uPaint2, sb);
            vec2 rc = vec2((uBody.z + uBody.w) * 0.5, uBody.y - 0.3);
            float rd = length(vec2(vObj.z, vObj.y) - rc);
            col = mix(col, vec3(0.95), side * step(rd, 0.25));
            vec4 n = decal(vec4(0.25, 0.625, 0.375, 0.75), sideUV(rc.x - 0.3, rc.x + 0.3, rc.y - 0.3, rc.y + 0.3));
            col = mix(col, n.rgb, n.a * side * step(rd, 0.25) * step(0.5, 1.0 - n.r * 0.0));
          } else if (abs(liv - 4.0) < 0.5) { // muscle: twin stripes over the top
            float top = step(0.35, vObjN.y) + step(uBody2.y - 0.3, vObj.z) * step(0.2, vObjN.z) + step(vObj.z, uBody2.z + 0.3) * step(0.2, -vObjN.z);
            float st = min(top, 1.0) * step(0.07, abs(vObj.x)) * step(abs(vObj.x), 0.2);
            col = mix(col, uPaint2, st);
          } else if (abs(liv - 5.0) < 0.5) { // tactical van text
            vec4 t = decal(vec4(0.5, 0.875, 1.0, 1.0), sideUV(-2.6, 0.2, 1.3, 1.75));
            col = mix(col, t.rgb, t.a * step(1.0, abs(vObj.x)) * step(0.5, abs(vObjN.x)));
          } else if (liv > 5.5) { // army / tank camo
            float n1 = vnoise(vObj.xz * 1.3 + vObj.y * 0.7), n2 = vnoise(vObj.zy * 1.7 + 4.0);
            col = mix(col, col * vec3(0.72, 0.66, 0.5), step(0.58, n1));
            if (liv > 6.5) col = mix(col, vec3(0.08, 0.08, 0.07), step(0.68, n2));
            gRough = 0.88; gCoat = 0.0; gMetal = 0.05;
          }
        } else if (isK(K_CHROME)) { col = vec3(0.86, 0.88, 0.9); gRough = 0.07; gMetal = 1.0; }
        else if (isK(K_TRIM)) { gRough = 0.5; gCoat = 0.3; }
        else if (isK(K_RUBBER)) {
          col = vec3(0.028); gRough = 0.92;
          if (vDec.y <= 1.0) { // tread: blocks + circumferential grooves
            float lat = step(0.5, fract(vDec.x * 64.0 + step(0.5, fract(vDec.y * 3.0)) * 0.5));
            float groove = step(abs(fract(vDec.y * 4.0) - 0.5), 0.06);
            col *= 1.0 - 0.5 * max(groove, lat * 0.6);
          } else { col = vec3(0.035); gRough = 0.8; }
        }
        else if (isK(K_RIM)) { gRough = 0.24; gMetal = 0.9; gCoat = 0.6; }
        else if (isK(K_INTERIOR)) { gRough = 0.88; col *= 0.9 + 0.1 * vnoise(vObj.xz * 40.0); }
        else if (isK(K_HEAD)) {
          col = vec3(0.7, 0.72, 0.75); gRough = 0.06; gMetal = 0.95; gCoat = 1.0;
          float cell = fract(vObj.x * 9.0); col *= 0.7 + 0.3 * smoothstep(0.05, 0.25, cell) * smoothstep(0.95, 0.75, cell);
          gEmis = vec3(1.0, 0.93, 0.8) * uHead;
        }
        else if (isK(K_TAIL)) { col = vec3(0.32, 0.015, 0.02); gRough = 0.08; gCoat = 1.0; float b = step(0.5, fract(vObj.y * 30.0)); col *= 0.8 + 0.2 * b; gEmis = vec3(1.0, 0.04, 0.03) * uTail * (0.85 + 0.15 * b); }
        else if (isK(K_IND)) { col = vec3(0.55, 0.28, 0.04); gRough = 0.08; gCoat = 1.0; gEmis = vec3(1.0, 0.45, 0.04) * (vObj.x > 0.0 ? uInd.x : uInd.y); }
        else if (isK(K_REV)) { col = vec3(0.75); gRough = 0.08; gCoat = 1.0; gEmis = vec3(1.0, 0.97, 0.92) * uRev; }
        else if (isK(K_GRILLE)) {
          gRough = 0.6; gMetal = 0.3;
          float p = 0.0;
          if (uGrille < 0.5) p = step(0.55, fract(vObj.y * 32.0));
          else if (uGrille < 1.5) { vec2 q = vObj.xy * vec2(36.0, 42.0); q.x += step(0.5, fract(q.y * 0.5)) * 0.5; p = step(0.22, abs(fract(q.x) - 0.5)) * step(0.22, abs(fract(q.y) - 0.5)); p = 1.0 - p; }
          else if (uGrille < 2.5) p = step(0.6, fract(vObj.x * 26.0));
          else p = max(step(abs(vObj.x), 0.035), step(abs(fract(vObj.y * 5.0) - 0.5), 0.07));
          col = mix(vec3(0.012), uGrille > 1.5 || uGrille < 0.5 ? vec3(0.55) : vec3(0.06), p);
          gMetal = mix(0.2, 0.9, p * step(abs(uGrille - 1.0), 0.6) * 0.0 + p * (1.0 - step(abs(uGrille - 1.0), 0.5)));
          gRough = mix(0.8, 0.2, p);
        }
        else if (isK(K_PLATE) || isK(K_DECAL)) { vec4 t = texture2D(uDecal, vDec); col = t.rgb; gRough = 0.45; if (isK(K_DECAL)) gEmis = t.rgb * uLight * 0.8; }
        else if (isK(K_SEAM)) { col = vec3(0.008); gRough = 0.9; }
        else if (isK(K_BAR_RED)) { col = vec3(0.4, 0.02, 0.02); gRough = 0.1; gCoat = 1.0; gEmis = vec3(1.0, 0.02, 0.015) * uBar.x; }
        else if (isK(K_BAR_BLUE)) { col = vec3(0.02, 0.06, 0.4); gRough = 0.1; gCoat = 1.0; gEmis = vec3(0.1, 0.3, 1.0) * uBar.y; }
        else if (isK(K_UNDER)) { gRough = 0.95; }
        else if (isK(K_PLASTIC)) { gRough = 0.62; col *= 0.9 + 0.2 * vnoise(vObj.xz * 90.0 + vObj.y * 60.0); }
        else if (isK(K_MIRROR)) { col = vec3(0.55); gRough = 0.02; gMetal = 1.0; }
        else if (isK(K_TRACK)) {
          float link = fract(vDec.x + (vObj.x > 0.0 ? uTrack.x : uTrack.y));
          float pad = step(0.18, link) * step(link, 0.82);
          col = mix(vec3(0.06), vec3(0.16, 0.16, 0.15), pad); gRough = 0.6; gMetal = 0.6;
          if (vDec.y > 1.5) col *= 0.6;
        }
        else if (isK(K_CANVAS)) { gRough = 0.97; col *= 0.85 + 0.15 * vnoise(vObj.zy * 6.0); }
        else if (isK(K_METAL)) { gRough = 0.42; gMetal = 0.75; }
        else if (isK(K_LIGHT)) { gRough = 0.3; gEmis = vCol.rgb * uLight; }
        // grime low on the body (more with damage), burn, damage flash
        float paintLike = (isK(K_PAINT) || isK(K_PAINT2) || isK(K_PLASTIC) || isK(K_RIM) || isK(K_CHROME)) ? 1.0 : 0.0;
        float grime = uDirt * smoothstep(0.85, 0.08, hy) * paintLike * (0.6 + 0.4 * vnoise(vObj.xz * 3.0 + vObj.y * 5.0));
        col = mix(col, vec3(0.17, 0.14, 0.11), grime * 0.8);
        col = mix(col, vec3(0.05, 0.045, 0.04), uBurn * (1.0 - step(abs(vKind - K_RUBBER), 0.5) * 0.5));
        col += uFlash * 0.3;
        if (!gl_FrontFacing) { col = isK(K_INTERIOR) ? col * 0.6 : vec3(0.02); gEmis = vec3(0.0); gCoat = 0.0; }
        diffuseColor.rgb = col;
        float gGrime = grime;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(gRough, 0.95, max(uBurn, gGrime)), 0.95, 0.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = gMetal * (1.0 - uBurn) * (1.0 - gGrime);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
        material.clearcoat = gCoat * (1.0 - gGrime) * (1.0 - uBurn);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEmis * (1.0 - uBurn);`);
  };
  m.customProgramCacheKey = () => 'car-v3';
  return m as THREE.MeshPhysicalMaterial & { userData: { u: CarUniforms } };
}

/** Glass: tinted, fresnel-bright, one material per vehicle so broken panes (bitmask) disappear. */
export function glassMaterial(): THREE.MeshStandardMaterial & { userData: { broken: { value: number } } } {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0.1, transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.0 });
  const broken = { value: 0 };
  m.userData.broken = broken;
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = nightUniform; sh.uniforms.uBroken = broken;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 color; uniform int uBroken; varying vec3 vObj; varying vec3 vTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vTint = color.rgb;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nif (((uBroken >> int(color.a + 0.5)) & 1) == 1) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vTint; uniform float uNight;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vTint;')
      .replace('#include <opaque_fragment>', `
        float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
        float dark = 1.0 - clamp(length(vTint) * 6.0, 0.0, 1.0);
        outgoingLight += vec3(0.55, 0.66, 0.75) * fres * 0.45 * (1.0 - uNight * 0.75);
        diffuseColor.a = clamp(0.28 + dark * 0.55 + fres * 0.5, 0.0, 0.96);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'car-glass-v3';
  return m as THREE.MeshStandardMaterial & { userData: { broken: { value: number } } };
}
