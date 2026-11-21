# R6-F (orders/hostage/blood/hit-fx) — DONE
- Key: KeyB is the camera action, so orders stay on G (hold); HUD hint "Hold G · give orders" shows while aiming at a target (orders.ts).
- Tests: src/game/orders.test.ts (7), tests/e2e/orders6f.spec.ts (6, static build: vite build --outDir /tmp/dist-r6f; vite preview --port 5209). All pass; tsc/eslint/vitest clean.
- Screenshots (FX_SHOTS dir): r6f-orders-menu/shield/blood/hit-indicator/hostage-car/low-health. Headless CSS timeline barely ticks, so spec pins fades via addStyleTag for shots.
- Edits outside own files: population.ts, actions.ts, hitzones.ts, character.ts, bindings.ts, settingsPanel.ts, input.ts.
- Round 2 (lead rejected shots): hit indicator = thin red arc wedges on a 22%-height screen ring, rotated per shooter, 1 s fade + edge vignette (combatfx.ts); kneel_head retuned (front thigh down, forearms folded back about y, elbows out, head down) via live pose tuning. Spec shot shows all 4+ wedges. Shots: /tmp/r6f/shots/r6f-{hit-indicator,kneel}.png.
