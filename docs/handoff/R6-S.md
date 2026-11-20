# R6-S handoff (stores)
- Done: world/storeProps.ts (product atlas, floors, neon), world/storeKinds.ts (convenience/gas/liquor/pawn/jewelry/bank layouts, smash cases, vault), interiors.ts (register drawer+bills, per-kind palette), game/storeExtras.ts (clerk KO, aim reaction, hold-E register, case smash, bank heist), robbery.ts hooks, glass decal clear (particles Decals.clearIn + game.ts onBreak), 'jewelry' kind (places/storegen).
- In progress: screenshots tests/e2e/zz_r6s_shots.spec.ts (delete when done) -> /tmp/claude-0/shots/r6s-*.png; e2e tests/e2e/stores6s.spec.ts; run on own static build: vite build --outDir /tmp/dist-r6s; preview :5208.
- Next: inspect shots, iterate looks, run stores6s + stores.spec, vitest, eslint. Tests expect 11 store kinds (stores.spec, citymap.test updated).
- Outside files: places.ts, storegen.ts, render/particles.ts, game/game.ts (1 line onBreak), stores.spec.ts, citymap.test.ts.
