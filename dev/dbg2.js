(async()=>{const g=window.__game; g.stop(); const out={}; const F=(n)=>{for(let i=0;i<n;i++) g.frame(1/30,false)};
const n = g.pop.spawn('civilian', g.player.pos.x + Math.sin(g.player.yaw) * 1.2, g.player.pos.z + Math.cos(g.player.yaw) * 1.2); n.persistent = true; n.brain = 'idle'; g.cam.yaw = g.player.yaw + Math.PI;
out.before={p:[g.player.pos.x,g.player.pos.z,g.player.yaw], n:[n.pos.x,n.pos.z]};
g.input.tap('Mouse0'); g.frame(1/30,false); out.cool=g.pcombat.inv.cooldown; out.pend=g.pcombat['pendingMelee']; F(18);
out.after={p:[g.player.pos.x,g.player.pos.z,g.player.yaw], n:[n.pos.x,n.pos.z], hp:n.char.health, blocked:g.inputBlocked, menu: window.__meridian.ui.isMenuOpen()};
return out;})()
