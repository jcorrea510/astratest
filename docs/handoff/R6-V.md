# R6-V (Opus) vanishing + LOD + perf — handoff
- Done: read code; root causes found (crowd NEAR_KILL=9 kill when promote fails: ped cap full / real car within 8 m / buses never promoted).
- In progress: instrumentation spec tests/e2e/vanish.spec.ts (port 5201, dist /tmp/dist-R6V).
- Next: real-car-LOD instanced far cars, VAT low-poly far peds, demote far real->impostor, shadow lag (no throttle while moving), light-space texel snap, high-quality pixel ratio floor.
- Files: src/game/crowd.ts, population.ts, buses.ts, render/renderer.ts, core/settings.ts, actors/human.ts (LOD), vehicles/vehicle.ts (LOD).
