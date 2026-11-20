# R6-V (Opus) vanishing + LOD + perf — handoff
- Done: far cars = real lod-2 model (farCars.ts); far peds = real lod-2 body + walk VAT (crowdBody.ts, 1.8k tris = real lod 2); crowd never
  removes in view; renderer shadow snap. Round 2: lod-2 glass kept (was see-through), wheels out of LOD clustering (were slivers: cars
  floated), lowBody clusters thin bones finer, traffic.ts jam despawn never in view, car occupants get people LODs/culling (population.ts).
- Tests: e2e vanish.spec.ts (base 10 vanishes / now 0), perfbench.spec.ts (high: base 2.41M tris/532 calls, now 2.56M/532; fullFar=0;
  BASE_HIGH_TRIS env guard = 1.15x), build.test.ts glass+wheel checks, src/actors/lowBody.test.ts. vitest 361/361, tsc/eslint clean.
- Status: complete; zz_r6v_* scratch specs deleted, preview servers stopped.
