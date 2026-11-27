import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vehicleGearRpm } from '../vehicles/vehicle';
import { chaseCameraFx } from './camera';
import { addMacroVariation } from '../render/materials';
import { OUTPUT_GRADE_FRAG, composerTargetOptions } from '../render/renderer';
import { AO_FRAG, AO_BLUR_FRAG, CAS_GLSL } from '../render/post';
import { FACADE_FRAG_PARS } from '../world/facadeShader';
import { Inventory } from '../combat/weapons';
import { wheelSlots } from '../combat/wheelSlots';
import { playerProximityReaction, copLeadAimOffset, yieldStep } from '../actors/npc';
import { QUALITY } from '../core/settings';

describe('AAA driving, camera, shader & UI polish', () => {
  it('vehicleGearRpm computes reverse, neutral, progressive gears and clamped RPM', () => {
    const rev = vehicleGearRpm(-6, 40, -1);
    expect(rev.gear).toBe('R');
    expect(rev.gearNum).toBe(-1);
    expect(rev.rpm).toBeGreaterThanOrEqual(0);
    expect(rev.rpm).toBeLessThanOrEqual(1);

    const idle = vehicleGearRpm(0.1, 40, 0);
    expect(idle.gear).toBe('N');
    expect(idle.gearNum).toBe(0);
    expect(idle.rpm).toBeLessThan(0.25);

    const g1 = vehicleGearRpm(4, 40, 1);
    const gMid = vehicleGearRpm(20, 40, 1);
    const gRedline = vehicleGearRpm(35, 40, 1);
    const gTop = vehicleGearRpm(39, 40, 1);
    expect(g1.gearNum).toBeGreaterThanOrEqual(1);
    expect(gMid.gearNum).toBeGreaterThan(g1.gearNum);
    expect(gRedline.rpm).toBeGreaterThan(0.85);
    expect(gTop.gearNum).toBe(6);
    expect(gTop.rpm).toBeLessThanOrEqual(1);
  });

  it('chaseCameraFx adds acceleration pullback, braking dive, cornering lead and bounded roll', () => {
    const accelFx = chaseCameraFx(24, 0, 8, 0);
    const brakeFx = chaseCameraFx(24, 0, -9, 0);
    expect(accelFx.distOffset).toBeGreaterThan(0);
    expect(brakeFx.distOffset).toBeLessThan(0);

    const turnRight = chaseCameraFx(26, 0.8, 0, 0.35);
    const turnLeft = chaseCameraFx(26, -0.8, 0, -0.35);
    expect(Math.sign(turnRight.yawLead)).toBe(-Math.sign(turnLeft.yawLead));
    expect(Math.sign(turnRight.roll)).toBe(-Math.sign(turnLeft.roll));
    expect(Math.abs(turnRight.roll)).toBeLessThan(0.12);
    expect(Math.abs(turnRight.yawLead)).toBeLessThan(0.6);

    const still = chaseCameraFx(0, 1, 0, 0);
    expect(Math.abs(still.roll)).toBeLessThan(0.001);
  });

  it('grass macro shader adds organic hillside variation without sin() or road oil patches', () => {
    const m = addMacroVariation(new THREE.MeshStandardMaterial(), 0.2, 0.011, 'grass', 0);
    const sh = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>',
    };
    m.onBeforeCompile!(sh as never, null as never);
    expect(sh.fragmentShader).not.toContain('sin(');
    expect(sh.fragmentShader).not.toContain('mOil = smoothstep');
    expect(sh.fragmentShader).toContain('gMacro');
    expect(sh.fragmentShader).toContain('gDry');
  });

  it('output grade shader guards radial chromatic aberration so idle cost is zero', () => {
    expect(OUTPUT_GRADE_FRAG).toContain('uChroma');
    expect(OUTPUT_GRADE_FRAG).toContain('if (uChroma > 0.001)');
  });

  it('facade shader remains syntactically balanced and includes architectural lobby detail', () => {
    let depth = 0;
    for (const ch of FACADE_FRAG_PARS) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    expect(FACADE_FRAG_PARS).toContain('desk');
  });

  it('wheelSlots attaches normalized stat bars to enabled weapons', () => {
    const inv = new Inventory();
    inv.give('pistol', 36);
    inv.give('rifle', 60);
    const slots = wheelSlots(inv, true, false);
    const pistol = slots.find(s => s.id === 'cat:pistol');
    const rifle = slots.find(s => s.id === 'cat:rifle');
    expect(pistol?.enabled).toBe(true);
    expect(pistol?.stats?.length).toBe(4);
    expect(rifle?.stats?.length).toBe(4);
    for (const st of [...(pistol?.stats ?? []), ...(rifle?.stats ?? [])]) {
      expect(st.value).toBeGreaterThanOrEqual(0);
      expect(st.value).toBeLessThanOrEqual(1);
    }
  });

  it('post-processing & depth targets harden against NaN/Inf full-screen green flashes on Medium/High', () => {
    expect(OUTPUT_GRADE_FRAG).toContain('sanitizeHdr(');
    expect(AO_FRAG).toContain('cross(dx, dy)');
    expect(AO_FRAG).toContain('!(ao >= 0.0 && ao <= 1.0)');
    expect(AO_BLUR_FRAG).toContain('max(wsum, 1e-4)');
    expect(CAS_GLSL).toContain('clamp(max(m, vec3(0.0)), vec3(0.0), vec3(64.0))');
    const medTarget = composerTargetOptions(1280, 720, 0, QUALITY.medium.ao > 0);
    expect(medTarget.depthTexture).toBeDefined();
    expect(medTarget.depthTexture!.type).toBe(THREE.UnsignedIntType);
  });

  it('playerProximityReaction classifies civilian reactions across glance, yield, startle, shove, surrender, and fast car dive', () => {
    expect(playerProximityReaction(12, 1.5, 0.8, false, false)).toBe('none');
    expect(playerProximityReaction(7.0, 1.2, 0.2, false, false)).toBe('glance');
    expect(playerProximityReaction(2.8, 2.2, 0.8, false, false)).toBe('yield');
    expect(playerProximityReaction(1.2, 0.0, 0.0, false, false)).toBe('yield');
    expect(playerProximityReaction(4.5, 5.4, 0.85, false, false)).toBe('startle');
    expect(playerProximityReaction(0.7, 5.2, 0.9, false, false)).toBe('shove');
    expect(playerProximityReaction(14, 0, 0.9, true, false)).toBe('surrender');
    expect(playerProximityReaction(4.0, 12, 0.8, false, true)).toBe('dive');
    expect(playerProximityReaction(8.5, 8.0, 0.1, false, true)).toBe('glance');
  });

  it('copLeadAimOffset leads moving targets proportionally to velocity and skill without overshooting', () => {
    const still = copLeadAimOffset(0, 0, 20, 0.65);
    expect(still.dx).toBe(0);
    expect(still.dz).toBe(0);

    const moving = copLeadAimOffset(6, -3, 30, 0.65);
    expect(moving.dx).toBeGreaterThan(0.5);
    expect(moving.dz).toBeLessThan(-0.25);

    const fastFar = copLeadAimOffset(40, -40, 90, 1);
    expect(Math.abs(fastFar.dx)).toBeLessThanOrEqual(2.2);
    expect(Math.abs(fastFar.dz)).toBeLessThanOrEqual(2.2);
  });
  it('walkers step aside past a player standing still instead of being pushed back along their path', () => {
    // walker heading east, just west of a player who stands facing north (+z): the old rule stepped along the facing's
    // perpendicular, i.e. straight back west, so bridge walkers never got past a standing player
    const st = yieldStep(-1.2, 0.2, false, 0, 1, 1, 0);
    expect(Math.abs(st.x)).toBeLessThan(1e-9);
    expect(st.z).toBeGreaterThan(0.99); // sideways, on the side away from the player
    const st2 = yieldStep(-1.2, -0.2, false, 0, 1, 1, 0);
    expect(st2.z).toBeLessThan(-0.99);
    // a moving player still clears a lane off their own path
    const mv = yieldStep(0.3, 2, true, 1, 0, 0, 1);
    expect(Math.abs(mv.x)).toBeLessThan(1e-9);
    expect(Math.abs(mv.z)).toBeCloseTo(1, 6);
  });
});
