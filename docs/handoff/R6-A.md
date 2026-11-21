# R6-A (audio: gunshots, ambience sounds, popping)
- Status: started. Audio engine already rich (core/sfx/gunsynth/loops/ambience). Plan: offline click-detector harness (tests/e2e/audio6a.spec.ts, port 5212) to find pops,
  then fix (voice free/cut-offs, envelopes), then gunsynth punch + new sfx (crash(intensity), bell, register, footsteps surface...) + CC0 samples if reachable.
- Files: src/audio/*, CREDITS.md, public/assets/audio (new), tests/e2e/audio6a.spec.ts
