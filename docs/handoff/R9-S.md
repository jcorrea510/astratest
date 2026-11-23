# R9-S handoff (gun samples)
- Done: 42 CC0 mp3 in public/assets/audio/guns (scripts/bake-gun-samples.sh), src/audio/gunSamples.ts (sets+load+pick), hooks in sfx.ts gunshot(), audio.ts (fetch+decode, stats().gunTakes/gunPlayed), core.ts warmStep skip synth banks.
- Tests: src/audio/gunSamples.test.ts, tests/e2e/gunsamples9.spec.ts. Docs: CREDITS.md, docs/ASSETS.md.
- e2e gunsamples9 passes on own build; audio6a offline tests time out at 240 s under machine load ~20 (warmAll alone 6 s); unverified vs baseline.
