# e2efix handoff
- regressions.spec "the sea is water": test was stale. Coast moved from z~455 to COAST_Z=962 (x=10, z 472-487 is now a building). Coords moved to the real beach; the flooded car's driver surfaces wading, so the test swims out diagonally.
- stores6s "every store type": game is right (Round 9: drawn gun facing the clerk starts a hold-up). Test now holsters (fists) to calm the store.
- playwright.config.ts: PW_CHROMIUM env override.
- Both specs pass locally; no game-code change.
