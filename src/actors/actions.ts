/**
 * Action library for people: named one-shot / looping / held moves built from the Universal Animation Library clips
 * plus procedural pose layers (body-space bone rotations keyed over normalised time).
 *
 * Pose rotations are degrees about the character's body axes, applied parent-first after the animation mixer:
 *   x = about the left axis   (+ bends the spine forward; + swings a hanging arm/leg backwards)
 *   y = about the up axis     (+ turns to the character's left)
 *   z = about the forward axis (+ tips the top to the character's right; + swings a hanging LEFT arm outwards)
 * Right-side entries are mirrored automatically when given through `sym()`.
 */
export type BoneKey = 'hips' | 'spine' | 'spine2' | 'chest' | 'neck' | 'head'
  | 'shL' | 'armL' | 'foreL' | 'handL' | 'shR' | 'armR' | 'foreR' | 'handR'
  | 'thighL' | 'shinL' | 'footL' | 'thighR' | 'shinR' | 'footR';
export type Euler = [number, number, number];
export type Pose = Partial<Record<BoneKey, Euler>>;

export const BONE_OF: Record<BoneKey, string> = {
  hips: 'DEF-hips', spine: 'DEF-spine001', spine2: 'DEF-spine002', chest: 'DEF-spine003', neck: 'DEF-neck', head: 'DEF-head',
  shL: 'DEF-shoulderL', armL: 'DEF-upper_armL', foreL: 'DEF-forearmL', handL: 'DEF-handL',
  shR: 'DEF-shoulderR', armR: 'DEF-upper_armR', foreR: 'DEF-forearmR', handR: 'DEF-handR',
  thighL: 'DEF-thighL', shinL: 'DEF-shinL', footL: 'DEF-footL', thighR: 'DEF-thighR', shinR: 'DEF-shinR', footR: 'DEF-footR',
};
/** Parent-first application order. */
export const BONE_ORDER: BoneKey[] = ['hips', 'spine', 'spine2', 'chest', 'neck', 'head', 'shL', 'armL', 'foreL', 'handL', 'shR', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

/** Mirrors left-side entries onto the right side (and keeps both). */
export function sym(p: Pose): Pose {
  const out: Pose = { ...p };
  for (const [k, v] of Object.entries(p) as [BoneKey, Euler][]) {
    if (k.endsWith('L')) { const r = (k.slice(0, -1) + 'R') as BoneKey; if (!(r in p)) out[r] = [v[0], -v[1], -v[2]]; }
  }
  return out;
}

export interface ActionDef {
  /** Base UAL clip (omit for a pure pose layer over the current state). */
  clip?: string;
  layer: 'full' | 'upper';
  from?: number; to?: number; rate?: number;
  /** Play the clip backwards (e.g. a get-up from a fall). */
  reverse?: boolean;
  loop?: boolean;
  /** Stay in the final pose until stopAction(). */
  hold?: boolean;
  /** Duration (s) for pose-only actions, or to override the clip span. */
  dur?: number;
  fade?: number;
  poses?: [number, Pose][];
  /** Named events at normalised times (e.g. 'strike' for melee contact). */
  events?: [number, string][];
  /** Never blocks other actions (busy stays false). */
  soft?: boolean;
}

const WIND_R: Pose = { chest: [0, -28, 0], armR: [28, 0, -12], foreR: [-40, 0, 0], armL: [-30, 0, 8], foreL: [-60, 0, 0] };

/** Built-in actions. Clip names from the UAL are also valid action names. */
export const ACTIONS: Record<string, ActionDef> = {
  // --- melee (wind-up -> strike -> recover); 'strike' is the contact frame
  punch_jab: { clip: 'Punch_Jab', layer: 'upper', rate: 1.3, fade: 0.06, events: [[0.38, 'strike']], poses: [[0, { chest: [0, 10, 0] }], [0.25, { chest: [4, 14, 0] }], [0.4, { chest: [6, -8, 0] }], [1, {}]] },
  punch_cross: { clip: 'Punch_Cross', layer: 'upper', rate: 1.2, fade: 0.06, events: [[0.42, 'strike']], poses: [[0, {}], [0.22, { chest: [0, -24, 0], spine: [0, -8, 0] }], [0.45, { chest: [8, 20, 0], spine: [4, 8, 0] }], [1, {}]] },
  punch_hook: { clip: 'Punch_Cross', layer: 'upper', rate: 1.05, fade: 0.07, events: [[0.46, 'strike']], poses: [[0, {}], [0.25, { chest: [0, -38, -4], spine: [0, -12, 0], armR: [10, 0, -35] }], [0.5, { chest: [10, 32, 6], spine: [4, 14, 0], armR: [0, 0, -55], foreR: [0, 30, 0] }], [1, {}]] },
  stab: { clip: 'Punch_Jab', layer: 'upper', rate: 1.25, fade: 0.05, events: [[0.4, 'strike']], poses: [[0, {}], [0.2, { armR: [20, 0, 0], foreR: [-30, 0, 0] }], [0.42, { chest: [8, 10, 0] }], [1, {}]] },
  swing_bat: { clip: 'Sword_Attack', layer: 'upper', rate: 1.15, fade: 0.08, events: [[0.42, 'strike']] },
  punch_windup: { layer: 'upper', dur: 0.22, fade: 0.05, poses: [[0, {}], [1, WIND_R]] },
  // --- hit reactions
  hit_light: { clip: 'Hit_Chest', layer: 'upper', rate: 1.25, fade: 0.05, soft: true },
  hit_head: { clip: 'Hit_Head', layer: 'full', rate: 1.1, fade: 0.05 },
  stagger: { clip: 'Hit_Chest', layer: 'full', rate: 0.9, fade: 0.06, poses: [[0, {}], [0.3, { spine: [-14, 0, 6], chest: [-10, 0, 0], head: [-12, 0, 0], armL: [-20, 0, 25], armR: [-20, 0, -25] }], [1, {}]] },
  knockdown: { clip: 'Death01', layer: 'full', rate: 1.35, fade: 0.06, hold: true },
  get_up: { clip: 'Death01', layer: 'full', reverse: true, rate: 1.1, fade: 0.12 },
  // --- reactions / civilians
  cower: { clip: 'Crouch_Idle_Loop', layer: 'full', loop: true, hold: true, fade: 0.2, poses: [[0, sym({ chest: [18, 0, 0], neck: [15, 0, 0], head: [20, 0, 0], armL: [-120, 0, 30], foreL: [-110, 0, 0] })]] },
  hands_up: { layer: 'upper', hold: true, dur: 0.35, fade: 0.2, poses: [[0, {}], [1, sym({ armL: [0, 0, 150], foreL: [0, 0, -70], head: [-6, 0, 0] })]] },
  panic: { layer: 'upper', loop: true, hold: true, dur: 0.5, fade: 0.15, poses: [[0, sym({ armL: [-40, 0, 50], foreL: [-60, 0, 0], head: [-8, 0, 0] })], [0.5, sym({ armL: [-70, 0, 35], foreL: [-90, 0, 0], head: [-4, 0, 0] })], [1, sym({ armL: [-40, 0, 50], foreL: [-60, 0, 0], head: [-8, 0, 0] })]] },
  point: { layer: 'upper', dur: 1.4, fade: 0.15, poses: [[0, {}], [0.2, { armR: [-85, 0, 0], foreR: [-5, 0, 0], head: [0, -8, 0] }], [0.8, { armR: [-85, 0, 0], foreR: [-5, 0, 0] }], [1, {}]] },
  wave: { layer: 'upper', dur: 1.6, fade: 0.15, poses: [[0, {}], [0.2, { armR: [0, 0, -150], foreR: [0, 0, 30] }], [0.4, { armR: [0, 0, -150], foreR: [0, 0, -10] }], [0.6, { armR: [0, 0, -150], foreR: [0, 0, 30] }], [0.8, { armR: [0, 0, -150], foreR: [0, 0, -10] }], [1, {}]] },
  // --- arrests
  handcuffed: { layer: 'upper', hold: true, dur: 0.6, fade: 0.25, poses: [[0, {}], [1, sym({ shL: [10, 0, 0], armL: [28, 0, -6], foreL: [12, 0, -58], chest: [-4, 0, 0], head: [12, 0, 0] })]] },
  cuffing: { clip: 'Interact', layer: 'upper', rate: 0.8, fade: 0.15, poses: [[0, {}], [0.4, sym({ chest: [14, 0, 0], armL: [-45, 0, -5], foreL: [-40, 0, 0] })], [1, {}]] },
  // officer reaches down for both wrists from behind, then the suspect's arms are drawn down and back to the cuffs
  cuff_reach: { layer: 'upper', hold: true, dur: 0.45, fade: 0.15, poses: [[0, {}], [1, { chest: [20, 0, 0], head: [14, 0, 0], ...sym({ armL: [-52, 0, -10], foreL: [-38, 0, 0] }) }]] },
  wrists_back: { layer: 'upper', hold: true, dur: 0.75, fade: 0.12, poses: [[0, sym({ armL: [0, 0, 150], foreL: [0, 0, -70], head: [-6, 0, 0] })], [0.5, sym({ shL: [6, 0, 0], armL: [14, 0, 70], foreL: [-10, 0, -40], chest: [8, 0, 0], head: [10, 0, 0] })], [1, sym({ shL: [10, 0, 0], armL: [28, 0, -6], foreL: [12, 0, -58], chest: [-4, 0, 0], head: [12, 0, 0] })]] },
  kneel: { clip: 'Fixing_Kneeling', layer: 'full', loop: true, hold: true, fade: 0.25 },
  // --- vehicles
  // driver side: left hand on the handle, pull the door round to the left (the player steps back on the legs layer)
  open_door: { layer: 'upper', dur: 1.05, fade: 0.12, events: [[0.42, 'open']], poses: [[0, {}], [0.3, { chest: [10, 8, 0], armL: [-30, 0, 6], foreL: [-28, 0, 0], head: [6, 0, 0] }], [0.45, { chest: [12, 10, 0], armL: [-34, 0, 4], foreL: [-22, 0, 0], head: [8, 0, 0] }], [0.78, { chest: [-2, 24, 0], spine: [0, 8, 0], armL: [-26, 0, 22], foreL: [-30, 0, 0] }], [1, {}]] },
  // passenger side: the mirror image with the right hand
  open_door_r: { layer: 'upper', dur: 1.05, fade: 0.12, events: [[0.42, 'open']], poses: [[0, {}], [0.3, { chest: [10, -8, 0], armR: [-30, 0, -6], foreR: [-28, 0, 0], head: [6, 0, 0] }], [0.45, { chest: [12, -10, 0], armR: [-34, 0, -4], foreR: [-22, 0, 0], head: [8, 0, 0] }], [0.78, { chest: [-2, -24, 0], spine: [0, -8, 0], armR: [-26, 0, -22], foreR: [-30, 0, 0] }], [1, {}]] },
  // sit down with the head ducked under the roof line
  enter_car: { clip: 'Sitting_Enter', layer: 'full', rate: 1.45, fade: 0.12, poses: [[0, {}], [0.35, { chest: [22, 0, 0], neck: [10, 0, 0], head: [18, 0, 0] }], [0.8, { chest: [18, 0, 0], head: [12, 0, 0] }], [1, {}]] },
  exit_car: { clip: 'Sitting_Exit', layer: 'full', rate: 1.45, fade: 0.1, poses: [[0, { chest: [18, 0, 0], head: [14, 0, 0] }], [0.45, { chest: [24, 0, 0], head: [16, 0, 0] }], [1, {}]] },
  // reach in with both hands, grab the collar, haul back
  pull_out: { layer: 'upper', dur: 1.4, fade: 0.1, events: [[0.42, 'grab']], poses: [[0, {}], [0.32, { chest: [22, 0, 0], spine: [8, 0, 0], ...sym({ armL: [-46, 0, -14], foreL: [-18, 0, 0] }) }], [0.45, { chest: [24, 0, 0], spine: [8, 0, 0], ...sym({ armL: [-44, 0, -16], foreL: [-30, 0, 0] }) }], [0.7, { chest: [-12, 0, 0], spine: [-6, 0, 0], ...sym({ armL: [-14, 0, -8], foreL: [-95, 0, 0] }) }], [1, {}]] },
  // dragged out backwards, arms flailing, then dumped (the knockdown follows)
  pulled_out: { clip: 'Hit_Chest', layer: 'full', rate: 0.75, fade: 0.06, poses: [[0, sym({ armL: [-50, 0, 40], foreL: [-30, 0, 0] })], [0.5, { spine: [-20, 0, 0], head: [-15, 0, 0], ...sym({ armL: [-80, 0, 50], foreL: [-40, 0, 0] }) }], [1, sym({ armL: [-40, 0, 30], foreL: [-20, 0, 0] })]] },
  thrown_out: { clip: 'Death01', layer: 'full', rate: 1.6, fade: 0.05, hold: true },
  // wind up and drive the fist through the side window
  smash_window: { layer: 'upper', dur: 1.05, fade: 0.08, events: [[0.42, 'smash']], poses: [[0, {}], [0.3, { chest: [0, -36, 0], spine: [0, -10, 0], armR: [35, 0, -35], foreR: [-125, 0, 0], armL: [-30, 0, 10], foreL: [-60, 0, 0] }], [0.44, { chest: [14, 22, 0], spine: [6, 8, 0], armR: [-38, 0, -8], foreR: [-6, 0, 0], armL: [-10, 0, 10], foreL: [-50, 0, 0] }], [0.62, { chest: [8, 10, 0], armR: [-28, 0, -10], foreR: [-40, 0, 0] }], [1, {}]] },
  // hunched under the dash, hands twisting the wires
  hotwire: { clip: 'Driving_Loop', layer: 'full', loop: true, hold: true, dur: 0.6, fade: 0.25, poses: [[0, { spine: [10, 0, 0], chest: [28, -6, 0], neck: [10, 0, 0], head: [22, 0, 0], ...sym({ armL: [-30, 0, -18], foreL: [-75, 0, 0], handL: [0, 0, 20] }) }], [0.5, { spine: [10, 0, 0], chest: [30, -4, 0], neck: [10, 0, 0], head: [24, 0, 0], ...sym({ armL: [-34, 0, -22], foreL: [-62, 0, 0], handL: [0, 0, -15] }) }], [1, { spine: [10, 0, 0], chest: [28, -6, 0], neck: [10, 0, 0], head: [22, 0, 0], ...sym({ armL: [-30, 0, -18], foreL: [-75, 0, 0], handL: [0, 0, 20] }) }]] },
  // --- misc
  pick_up: { clip: 'PickUp_Table', layer: 'full', fade: 0.12 },
  push: { clip: 'Push_Loop', layer: 'full', loop: true, hold: true, fade: 0.2 },
  // --- street life (civilians): phone call, filming, smoking, hailing a cab
  phone: { layer: 'upper', loop: true, hold: true, dur: 0.8, fade: 0.3, poses: [[0, { armR: [-62, 0, -10], foreR: [-120, 0, 0], head: [-4, 14, 0] }], [0.5, { armR: [-64, 0, -12], foreR: [-124, 0, 0], head: [-2, 10, 0] }], [1, { armR: [-62, 0, -10], foreR: [-120, 0, 0], head: [-4, 14, 0] }]] },
  film: { layer: 'upper', loop: true, hold: true, dur: 1, fade: 0.35, poses: [[0, sym({ armL: [-72, 0, 16], foreL: [-70, 0, 0], head: [2, 0, 0] })], [0.5, sym({ armL: [-74, 0, 18], foreL: [-72, 0, 0], head: [3, 3, 0] })], [1, sym({ armL: [-72, 0, 16], foreL: [-70, 0, 0], head: [2, 0, 0] })]] },
  smoke: { layer: 'upper', loop: true, hold: true, dur: 4, fade: 0.3, poses: [[0, { armR: [-6, 0, -8], foreR: [-30, 0, 0] }], [0.35, { armR: [-6, 0, -8], foreR: [-30, 0, 0] }], [0.5, { armR: [-62, 0, -14], foreR: [-135, 0, 0], head: [-6, 0, 0] }], [0.7, { armR: [-62, 0, -14], foreR: [-135, 0, 0], head: [-6, 0, 0] }], [0.85, { armR: [-6, 0, -8], foreR: [-30, 0, 0], head: [-10, 0, 0] }], [1, { armR: [-6, 0, -8], foreR: [-30, 0, 0] }]] },
  hail: { layer: 'upper', loop: true, hold: true, dur: 1.2, fade: 0.25, poses: [[0, { armR: [0, 0, -150], foreR: [0, 0, 20], head: [0, -10, 0] }], [0.5, { armR: [0, 0, -156], foreR: [0, 0, -6], head: [0, -10, 0] }], [1, { armR: [0, 0, -150], foreR: [0, 0, 20], head: [0, -10, 0] }]] },
  talk: { clip: 'Idle_Talking_Loop', layer: 'upper', loop: true, hold: true, fade: 0.25 },
  sit: { clip: 'Sitting_Idle_Loop', layer: 'full', loop: true, hold: true, fade: 0.3 },
  dance: { clip: 'Dance_Loop', layer: 'full', loop: true, hold: true, fade: 0.3 },
};

/** Every UAL clip shipped in public/assets/ual (usable directly as an action name). */
export const UAL_CLIPS = ['A_TPose', 'Crouch_Fwd_Loop', 'Crouch_Idle_Loop', 'Dance_Loop', 'Death01', 'Driving_Loop', 'Fixing_Kneeling', 'Hit_Chest', 'Hit_Head', 'Idle_Loop', 'Idle_Talking_Loop', 'Idle_Torch_Loop', 'Interact', 'Jog_Fwd_Loop', 'Jump_Land', 'Jump_Loop', 'Jump_Start', 'PickUp_Table', 'Pistol_Aim_Down', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Idle_Loop', 'Pistol_Reload', 'Pistol_Shoot', 'Punch_Cross', 'Punch_Enter', 'Punch_Jab', 'Push_Loop', 'Roll', 'Roll_RM', 'Sitting_Enter', 'Sitting_Exit', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Spell_Simple_Enter', 'Spell_Simple_Exit', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Sprint_Loop', 'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Sword_Attack', 'Sword_Attack_RM', 'Sword_Idle', 'Walk_Formal_Loop', 'Walk_Loop'] as const;

const sm = (t: number) => t * t * (3 - 2 * t);
/** Evaluates a keyed pose track at normalised time u into `out` (degrees). */
export function samplePose(keys: [number, Pose][], u: number, out: Map<BoneKey, Euler>) {
  out.clear();
  if (!keys.length) return out;
  let i = 0; while (i < keys.length - 1 && keys[i + 1][0] <= u) i++;
  const [ta, a] = keys[i]; const nb = keys[Math.min(i + 1, keys.length - 1)]; const [tb, b] = nb;
  const k = tb > ta ? sm(Math.min(1, Math.max(0, (u - ta) / (tb - ta)))) : 0;
  const bones = new Set<BoneKey>([...Object.keys(a), ...Object.keys(b)] as BoneKey[]);
  for (const bk of bones) {
    const va = a[bk] ?? [0, 0, 0], vb = b[bk] ?? [0, 0, 0];
    out.set(bk, [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k]);
  }
  return out;
}
