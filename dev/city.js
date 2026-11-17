(async()=>{const g=window.__game; g.pcombat.give('pistol', 48); g.pcombat.give('smg', 90);
for(let i=0;i<240;i++) g.frame(1/30,false);
const info={npcs:g.pop.npcs.length, cars:g.traffic.cars.length, vehicles:g.vehicles.list.length};
// shoot into the air near peds
g.pcombat.inv.select('pistol'); g.input.press('Mouse2'); for(let i=0;i<10;i++) g.frame(1/30,false);
g.input.tap('Mouse0'); g.frame(1/30,false); g.input.release('Mouse2');
for(let i=0;i<60;i++) g.frame(1/30,false);
info.heat=g.police.heat; info.flee=g.pop.npcs.filter(n=>n.brain==='flee'||n.brain==='cower').length;
for(let i=0;i<300;i++) g.frame(1/30,false);
info.units=g.police.units.length; info.foot=g.police.foot.length; info.heat2=g.police.heat; info.hp=g.player.health; info.dead=g.deathT;
g.frame(1/30);
return info;})()
