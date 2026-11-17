(async()=>{const g=window.__game; g.stop(); const out={}; const F=(n)=>{for(let i=0;i<n;i++) g.frame(1/30,false)};
g.input.press('KeyW'); F(60); g.input.press('ShiftLeft'); F(45); g.input.release('KeyW'); g.input.release('ShiftLeft');
g.input.tap('Space'); F(31); g.input.tap('KeyC'); F(31);
g.player.place(-280, 0.25, -95.5, Math.PI / 2); const v=g.vehicles.spawn('sedan', -278, -97.5, Math.PI / 2); F(15);
g.input.tap('KeyF'); F(31);
out.same=g.playerVehicle===v; out.near=g.playerVehicle?.name;
g.input.press('KeyW'); F(90); g.input.press('KeyA'); g.input.press('Space'); F(30); g.input.release('KeyA'); g.input.release('Space'); g.input.release('KeyW');
g.playerVehicle.phys.teleport(-420, 0.6, -102, -Math.PI / 2); out.hp0=g.playerVehicle.health;
g.input.press('KeyW'); for(let i=0;i<150;i++){ g.frame(1/30,false); if(i%30==0) out['p'+i]=[g.playerVehicle.position.x.toFixed(1),g.playerVehicle.position.y.toFixed(2),g.playerVehicle.position.z.toFixed(1), g.playerVehicle.speed.toFixed(1)]; } g.input.release('KeyW');
out.hp1=g.playerVehicle.health; out.parent=g.player.human.root.parent===g.playerVehicle.visual; out.state=g.player.human.currentState;
g.frame(1/30);
return out;})()
