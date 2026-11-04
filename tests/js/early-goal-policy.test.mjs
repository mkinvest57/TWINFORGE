import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
/** Exercise the actual inline policy loop; only dynamics are stubbed to isolate its clock. */
test('a hoop crossing before the first correction releases the obsolete control-time boundary',()=>{
  const html=fs.readFileSync(new URL('../../workbench.html',import.meta.url),'utf8'),start=html.indexOf('function simulateShotMPC('),end=html.indexOf('function launchVelocity()',start);
  assert.ok(start>=0&&end>start);let steps=0,plans=0;
  const context={DT:1/240,S:{shots:1},stateForPrediction:(p,v,spin)=>({p:{...p},v:{...v},spin:{...spin}}),toThree:p=>({...p}),stepPhysics:(s,p,dt)=>{if(++steps>2000)throw new Error('Policy clock is stuck at an obsolete control boundary.');s.p.y-=dt;},crossingBetween:(before,after,p)=>before.y>p.geometry.hoop.center.y&&after.y<=p.geometry.hoop.center.y?{scored:true}:null,planMPC:()=>{plans++;throw new Error('Control must stop after goal reached.');}};
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);const result=context.simulateShotMPC({x:0,y:3.06,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:0},{geometry:{floorY:0,ballRadius:.12,hoop:{center:{x:0,y:3.05,z:0}}}});
  assert.equal(result.scored,true);assert.equal(plans,0);assert.ok(steps>=1000&&steps<1200);
});
