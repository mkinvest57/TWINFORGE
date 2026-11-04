import test from 'node:test';
import assert from 'node:assert/strict';
import {stepPendulumRK4,forecastPendulum,pendulumEnergy,accelerationFromPositions,pendulumAcceleration,median} from '../../web/physics/alt-models.mjs';
import {createEvaluator} from '../../web/physics/evaluator.mjs';
const parameters={g:9.81,L1:1.05,L2:.9};
const initial=()=>({th1:2.25,th2:2.85,w1:0,w2:0});
const endpoint=(s,p=parameters)=>[Math.sin(s.th1)*p.L1+Math.sin(s.th2)*p.L2,-Math.cos(s.th1)*p.L1-Math.cos(s.th2)*p.L2];
test('RK4 preserves mechanical energy during twenty seconds of chaotic motion',()=>{
  const state=initial(),energy=pendulumEnergy(state,parameters);let max=0;
  for(let i=0;i<4800;i++){stepPendulumRK4(state,parameters,1/240);max=Math.max(max,Math.abs(pendulumEnergy(state,parameters)-energy));}
  assert.ok(max<.0002,`maximum energy drift ${max} J`);
});
test('rolling forecast begins at the observed mass, and a locked forecast never follows later observations',()=>{
  const state=initial(),params={...parameters,g:8.8},prediction=forecastPendulum(state,params),locked=structuredClone(prediction);
  assert.deepEqual(endpoint(prediction.path[0]),endpoint(state));
  for(let i=0;i<240;i++)stepPendulumRK4(state,parameters,1/240);
  params.g=20;
  const next=forecastPendulum(state,parameters);
  assert.deepEqual(endpoint(next.path[0]),endpoint(state));
  assert.deepEqual(prediction,locked);
  assert.notDeepEqual(next.path[0],prediction.path[0]);
});
test('known-parameter forecast reaches the plant at the exact future target',()=>{
  const evaluator=createEvaluator(),state=initial(),forecast=forecastPendulum(state,parameters);
  for(let i=0;i<120;i++)evaluator.advancePendulum(state,parameters,1/240);
  assert.deepEqual(state,forecast.state);
  assert.ok(Math.abs(forecast.path.at(-1).t-.5)<1e-12);
});
test('prediction consumes the supplied estimate, not the hidden plant coefficient',()=>{
  const a=forecastPendulum(initial(),{...parameters,g:8.8}),b=forecastPendulum(initial(),parameters);
  assert.ok(Math.hypot(...endpoint(a.state).map((v,i)=>v-endpoint(b.state)[i]))>.01);
});
test('gravity can be recovered from angle observations without supplying evaluator coefficients',()=>{
  const evaluator=createEvaluator(),state=initial(),samples=[],estimates=[];
  for(let i=0;i<120;i++){
    samples.push({t:i/240,p:[state.th1,state.th2]});if(samples.length>3)samples.shift();
    if(samples.length===3){const [a,b,c]=samples,acc=accelerationFromPositions(a,b,c),h=c.t-a.t,w1=(c.p[0]-a.p[0])/h,w2=(c.p[1]-a.p[1])/h;
      const zero=pendulumAcceleration(...b.p,w1,w2,1.05,.9,{g:0}),one=pendulumAcceleration(...b.p,w1,w2,1.05,.9,{g:1});
      for(let j=0;j<2;j++)if(Math.abs(one[j]-zero[j])>.1)estimates.push((acc[j]-zero[j])/(one[j]-zero[j]));
    }
    evaluator.advancePendulum(state,{L1:1.05,L2:.9},1/240);
  }
  assert.ok(Math.abs(median(estimates)-9.81)<.005);
});
test('forecast validates horizon and can end at a non-grid target exactly',()=>{
  const r=forecastPendulum(initial(),parameters,{horizon:.503});assert.ok(Math.abs(r.path.at(-1).t-.503)<1e-12);
  assert.throws(()=>forecastPendulum(initial(),parameters,{dt:0}));
  assert.throws(()=>forecastPendulum(initial(),parameters,{horizon:Infinity}));
  assert.throws(()=>stepPendulumRK4(initial(),{...parameters,L1:0},1/240));
});
