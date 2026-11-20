# R6-F (orders/hostage/blood/hit-fx) — IN PROGRESS
- Code done & compiling: src/game/orders.ts (menu key G, compliance, shield, seated hostage), src/render/blood.ts (+Particles.blood, Combat.bloodHit), src/ui/combatfx.ts (indicator/vignette/menu), npc.ts brains 'ordered'/'hostage', sfx hitThud/earRing, Settings.blood + toggle, renderer.setHurt, action kneel_head.
- Wiring in game.ts (orders.update, onPlayerHurt, updateHurtFx). Edits outside own files: population.ts (2 guards), actions.ts, hitzones.ts(zoneBone), character.ts(heldBy), bindings.ts, settingsPanel.ts, input.ts(rawPressed).
- Next: unit tests (src/game/orders.test.ts), e2e tests/e2e/orders6f.spec.ts (port 5209), screenshots (blood, menu, shield, indicator), fix issues.
