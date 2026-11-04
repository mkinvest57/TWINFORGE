import test from 'node:test';
import assert from 'node:assert/strict';
import {rollout} from '../../web/physics/model.mjs';
const model={g:9.6,drag:.015,friction:.2,restGround:.6,restBoard:.5,restRim:.45,windX:.4,magnusCoefficient:.002,mass:.62,geometry:{ballRadius:.12,floorY:0,netHeight:.4,hoop:{center:{x:0,y:3,z:0},radius:.23,tubeRadius:.02},board:{center:{x:0,y:3.5,z:-.4},size:{x:1.8,y:1.1,z:.05}},obstacles:[]}};
test('early rejection preserves every feasible rollout exactly and rejects the same forbidden candidates',()=>{
  let feasible=0,rejected=0,savedTime=0;
  for(const x of [0,.22,.32,.42])for(const impulse of [-.5,0,.5]){
    const state={p:{x,y:4.5,z:.12},v:{x:.1,y:-.3,z:0},spin:{x:0,y:0,z:0}},options={duration:1.3,stopAtCrossing:true,commands:[{x:impulse,y:0,z:0}],retainPath:false};
    const complete=rollout(state,model,options),pruned=rollout(state,model,{...options,stopOnForbiddenContact:true});
    const forbidden=r=>r.contacts.find(c=>c.type!=='net');
    assert.equal(Boolean(forbidden(pruned)),Boolean(forbidden(complete)));
    if(!forbidden(complete)){feasible++;assert.deepEqual(pruned,complete);}
    else{rejected++;assert.deepEqual(forbidden(pruned),forbidden(complete));assert.ok(pruned.t<=complete.t);savedTime+=complete.t-pruned.t;}
  }
  assert.ok(feasible>0);assert.ok(rejected>0);assert.ok(savedTime>0);
});
test('command boundaries execute at exact physical times and rollout stops at the exact requested horizon',()=>{
  const p={...model,g:0,drag:0,magnusCoefficient:0,collisionEnabled:false,windAcceleration:[0,0,0]},state={p:{x:0,y:4,z:0},v:{x:0,y:0,z:0},spin:{x:0,y:0,z:0}};
  const r=rollout(state,p,{duration:.301,commands:[{x:1,y:0,z:0},{x:1,y:0,z:0},{x:1,y:0,z:0}],commandInterval:.12});
  r.controls.forEach((c,i)=>assert.ok(Math.abs(c.t-i*.12)<1e-12));assert.equal(r.controls.length,3);assert.ok(Math.abs(r.t-.301)<1e-12);
  assert.ok(Math.abs(r.state.p.x-(.12+2*.12+3*.061))<1e-12);
  assert.throws(()=>rollout(state,p,{dt:0}));assert.throws(()=>rollout(state,p,{commands:[{x:0,y:0,z:0}],commandInterval:0}));
});
