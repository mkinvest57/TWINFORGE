import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCounterfactual} from '../../web/physics/counterfactual.mjs';
const model=()=>({g:9.81,windX:.4,geometry:{hoop:{center:{x:0,y:3,z:0}},board:{center:{x:0,y:3.5,z:-.4}}}}),velocity={x:0,y:6,z:-8};
test('French and English wind percentages never change launch velocity or gravity',()=>{
  for(const text of ['vent 20% plus fort','increase wind by 20%','wind 20% stronger','vent +20%']){const p=model(),before=structuredClone(p),r=parseCounterfactual(text,p,velocity);assert.equal(r.model.windX,.48);assert.deepEqual(r.velocity,velocity);assert.equal(r.model.g,p.g);assert.deepEqual(p,before);assert.ok(r.diff.every(d=>d.path==='parameters.windX'));}
});
test('independent clauses bind their own numbers, decimal commas and units',()=>{
  const p=model(),r=parseCounterfactual('lance 12,5 % plus fort et vent 20% moins fort; gravité 1,62 m/s², panier 25 cm à gauche',p,velocity);
  assert.equal(r.velocity.y,6*1.125);assert.ok(Math.abs(r.model.windX-.32)<1e-12);assert.equal(r.model.g,1.62);assert.equal(r.model.geometry.hoop.center.x,-.25);assert.equal(r.model.geometry.board.center.x,-.25);assert.equal(p.geometry.hoop.center.x,0);
});
test('absolute launch speeds keep direction, and wind acceleration retains its distinct units',()=>{
  const r=parseCounterfactual('launch speed 8 m/s',model(),velocity);assert.equal(Math.hypot(...Object.values(r.velocity)),8);assert.ok(Math.abs(r.velocity.y/r.velocity.z-velocity.y/velocity.z)<1e-12);
  const p=model();p.windAcceleration=[1,.2,-.4];const doubled=parseCounterfactual('double the wind',p,velocity);assert.deepEqual(doubled.model.windAcceleration,[2,.4,-.8]);assert.equal(doubled.model.windX,.8);
  const set=parseCounterfactual('wind 0,5 m/s2',p,velocity);assert.deepEqual(set.model.windAcceleration,[.5,.2,-.4]);assert.throws(()=>parseCounterfactual('wind 2 m/s',p,velocity),/acceleration/);assert.throws(()=>parseCounterfactual('launch 8 m/s2',p,velocity),/m\/s units/);
});
test('lunar gravity without an explicit absolute value is refused, not guessed',()=>{
  for(const text of ['gravity on the moon','gravité de la lune','moon','lunar gravity 20% weaker'])assert.throws(()=>parseCounterfactual(text,model(),velocity),/Lunar gravity/);
  const r=parseCounterfactual('lunar gravity 1.62 m/s2',model(),velocity);assert.equal(r.model.g,1.62);
});
test('percent decrease is entity scoped, and contradictory signs/directions fail closed',()=>{
  const r=parseCounterfactual('gravity 20% lower and shoot 10% slower',model(),velocity);assert.equal(r.model.g,9.81*.8);assert.equal(r.velocity.y,5.4);assert.equal(r.model.windX,.4);
  for(const text of ['wind -20% stronger','wind +20% weaker','wind double 20% stronger','wind 20%'])assert.throws(()=>parseCounterfactual(text,model(),velocity));
});
test('unsupported and ambiguous clauses cannot silently apply a partial request',()=>{
  assert.equal(parseCounterfactual('make everything blue',model(),velocity).recognized,false);
  for(const text of ['double the wind and make it rain','shoot 20% harder wind 30% weaker','wind 20% stronger and wind 10% stronger','hoop 20 left']){const p=model(),snapshot=structuredClone(p);assert.throws(()=>parseCounterfactual(text,p,velocity));assert.deepEqual(p,snapshot);assert.deepEqual(velocity,{x:0,y:6,z:-8});}
});
test('bounds and declared UI hoop step stay explicit on the independent clone',()=>{
  for(const text of ['shoot 100% slower','shoot 600% harder','hoop 6 m left','gravity -1','gravity 101','wind times 6'])assert.throws(()=>parseCounterfactual(text,model(),velocity));
  const p=model(),r=parseCounterfactual('move the hoop to the left',p,velocity);assert.equal(r.model.geometry.hoop.center.x,-.3);assert.equal(r.diff[0].assumption,'declared default UI displacement: 0.30 m');assert.deepEqual(p,model());
});
