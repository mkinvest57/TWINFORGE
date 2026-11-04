import test from 'node:test';
import assert from 'node:assert/strict';
import {multiBodyFixture,estimateMultiGravity} from '../../web/physics/alt-models.mjs';
import {createEvaluator} from '../../web/physics/evaluator.mjs';
test('interactive drop actually exercises sphere and ground contacts, then settles in the visible arena',()=>{
  const bodies=multiBodyFixture(),plant=createEvaluator(),contacts=new Set();let settled=null;
  for(let i=0;i<240*5;i++){
    for(const event of plant.advanceSpheres(bodies,1/240))contacts.add(event.type);
    if(i>240*2&&settled===null&&bodies.every(b=>b.p.y<=b.r+.002&&Math.hypot(b.v.x,b.v.y,b.v.z)<.02))settled=i/240;
  }
  assert.deepEqual([...contacts].sort(),['ground','sphere']);
  assert.ok(settled>2&&settled<4);
  assert.ok(bodies.every(b=>Math.abs(b.p.x)<5.5&&b.p.y>=b.r&&Object.values(b.p).every(Number.isFinite)));
  assert.equal(multiBodyFixture()[0].p.y,.7);
});

test('close but separated drop bodies still provide an observable gravity estimate',()=>{
  const bodies=multiBodyFixture(),plant=createEvaluator(),samples=[];
  for(let i=0;i<3;i++){samples.push({t:i/240,positions:bodies.map(b=>[b.p.x,b.p.y,b.p.z])});plant.advanceSpheres(bodies,1/240);}
  assert.ok(Math.abs(estimateMultiGravity(samples,bodies)-9.81)<1e-8);
  const contaminated=structuredClone(samples);for(const o of contaminated)o.positions=o.positions.map(()=>[0,.14,0]);
  assert.equal(estimateMultiGravity(contaminated,bodies),null);
});
