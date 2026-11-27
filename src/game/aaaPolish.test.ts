import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vehicleGearRpm } from '../vehicles/vehicle';
import { chaseCameraFx } from './camera';
import { addMacroVariation } from '../render/materials';
import { OUTPUT_GRADE_FRAG } from '../render/renderer';
import { FACADE_FRAG_PARS } from '../world/facadeShader';
import { Inventory } from '../combat/weapons';
import { wheelSlots } from '../combat/wheelSlots';

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
});
