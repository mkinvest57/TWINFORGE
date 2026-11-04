import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHiddenWorld,stepHiddenWorld,FIXED_STEP,FAMILIES} from '../../web/vision/random-dynamics.mjs';
import {pendulumEnergy} from '../../web/physics/alt-models.mjs';

test('random trials vary initial impulses, geometry and body counts reproducibly',()=>{
  for(const family of FAMILIES){
    const a=createHiddenWorld(123,family),same=createHiddenWorld(123,family),b=createHiddenWorld(124,family);
    assert.deepEqual(a,same);assert.notDeepEqual(a,b);
  }
  const pendulums=Array.from({length:30},(_,seed)=>createHiddenWorld(seed,'pendulum'));
  assert.equal(new Set(pendulums.map(w=>w.pendulum.w1)).size,30);
  assert.equal(new Set(pendulums.map(w=>w.params.L1)).size,30);
  const counts=new Set(Array.from({length:30},(_,seed)=>createHiddenWorld(seed,'collisions').bodies.length));
  assert.deepEqual([...counts].sort(),[3,4,5]);
});

test('all random scenes remain finite and mechanically bounded over 20 seconds',()=>{
  for(const family of FAMILIES)for(let seed=0;seed<15;seed++){
    const world=createHiddenWorld(seed,family);
    for(let i=0;i<4800;i++)stepHiddenWorld(world,FIXED_STEP);
    assert.ok(Math.abs(world.time-20)<1e-8);
    for(const body of world.bodies){
      assert.ok(Object.values(body.p).every(Number.isFinite),family+' position');
      assert.ok(Math.abs(body.p.x)<6&&Math.abs(body.p.z)<4&&body.p.y>-1&&body.p.y<7);
      if(body.v)assert.ok(Object.values(body.v).every(Number.isFinite),family+' velocity');
    }
  }
});

test('pendulum damping does not add material mechanical energy',()=>{
  for(let seed=0;seed<12;seed++){
    const world=createHiddenWorld(seed,'pendulum');
    const initial=pendulumEnergy(world.pendulum,world.params);
    for(let i=0;i<2400;i++)stepHiddenWorld(world,FIXED_STEP);
    const final=pendulumEnergy(world.pendulum,world.params);
    assert.ok(final<=initial+.003,'No artificial energy source: seed '+seed);
  }
});

test('collisions use unequal mass impulses and conserve momentum without damping',()=>{
  const w=createHiddenWorld(1,'collisions');w.drag=0;w.restitution=1;
  w.bodies=[{p:{x:-.35,y:.4,z:0},v:{x:1,y:0,z:0},radius:.4,mass:1},{p:{x:.35,y:.4,z:0},v:{x:-.5,y:0,z:0},radius:.4,mass:3}];
  const momentum=()=>w.bodies.reduce((sum,b)=>sum+b.mass*b.v.x,0);
  const energy=()=>w.bodies.reduce((sum,b)=>sum+.5*b.mass*b.v.x*b.v.x,0);
  const p=momentum(),e=energy();stepHiddenWorld(w);
  assert.ok(Math.abs(momentum()-p)<1e-10);assert.ok(Math.abs(energy()-e)<1e-10);
  assert.ok(w.contacts>0);
});

test('rendering bridge exports pixels only, never hidden state or seed',()=>{
  const source=readFileSync(new URL('../../web/vision/world.mjs',import.meta.url),'utf8');
  const frame=source.match(/respond\(\{type:'tf-frame'[^;]+/)[0];
  assert.match(frame,/image_base64/);assert.match(frame,/t:world.time/);
  assert.doesNotMatch(frame,/seed|bodies|params|pendulum|gravity|velocity|forces/);
  assert.match(source,/crypto.getRandomValues/);assert.match(source,/event.source!==parent/);
});
