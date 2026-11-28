/**
 * Batch 1 Driving Feel regression tests (D1-D5):
 * - D1: wall scraping sheds 15-25%+ speed/s, prevents barrier climbing (< 0.08 m rise), normal-scaled damage (<= 10% glancing vs heavy head-on)
 * - D2: progressive keyboard steering (0.1 s tap at 60 mph = small correction, full lock ~0.3-0.45 s, quick return) vs 1:1 analog gamepad
 * - D3: class-differentiated visual body spring (sedan >= 2.5 deg nose-down braking with 1 soft overshoot, >= 3 deg roll at 0.8 g, SUV/van > sedan > super/race)
 * - D4: supercar 0-60 mph ~2.6-3.0 s, braking <= 1.4 g, strict class ordering (super > coupe > muscle > sportsedan > sedan > van)
 * - D5: severe >= 45 mph head-on crashes (big shake + pull-back respecting cameraShake, glass shatter, dead NPC stuck horn, Blood & gore gated windscreen ejection)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { RAPIER, Physics, initPhysics, G_STATIC, ALL, groups } from '../core/physics';
import {
  VehiclePhysics,
  stepSteerInput,
  normalImpactMetrics,
  wallScrapeDecel,
  type DriveInput,
} from './vehiclePhysics';
import { bodySpringParams, stepBodySpring, type BodySpringState } from './vehicle';
import { layoutFor } from './shapes';
import { VEHICLES, type VehicleKind } from './specs';
import { vehicleCrashDamage, crashEffects, MPH } from '../game/impact';
import { CameraRig } from '../game/camera';

const DT = 1 / 60;

function flatWorld() {
  const p = new Physics();
  const floor = p.world.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.7));
  p.tag(floor, { kind: 'static' });
  return p;
}

describe('D1: wall scraping, barrier climb prevention, and normal-scaled damage', () => {
  beforeAll(async () => { await initPhysics(); });

  it('normal-component impact damage keeps glancing scrapes <= 10% health while head-on hits deal heavy damage', () => {
    const maxHp = VEHICLES.sportsedan.health;
    // Glancing scrape at 69 mph (31 m/s) at 12 degrees into wall
    const ang = (12 * Math.PI) / 180;
    const vx = 31 * Math.cos(ang), vz = -31 * Math.sin(ang);
    const glance = normalImpactMetrics(vx, vz, vx * 0.96, 0, 0, 1);
    expect(glance.angleDeg).toBeLessThan(20);
    const glanceDmg = vehicleCrashDamage(glance.normalSpeed, glance.angleDeg, maxHp, false);
    expect(glanceDmg / maxHp).toBeLessThanOrEqual(0.10);
    // Sustained scrape ticks while cooldown active add 0 extra chunk damage
    expect(vehicleCrashDamage(glance.normalSpeed, glance.angleDeg, maxHp, true)).toBe(0);

    // Head-on impact at the exact same 69 mph speed (90 degrees) deals heavy damage
    const headOn = normalImpactMetrics(0, -31, 0, 0, 0, 1);
    expect(headOn.angleDeg).toBeGreaterThan(80);
    const headDmg = vehicleCrashDamage(headOn.normalSpeed, headOn.angleDeg, maxHp, false);
    expect(headDmg / maxHp).toBeGreaterThan(0.5);
    expect(headDmg).toBeGreaterThan(glanceDmg * 5);
  });

  it('scraping a freeway median barrier at 69 mph while holding W+A slows the car, keeps rise < 0.08 m, and stays on its side', () => {
    const p = flatWorld();
    // Freeway median barrier along X at z = 0 (matches expansion.ts: halfW=0.32, height=0.9, center y=0.45)
    const wall = p.world.createCollider(
      RAPIER.ColliderDesc.cuboid(500, 0.45, 0.32)
        .setTranslation(250, 0.45, 0)
        .setFriction(0.9)
        .setCollisionGroups(groups(G_STATIC, ALL)),
    );
    p.tag(wall, { kind: 'static' });

    // Start in the south lane (z = +1.85), heading +X (yaw = Math.PI/2), steering left (steer = +1 => towards -Z median)
    const car = new VehiclePhysics(p, VEHICLES.sportsedan, layoutFor('sportsedan'), 0, 0.8, 1.85, Math.PI / 2);
    const step = (input: DriveInput) => { car.fixedUpdate(DT, input); p.step(DT); car.postStep(); };
    for (let i = 0; i < 60; i++) step({ throttle: 0, steer: 0, handbrake: false });
    const restY = car.position.y;
    car.setVelocity(31, 0, 0); // 69 mph

    let maxRise = 0;
    let minZ = Infinity;
    let scrapeFrames = 0;
    let totalDmg = 0;
    let contactSpeedStart = -1;
    let contactSteps = 0;

    for (let i = 0; i < 75; i++) {
      step({ throttle: 1, steer: 1, handbrake: false });
      const pos = car.position;
      maxRise = Math.max(maxRise, pos.y - restY);
      minZ = Math.min(minZ, pos.z);
      if (car.scrapeActive) {
        scrapeFrames++;
        if (contactSpeedStart < 0) contactSpeedStart = car.speed;
        contactSteps++;
      }
      if (car.impactNormal > 3.5) {
        totalDmg += vehicleCrashDamage(car.impactNormal, car.impactAngleDeg, VEHICLES.sportsedan.health, car.scrapeDamageSuppressed);
      }
    }

    const endSpeed = car.speed;
    const contactSec = contactSteps * DT;
    const speedLossPctPerSec = contactSpeedStart > 0 && contactSec > 0.1
      ? ((contactSpeedStart - endSpeed) / contactSpeedStart) / contactSec
      : 0;

    expect(wallScrapeDecel(31)).toBeGreaterThan(8);
    expect(scrapeFrames).toBeGreaterThan(15);
    expect(endSpeed).toBeLessThan(31); // never accelerates while grinding
    expect(speedLossPctPerSec).toBeGreaterThanOrEqual(0.15); // sheds >= 15% speed per second of contact
    expect(maxRise).toBeLessThan(0.08); // stays at road height (does not climb the barrier)
    expect(minZ).toBeGreaterThan(0.32); // stays on its side of the median barrier
    expect(totalDmg / VEHICLES.sportsedan.health).toBeLessThanOrEqual(0.10); // glancing scrape <= 10% health
  });
});

describe('D2: progressive keyboard steering vs 1:1 analog gamepad steering', () => {
  it('at 60 mph on keyboard, a 0.1 s tap is a small lane correction, full lock takes 0.3-0.45 s, and return to centre is quick', () => {
    const v60 = 60 * MPH;
    let s = 0;
    // 0.1 s tap (6 steps at 60 Hz)
    for (let i = 0; i < 6; i++) s = stepSteerInput(s, 1, v60, DT, false);
    expect(s).toBeGreaterThan(0.08);
    expect(s).toBeLessThan(0.28); // small lane-change correction, not near-full lock

    // Continue holding until full lock (>= 0.99)
    let tFull = 0.1;
    for (let i = 0; i < 60 && s < 0.99; i++) {
      s = stepSteerInput(s, 1, v60, DT, false);
      tFull += DT;
    }
    expect(tFull).toBeGreaterThanOrEqual(0.3);
    expect(tFull).toBeLessThanOrEqual(0.45);

    // Return to centre from full lock stays crisp (<= 0.15 s)
    let tCenter = 0;
    for (let i = 0; i < 30 && Math.abs(s) > 0.01; i++) {
      s = stepSteerInput(s, 0, v60, DT, false);
      tCenter += DT;
    }
    expect(tCenter).toBeLessThanOrEqual(0.15);
  });

  it('gamepad analog steering stays 1:1 with the stick with zero added lag', () => {
    const v60 = 60 * MPH;
    expect(stepSteerInput(0, 0.37, v60, DT, true)).toBeCloseTo(0.37, 6);
    expect(stepSteerInput(0.37, -0.82, v60, DT, true)).toBeCloseTo(-0.82, 6);
    expect(stepSteerInput(-0.82, 0, v60, DT, true)).toBeCloseTo(0, 6);
  });
});

describe('D3: class-differentiated visual sprung body weight', () => {
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const freshState = (): BodySpringState => ({ roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0 });

  it('sedan braking at full force from 60 mph pitches >= 2.5 deg nose-down and settles with one soft overshoot', () => {
    const p = bodySpringParams(VEHICLES.sedan.cls, 'sedan');
    const st = freshState();
    const brakeDecel = -10.0; // ~1 g full braking
    const steadyTarget = -brakeDecel * p.pitchGain;
    let peakPitch = 0;
    let crossings = 0;
    let prevDiff = st.pitch - steadyTarget;

    for (let i = 0; i < 120; i++) {
      stepBodySpring(st, brakeDecel, 0, 0, true, 0, p, DT);
      peakPitch = Math.max(peakPitch, st.pitch);
      const diff = st.pitch - steadyTarget;
      if (i > 1 && Math.sign(diff) !== Math.sign(prevDiff) && Math.abs(diff) > 0.0005) crossings++;
      prevDiff = diff;
    }

    expect(toDeg(st.pitch)).toBeGreaterThanOrEqual(2.5);
    expect(toDeg(peakPitch)).toBeGreaterThan(toDeg(steadyTarget) * 1.08); // soft overshoot above steady angle
    expect(toDeg(peakPitch)).toBeLessThan(toDeg(steadyTarget) * 1.35); // controlled, not bouncy
    expect(crossings).toBeGreaterThanOrEqual(1);
    expect(Math.abs(st.pitch - steadyTarget)).toBeLessThan(0.002); // settled cleanly by 2 s
  });

  it('sedan in a 0.8 g corner rolls >= 3 deg and classes are visibly differentiated (SUV/van/luxury > sedan > coupe > super/race)', () => {
    const lat08g = 0.8 * 9.81;
    const steadyRollDeg = (kind: VehicleKind) => {
      const p = bodySpringParams(VEHICLES[kind].cls, kind);
      const st = freshState();
      for (let i = 0; i < 180; i++) stepBodySpring(st, 0, lat08g, 0, true, 0, p, DT);
      return toDeg(st.roll);
    };
    const rSuv = steadyRollDeg('suv');
    const rVan = steadyRollDeg('van');
    const rLux = steadyRollDeg('luxury');
    const rSedan = steadyRollDeg('sedan');
    const rCoupe = steadyRollDeg('coupe');
    const rSuper = steadyRollDeg('super');
    const rRace = steadyRollDeg('race');

    expect(rSedan).toBeGreaterThanOrEqual(3.0);
    expect(rSuv).toBeGreaterThan(rSedan);
    expect(rVan).toBeGreaterThan(rSedan);
    expect(rLux).toBeGreaterThan(rSedan);
    expect(rSedan).toBeGreaterThan(rCoupe);
    expect(rCoupe).toBeGreaterThan(rSuper);
    expect(rRace).toBeLessThan(rCoupe);
  });
});

describe('D4: believable supercar acceleration & braking + class ordering', () => {
  beforeAll(async () => { await initPhysics(); });

  function measureAccelAndBrake(kind: VehicleKind): { t60: number; brakeG: number; topSpeed: number } {
    const p = flatWorld();
    const car = new VehiclePhysics(p, VEHICLES[kind], layoutFor(kind), 0, 1.2, 0, 0);
    const step = (input: DriveInput) => { car.fixedUpdate(DT, input); p.step(DT); car.postStep(); };
    for (let i = 0; i < 90; i++) step({ throttle: 0, steer: 0, handbrake: false });

    const v60 = 60 * MPH;
    let t60 = NaN;
    for (let i = 0; i < 60 * 25; i++) {
      step({ throttle: 1, steer: 0, handbrake: false });
      if (Number.isNaN(t60) && car.speed >= v60) { t60 = (i + 1) * DT; break; }
    }

    // Measure full braking from 60 mph (or current speed if slower)
    const vStart = car.speed;
    const z0 = car.position.z;
    for (let i = 0; i < 60 * 10 && car.speed > 0.3; i++) {
      step({ throttle: -1, steer: 0, handbrake: false });
    }
    const dist = Math.max(0.1, car.position.z - z0);
    const brakeG = (vStart * vStart) / (2 * dist * 9.81);
    return { t60, brakeG, topSpeed: VEHICLES[kind].topSpeed };
  }

  it('supercar hits 0-60 mph in 2.6-3.0 s with <= 1.4 g braking and preserves class ordering super > coupe > muscle > sportsedan > sedan > van', () => {
    const sup = measureAccelAndBrake('super');
    const coupe = measureAccelAndBrake('coupe');
    const muscle = measureAccelAndBrake('muscle');
    const sport = measureAccelAndBrake('sportsedan');
    const sedan = measureAccelAndBrake('sedan');
    const van = measureAccelAndBrake('van');

    expect(sup.t60).toBeGreaterThanOrEqual(2.55);
    expect(sup.t60).toBeLessThanOrEqual(3.05);
    expect(sup.brakeG).toBeLessThanOrEqual(1.4);

    // Strict 0-60 mph ordering (lower time = faster)
    expect(sup.t60).toBeLessThan(coupe.t60);
    expect(coupe.t60).toBeLessThan(muscle.t60);
    expect(muscle.t60).toBeLessThan(sport.t60);
    expect(sport.t60).toBeLessThan(sedan.t60);
    expect(sedan.t60).toBeLessThan(van.t60);

    // Strict top speed ordering
    expect(sup.topSpeed).toBeGreaterThan(coupe.topSpeed);
    expect(coupe.topSpeed).toBeGreaterThan(muscle.topSpeed);
    expect(muscle.topSpeed).toBeGreaterThan(sport.topSpeed);
    expect(sport.topSpeed).toBeGreaterThan(sedan.topSpeed);
    expect(sedan.topSpeed).toBeGreaterThan(van.topSpeed);
  });
});

describe('D5: violent >= 45 mph head-on crashes, camera pull-back, stuck horn, and gore-gated windscreen ejection', () => {
  beforeAll(async () => { await initPhysics(); });

  it('classifies >= 45 mph head-on impacts as severe with shake, pull-back, glass shatter, NPC kill, and Blood & gore gated ejection', () => {
    // Below 45 mph head-on: not severe
    const mild = crashEffects(30 * MPH, 0.95, true, true, 30 * MPH);
    expect(mild.severe).toBe(false);
    expect(mild.pullBack).toBe(0);
    expect(mild.shatterFront).toBe(false);
    expect(mild.killNpcDriver).toBe(false);
    expect(mild.ejectDriver).toBe(false);

    // 50 mph head-on with NPC driver: severe, shatters front glass, kills NPC (stuck horn), no player/NPC ejection yet
    const npc50 = crashEffects(50 * MPH, 0.95, true, true, 50 * MPH);
    expect(npc50.severe).toBe(true);
    expect(npc50.shake).toBeGreaterThan(0.8);
    expect(npc50.pullBack).toBeGreaterThan(0.8);
    expect(npc50.shatterFront).toBe(true);
    expect(npc50.killNpcDriver).toBe(true);
    expect(npc50.ejectDriver).toBe(false);

    // 75 mph head-on with Blood & gore ON: ejects player through windscreen
    const player75Blood = crashEffects(75 * MPH, 0.98, false, true, 75 * MPH);
    expect(player75Blood.severe).toBe(true);
    expect(player75Blood.ejectDriver).toBe(true);
    expect(player75Blood.ejectSpeed).toBeGreaterThan(15);

    // 75 mph head-on with Blood & gore OFF: no windscreen ejection
    const player75Clean = crashEffects(75 * MPH, 0.98, false, false, 75 * MPH);
    expect(player75Clean.severe).toBe(true);
    expect(player75Clean.ejectDriver).toBe(false);

    // Glancing hit at 75 mph (side contact, frontDot = 0.2): never triggers head-on severe effects
    const side75 = crashEffects(8, 0.2, false, true, 75 * MPH);
    expect(side75.severe).toBe(false);
    expect(side75.ejectDriver).toBe(false);
  });

  it('CameraRig.crashKick applies trauma and pull-back respecting settings.cameraShake', () => {
    const p = flatWorld();
    const cam = new CameraRig(new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500), p);
    cam.shakeScale = 1;
    cam.crashKick(1.0, 1.2);
    expect(cam.trauma).toBeGreaterThan(0.8);
    expect(cam.crashPullOffset).toBeCloseTo(1.2, 4);

    // With cameraShake = 0, both trauma and pull-back are suppressed
    const camOff = new CameraRig(new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500), p);
    camOff.shakeScale = 0;
    camOff.crashKick(1.0, 1.2);
    expect(camOff.trauma).toBe(0);
    expect(camOff.crashPullOffset).toBe(0);
  });
});
