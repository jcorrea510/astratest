r14-CS: traffic obstacle queries use SpatialGrid (src/game/spatialGrid.ts) for vehicles+npcs per fixedUpdate; population shadow/despawn/civ-count allocs removed.
NPC brain time-slicing, sweep LOD, rest-skip already exist (R7/R12), left unchanged. physics.ts already pose-cached.
Done; tests green (67 files).
