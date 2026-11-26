# ped-fight-bus handoff
- pedsr6p:145 brave 'flee': Npc provoke() rolls Math.random (brave 90% fight, timid 12%) -> ~10% CI flake. Test now pins Math.random=0.5 around the two onHit calls.
- pedlife5:78 bus: not reproducible locally on a8740d2; CI shows `framed` null (no boarder reached the door in 400 polls).
- Worktree was based on a13f737; rebased onto a8740d2 (kerb guard + sweep LOD).
