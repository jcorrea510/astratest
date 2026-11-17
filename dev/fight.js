(async()=>{const g=window.__game; g.pcombat.give('rifle', 200); g.pcombat.inv.select('rifle');
const p=g.player.pos; const info={shotsNpc:0, shotsPlayer:0};
g.combat.onShot = ((orig)=> (e)=>{ if(e.shooter===g.player) info.shotsPlayer++; else info.shotsNpc++; orig(e); })(g.combat.onShot);
const e1=g.pop.spawn('gang', p.x-6, p.z-14, 0.2, undefined, 'pistol'); e1.hostile=true; e1.persistent=true;
const e2=g.pop.spawn('gang', p.x+5, p.z-16, 0.2, undefined, 'smg'); e2.hostile=true; e2.persistent=true;
for(let i=0;i<90;i++) g.frame(1/30,false);
info.hpAfterEnemyFire=g.player.health; info.e1brain=e1.brain; info.e2brain=e2.brain;
// aim at e1 and fire
g.input.press('Mouse2');
for (let k=0;k<200 && (e1.alive||e2.alive);k++){ const t=(e1.alive?e1:e2).pos; const dx=t.x-p.x, dz=t.z-p.z; g.cam.yaw=Math.atan2(dx,dz)+Math.PI; g.cam.pitch=-Math.atan2(0.2,Math.hypot(dx,dz)); g.input.press('Mouse0'); g.frame(1/30,false); if(k===20){ g.frame(1/30); window.__shot=1; } }
g.input.release('Mouse0'); g.input.release('Mouse2');
info.e1=e1.alive; info.e2=e2.alive; info.hp=g.player.health; info.heat=g.police.heat; info.pick=g.pickups.length; info.dead=g.deathT;
return info;})()
