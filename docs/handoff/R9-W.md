# R9-W map character
- Done: tower() setbacks/notched corners/piers/belt courses/stepped crown+spire (buildings.ts); walk-up quoins + centre parapet; src/world/streetscape.ts (+test): bike racks, trash bags, planters, kiosks, tree guards, sidewalk shed+scaffold, plates, road manholes/patches/cracks, all baked into trim chunks (0 extra draw calls), density by quality (read at build time via loadSettings).
- citybuild.ts hooks: props.add wrapper records `taken`, addTree records street trees, planStreetscape/emitStreetscape after kerb loop; plaza trees get paver inlay + 2 benches.
- Next: e2e tests/e2e/streetscape9.spec.ts, screenshots docs/screenshots/r9w-*.jpg, perf numbers (base build /tmp/dist-r9w-base vs /tmp/dist-r9w). Delete tests/e2e/zz-r9w-shots.spec.ts at the end.
