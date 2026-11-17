(async()=>{const g=window.__game; const p=g.player.pos;
const cars=[]; const kinds=['sedan','taxi','police','hatch','wagon','coupe','van'];
kinds.forEach((k,i)=>cars.push(g.vehicles.spawn(k, -330+i*9, -100+(i===1?3.5:-3.5), i===1?Math.PI/2:-Math.PI/2)));
for(let i=0;i<30;i++) g.frame(1/30,false);
g.player.place(-321, 0.2, -99.4, 0);
for(let i=0;i<5;i++) g.frame(1/30,false);
g.input.tap('KeyF'); for(let i=0;i<30;i++) g.frame(1/30,false);
const inCar = !!g.playerVehicle;
g.input.press('KeyW'); for(let i=0;i<90;i++) g.frame(1/30,false);
const sp = g.playerVehicle?.speed;
g.input.press('KeyA'); g.input.press('Space'); for(let i=0;i<20;i++) g.frame(1/30,false); g.input.release('Space'); g.input.release('KeyA');
for(let i=0;i<10;i++) g.frame(1/30,false);
g.frame(1/30); window.__res={inCar, sp, pos:g.playerVehicle?.position, hp: g.playerVehicle?.health, h: g.hour};
return window.__res;})()
