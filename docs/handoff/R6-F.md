# R6-F (orders/hostage/blood/hit-fx) — DONE
- Key: KeyB is the camera action, so orders stay on G (hold); HUD hint "Hold G · give orders" shows while aiming at a target (orders.ts).
- Tests: src/game/orders.test.ts (7), tests/e2e/orders6f.spec.ts (6, static build: vite build --outDir /tmp/dist-r6f; vite preview --port 5209). All pass; tsc/eslint/vitest clean.
- Screenshots (FX_SHOTS dir): r6f-orders-menu/shield/blood/hit-indicator/hostage-car/low-health. Headless CSS timeline barely ticks, so spec pins fades via addStyleTag for shots.
- Edits outside own files: population.ts, actions.ts, hitzones.ts, character.ts, bindings.ts, settingsPanel.ts, input.ts.
