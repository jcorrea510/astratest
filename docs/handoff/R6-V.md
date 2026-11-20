# R6-V (Opus) vanishing + LOD + perf — handoff
- Done: far cars = real lod-2 model per kind (src/vehicles/farCars.ts, carMaterial farCarMaterial, build.ts native lod2 + t.far);
  far peds = decimated real body + baked walk VAT (src/actors/crowdBody.ts); crowd.ts never removes in view, soft-cap promotion,
  buses promote, demotion of far real cars/peds; renderer: no shadow frame skipping, light-space snap (shadowFrame), native pixel floor, fine grain.
- In progress: e2e tests/e2e/vanish.spec.ts (fails on old build: 6 vanishes), perf numbers via tests/e2e/perfbench.spec.ts (base worktree build /tmp/dist-R6V-base).
- Next: verify screenshots (zz_r6v_shots/zz_r6v_lods specs, delete before finishing), tune counts, run vitest + e2e.
- Note: traffic.ts jam despawn at >70 m can still pop a car in view (line ~558) — R6-T owns it.
