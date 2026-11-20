# R6-V (Opus) vanishing + LOD + perf — handoff
- Done: far cars = real lod-2 model (farCars.ts, farCarMaterial); far peds = real lod-2 body + walk VAT (crowdBody.ts, now 1.8k tris = real lod 2);
  crowd never removes in view; renderer shadow snap/no skipping. Round 2: lod-2 glass kept (240 tris; was see-through), wheels kept out of
  LOD clustering (were slivers: cars floated), lowBody clusters thin bones finer (forearms/shins no longer vanish), traffic.ts jam despawn never in view.
- Tests: tests/e2e/vanish.spec.ts (base build 10 vanishes / now 0), build.test.ts glass+wheel checks, src/actors/lowBody.test.ts.
- In progress: perfbench base (/tmp/dist-R6V-base on 5202) vs new (/tmp/dist-R6V on 5201).
- Next: delete tests/e2e/zz_r6v_*.spec.ts, full vitest + tsc + eslint, kill servers 5201/5202.
