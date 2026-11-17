(async()=>{const g=window.__game; g.player.human.root.visible=false; g.frame(1/30);
const V=g.renderer.camera.position.constructor;
const c=g.debugLineup(1, 40)[0];
c.human.look.skin='#f1c9a5'; c.human.look.hair='#5a3d28'; c.human.applyLook(c.human.look);
c.yaw=0.5; if (!window.__pose) { c.human.mixer.stopAllAction(); c.human.mixer.update(0);} else { for(let i=0;i<10;i++) c.updateVisual(1/30); }
c.human.root.position.copy(c.pos); c.human.root.rotation.y=c.yaw; c.human.root.updateMatrixWorld(true);
const hp=c.human.head.getWorldPosition(new V());
g.renderer.camera.position.set(hp.x+0.25,hp.y+0.02,hp.z+0.55); g.renderer.camera.lookAt(hp.x,hp.y-0.0,hp.z); g.renderer.render();})()
