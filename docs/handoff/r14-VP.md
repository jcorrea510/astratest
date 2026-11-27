# r14-VP
- pickLod() in vehicle.ts: FOV+size-aware, hysteresis, LOD_MID 15->13, player lod0.
- Vehicle.update: far (lod2) cars step wheels every 2nd frame, skip idle doors.
- vehicles.ts: lodFov field (hook: game.ts should set vehicles.lodFov = camera.fov).
- lod.test.ts logs BUDGET per kind (L1 ~8%, L2 ~4% of L0, 2 dc/car).
- Not done: lower L0 tris (wheels ~12k of 42k are in parts.ts, owned by CL).
