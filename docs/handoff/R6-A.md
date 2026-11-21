# R6-A (audio: gunshots, ambience sounds, popping)
- Done (in tree): declick.ts (>=5 ms ramps), voicepool.ts (cap/steal/rate limit), loops/core/ambience fixes, sfx2.ts (steps by surface, car doors, store bell, register, crashLight/Heavy), audio.ts API: crash(i,pos), footstep(surface,pos,vol), storeBell, registerDrawer, carDoor(open,pos); gunsynth punch+tail.
- Tests: src/audio/audio6a.test.ts (unit), tests/e2e/audio6a.spec.ts (OfflineAudioContext click detector, outlier-vs-neighbour on 2nd difference; all 3 pass; PW_PORT=5212 vs `vite preview --outDir /tmp/dist-r6a`).
- Not wired: game callers for footstep surface / storeBell / registerDrawer / carDoor (R6-X calls crash). No CC0 samples used (all synthesized; nothing for CREDITS).
