import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneBody,cloneModel,stepPhysics,rollout,createNet,validateModel,PHYSICS_DT} from '../../web/physics/model.mjs';
import {planMPC} from '../../web/physics/control.mjs';
import {parseCounterfactual} from '../../web/physics/counterfactual.mjs';
import {createEvidenceStore,emptySceneEvidence,setSceneTest,weightedMean} from '../../web/physics/evidence.mjs';
import {stepOrbitState,estimateOrbitMu} from '../../web/physics/alt-models.mjs';
import {forecastObservation,observedModel} from '../../web/physics/observation-replay.mjs';

const model=()=>({g:9.6,drag:0.015,friction:0.2,restGround:0.6,restBoard:0.5,restRim:0.45,windX:0.4,magnusCoefficient:0.002,mass:0.62,geometry:{ballRadius:0.12,floorY:0,netHeight:0.4,hoop:{center:{x:0,y:3,z:0},radius:0.23,tubeRadius:0.02},board:{center:{x:0,y:3.5,z:-0.4},size:{x:1.8,y:1.1,z:0.05}},obstacles:[]}});
const body=()=>({p:{x:0,y:1.9,z:4.6},v:{x:0,y:6.2,z:-4.8},spin:{x:-6,y:0,z:0}});
test('predictive rollout is identical to direct stepping, and never mutates observations or model',()=>{
  const p=model(),initial=body(),copy=structuredClone(initial),snapshot=structuredClone(p),real=cloneBody(initial);
  for(let i=0;i<120;i++)stepPhysics(real,p,PHYSICS_DT);
  const forecast=rollout(initial,p,{duration:0.5});
  assert.deepEqual(forecast.state.p,real.p);assert.deepEqual(forecast.state.v,real.v);assert.deepEqual(initial,copy);assert.deepEqual(p,snapshot);
});
test('friction and rim restitution are supplied by each model, not a hidden evaluator',()=>{
  const p=model(),low=cloneModel(p),high=cloneModel(p);low.friction=0;high.friction=0.8;
  const initial={p:{x:2,y:0.121,z:2},v:{x:3,y:-3,z:0},spin:{x:0,y:0,z:0}},a=cloneBody(initial),b=cloneBody(initial);
  stepPhysics(a,low,0.01);stepPhysics(b,high,0.01);assert.ok(a.v.x>b.v.x);
  const rimStart={p:{x:.23,y:3.15,z:0},v:{x:0,y:-2,z:0},spin:{x:0,y:0,z:0}};
  const c=cloneBody(rimStart),d=cloneBody(rimStart);low.restRim=.1;high.restRim=.9;stepPhysics(c,low,.02);stepPhysics(d,high,.02);assert.ok(d.v.y>c.v.y);
});
test('English and French counterfactuals apply an exact independent diff',()=>{
  for(const input of ['shoot 20% harder','lance 20 % plus fort']){const p=model(),snapshot=cloneModel(p),v=body().v,r=parseCounterfactual(input,p,v);assert.equal(r.recognized,true);assert.equal(r.velocity.y,v.y*1.2);assert.deepEqual(p,snapshot);}
  for(const input of ['double the wind','vent doublé']){const p=model(),r=parseCounterfactual(input,p,body().v);assert.equal(r.model.windX,p.windX*2);}
  const p=model(),snapshot=cloneModel(p),r=parseCounterfactual('hoop 30 cm left',p,body().v);assert.equal(r.model.geometry.hoop.center.x,-.3);assert.deepEqual(p,snapshot);
  assert.equal(parseCounterfactual('an unsupported request',p,body().v).recognized,false);
});
test('MPC evaluates sequences, respects impulse budget and leaves observed state untouched',()=>{
  const p=model(),s=body(),copy=structuredClone(s),plan=planMPC(s,p,{candidates:12,budget:3,seed:3});
  assert.equal(plan.evaluated,12);assert.equal(plan.summaries.length,12);assert.deepEqual(s,copy);
  if(plan.feasible){assert.equal(plan.commands.length,3);assert.deepEqual(plan.u,plan.commands[0]);assert.ok(Number.isFinite(plan.J));assert.ok(Math.hypot(...Object.values(plan.u))<=1.100001);}
});
test('MPC fails closed when every candidate intersects an obstacle',()=>{
  const p=model();p.geometry.obstacles=[{id:'block',center:{x:0,y:2,z:4.6},size:{x:4,y:4,z:4}}];
  const plan=planMPC(body(),p,{candidates:10});assert.equal(plan.feasible,false);assert.equal(plan.rejected,10);assert.equal(plan.u,undefined);
});
test('net uses integrated nodes and sphere-strand contacts rather than a cosmetic offset',()=>{
  const p=model(),net=createNet(p.geometry),n=net.nodes[24].p;
  const s={p:{x:n.x,y:n.y+0.03,z:n.z},v:{x:0,y:-2,z:0},spin:{x:0,y:0,z:0},net};
  for(let i=0;i<20;i++)stepPhysics(s,p,PHYSICS_DT);
  assert.ok(s.net.contactCount>0);assert.ok(s.net.maxDisplacement>0);assert.ok(s.net.nodes.every(n=>[n.p.x,n.p.y,n.p.z,n.v.x,n.v.y,n.v.z].every(Number.isFinite)));
  for(const n of s.net.nodes.filter(n=>n.anchor))assert.deepEqual(n.p,n.rest);
});
test('a centered ball clears the rim and physically widens the net',()=>{
  const p=model(),s={p:{x:0,y:3.4,z:0},v:{x:0,y:-1,z:0},spin:{x:0,y:0,z:0}};
  let rimContact=false;
  for(let i=0;i<240;i++){stepPhysics(s,p,PHYSICS_DT);rimContact ||= s.lastContacts.includes('rim');}
  assert.equal(rimContact,false);assert.ok(s.net.contactCount>0);assert.ok(s.net.maxDisplacement>.005);assert.ok(s.p.y<2);
});
test('floor friction transfers angular momentum instead of cosmetic rolling',()=>{
  const p=model(),s={p:{x:2,y:.121,z:2},v:{x:2,y:-2,z:0},spin:{x:0,y:0,z:0}};
  stepPhysics(s,p,.01);assert.ok(Math.abs(s.spin.z)>0);assert.ok(s.v.x<2);
});
test('evidence persists, pass requires measured record, session mean weights all samples',()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},store=createEvidenceStore(storage);
  const record=store.append('test',{measured:1}),reloaded=createEvidenceStore(storage);assert.equal(reloaded.all()[0].id,record.id);
  const scene=emptySceneEvidence('hoop');assert.throws(()=>setSceneTest(scene,'net','pass'),/evidence/);setSceneTest(scene,'net','pass',{evidence:[record.id],measurements:{contacts:1}});assert.equal(scene.validated,false);
  assert.equal(weightedMean([{sum:20,count:2},{sum:90,count:3}]),22);
});
test('orbit parameter is recovered from position differences, without true coefficient input',()=>{
  const st={p:{x:2.3,y:0,z:0},v:{x:0,y:0,z:1}},center={x:0,y:0,z:0},samples=[];
  for(let i=0;i<3;i++){samples.push({t:i*PHYSICS_DT,p:[st.p.x,st.p.y,st.p.z]});stepOrbitState(st,center,2.8,PHYSICS_DT);}
  const estimate=estimateOrbitMu(...samples,[0,0,0]);assert.ok(Math.abs(estimate-2.8)<.01);
});
test('missing physical coefficients are rejected instead of replaced with true defaults',()=>{const p=model();delete p.friction;assert.ok(validateModel(p).some(e=>e.includes('friction')));});
test('imported replay uses vector wind and the Python free-flight integrator convention, without contact priors',()=>{
  const twin={parameters:{g:{value:10},drag:{value:0},wind:{value:[2,0,3]},restitution:{value:null},friction:{value:null}},simulator:{max_step_s:.002}};
  const f=forecastObservation({t:2,position_m:[1,5,2],velocity_m_s:[0,0,0]},twin,.5);
  // semi-implicit Euler: displacement a * h² n(n+1)/2, n=250.
  assert.ok(Math.abs(f.position_m[0]-(1+2*.002**2*250*251/2))<1e-10);
  assert.ok(Math.abs(f.position_m[2]-(2+3*.002**2*250*251/2))<1e-10);
  assert.equal(f.target_t,2.5);assert.equal(observedModel(twin).collisionEnabled,false);assert.equal(twin.parameters.restitution.value,null);
});
