import test from 'node:test';
import assert from 'node:assert/strict';
import {SCENARIOS,createScenario,normalizeIntervention,candidateInterventions,resolveContact,runScenario,evaluateIntervention,planIntervention,sampleRun,createExperiment} from '../../web/causal/engine.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const kinetic=b=>.5*b.mass*(b.vx*b.vx+b.vz*b.vz);
const momentum=bodies=>bodies.reduce((s,b)=>[s[0]+b.mass*b.vx,s[1]+b.mass*b.vz],[0,0]);
function simpleScenario(){return {id:'analytic',horizonS:1,arena:{width:100,depth:100},controlBodyId:'a',protectedBodyId:'b',dangerThresholdJ:8,physics:{dragPerS:0,restitution:1,wallRestitution:1},bodies:[{id:'a',x:-1,z:0,vx:1,vz:0,mass:2,radius:.5},{id:'b',x:1,z:0,vx:-1,vz:0,mass:2,radius:.5}]};}

test('seeded scenarios are repeatable, distinct and explicitly synthetic supplied models',()=>{
  assert.equal(SCENARIOS.length,3);const states=[];
  for(const {id} of SCENARIOS){const s=createScenario(id);assert.deepEqual(s,createScenario(id));assert.notDeepEqual(s.bodies,createScenario(id,{seed:42}).bodies);assert.equal(s.modelDisclosure.realWorldValidation,false);assert.equal(s.modelDisclosure.metaPoweredPhysics,false);assert.equal(s.modelDisclosure.source,'supplied_initial_state_and_contact_law');states.push(JSON.stringify(s.bodies));}
  assert.equal(new Set(states).size,3);assert.throws(()=>createScenario('unknown'));assert.throws(()=>createScenario('cascade',{perturbation:2}));
});

test('elastic contact conserves vector momentum and kinetic energy for unequal masses',()=>{
  const a={id:'a',x:0,z:0,vx:3,vz:1,mass:2,radius:.5},b={id:'b',x:.9,z:0,vx:-1,vz:-2,mass:5,radius:.5};
  const beforeMomentum=momentum([a,b]),beforeEnergy=kinetic(a)+kinetic(b),event=resolveContact(a,b,1),afterMomentum=momentum([a,b]);
  close(beforeMomentum[0],afterMomentum[0]);close(beforeMomentum[1],afterMomentum[1]);close(beforeEnergy,kinetic(a)+kinetic(b));
  close(event.energyJ,.5/(1/2+1/5)*16);close(a.vz,1);close(b.vz,-2);assert.ok(b.x-a.x>=1);
});

test('inelastic contact obeys restitution and never injects kinetic energy',()=>{
  const a={id:'a',x:0,z:0,vx:3,vz:0,mass:2,radius:.5},b={id:'b',x:.9,z:0,vx:-1,vz:0,mass:5,radius:.5};
  const before=kinetic(a)+kinetic(b),normalBefore=b.vx-a.vx,m=momentum([a,b]);resolveContact(a,b,.4);
  close(b.vx-a.vx,-.4*normalBefore);close(momentum([a,b])[0],m[0]);assert.ok(kinetic(a)+kinetic(b)<before);
  assert.equal(resolveContact(a,b,.4),null);
});

test('analytic two-body collision matches the closed-form elastic result',()=>{
  const run=runScenario(simpleScenario());assert.equal(run.events.length,1);close(run.finalState.bodies[0].vx,-1);close(run.finalState.bodies[1].vx,1);
  close(run.metrics.initialEnergyJ,run.metrics.finalEnergyJ);close(run.metrics.initialMomentum.x,run.metrics.finalMomentum.x);close(run.metrics.initialMomentum.z,run.metrics.finalMomentum.z);
  assert.ok(Math.abs(run.events[0].timeS-.5)<=1/240+1e-8);
});

test('free flight solves the declared linear-drag law without frame-rate error',()=>{
  const scenario=simpleScenario();scenario.horizonS=1.3;scenario.bodies=[{...scenario.bodies[0],x:0,vx:3.2,vz:1.7}];scenario.protectedBodyId='a';scenario.physics.dragPerS=.2;
  const run=runScenario(scenario),b=run.finalState.bodies[0];close(b.vx,3.2*Math.exp(-.2*1.3),1e-10);close(b.vz,1.7*Math.exp(-.2*1.3),1e-10);close(b.x,3.2*(1-Math.exp(-.2*1.3))/.2,1e-10);
});

test('interventions are bounded, single-carrier actions with stable unique candidate IDs',()=>{
  const scenario=createScenario(),candidates=candidateInterventions(scenario,{actionDelayS:.25});assert.equal(candidates.length,37);assert.equal(new Set(candidates.map(a=>a.id)).size,37);
  for(const action of candidates)assert.deepEqual(normalizeIntervention(scenario,action),action);
  for(const action of [{kind:'steer',atS:.25,amount:1},{kind:'brake',atS:.25,amount:1},{kind:'brake',atS:-1,amount:.5},{kind:'brake',atS:3,amount:.5},{kind:'brake',atS:.2,amount:NaN},{kind:'brake',atS:.2,amount:.5,bodyId:'protected'}])assert.throws(()=>normalizeIntervention(scenario,action));
});

test('a steering action preserves speed while braking removes the declared kinetic energy',()=>{
  const s=simpleScenario();s.bodies=[{...s.bodies[0],x:0,vx:3,vz:0}];s.protectedBodyId='a';
  const turn=evaluateIntervention(s,{kind:'steer',atS:0,amount:.2}),brake=evaluateIntervention(s,{kind:'brake',atS:0,amount:.5});
  close(turn.metrics.initialEnergyJ,turn.metrics.finalEnergyJ);close(turn.metrics.controlEnergyChangeJ,0);close(brake.metrics.finalEnergyJ,brake.metrics.initialEnergyJ*.25);close(brake.metrics.controlImpulseNs,3);
  assert.equal(turn.events.filter(e=>e.type==='intervention').length,1);assert.equal(brake.events.filter(e=>e.type==='intervention').length,1);
});

test('all default scenarios have a measured protected collision and a computed successful action',()=>{
  for(const {id} of SCENARIOS){const scenario=createScenario(id),plan=planIntervention(scenario,{robustness:false});assert.equal(plan.baseline.metrics.safe,false,id);assert.equal(plan.best.metrics.safe,true,id);assert.ok(plan.baseline.metrics.protectedImpactEnergyJ>scenario.dangerThresholdJ);assert.ok(plan.best.metrics.protectedImpactEnergyJ<=scenario.dangerThresholdJ);assert.notEqual(plan.bestAction.id,'none');
    const successful=plan.candidates.filter(c=>c.metrics.safe);close(plan.best.metrics.controlImpulseNs,Math.min(...successful.map(c=>c.metrics.controlImpulseNs)));assert.equal(plan.frozenAtSimulationTimeS,0);
  }
});

test('late action can be infeasible and the time-grid report does not invent a guaranteed deadline',()=>{
  const s=createScenario('cascade'),early=planIntervention(s,{scanDeadline:true,robustness:false}),late=planIntervention(s,{actionDelayS:1,robustness:false});
  assert.equal(early.safe,true);assert.equal(late.safe,false);assert.equal(late.candidates.filter(c=>c.metrics.safe).length,0);assert.equal(early.deadline.stepS,.25);assert.equal(early.deadline.rows.length,9);assert.equal(early.deadline.lastSafeDelayS,.25);assert.match(early.deadline.scope,/not a continuous guarantee/);
});

test('the three-speed robustness check exposes a nominal winner that fails off nominal',()=>{
  const plan=planIntervention(createScenario('crossing'));assert.equal(plan.best.metrics.safe,true);assert.equal(plan.robustness.total,3);assert.equal(plan.robustness.safeCount,1);assert.deepEqual(plan.robustness.checks.map(row=>row.speedFactor),[.95,1,1.05]);assert.match(plan.robustness.scope,/no probabilistic or physical guarantee/);
});

test('a halved integration step preserves decisions and bounds nominal baseline energy changes',()=>{
  for(const {id} of SCENARIOS){const s=createScenario(id),plan=planIntervention(s,{robustness:false}),fine=runScenario(s,{dt:1/480}),controlled=runScenario(s,{dt:1/480,intervention:plan.bestAction});
    assert.ok(Math.abs(fine.metrics.protectedImpactEnergyJ-plan.baseline.metrics.protectedImpactEnergyJ)/fine.metrics.protectedImpactEnergyJ<.03,id);assert.equal(controlled.metrics.safe,true,id);
  }
});

test('all recorded bodies remain finite, inside bounds and separated after contact resolution',()=>{
  for(const {id} of SCENARIOS){const s=createScenario(id),run=runScenario(s);for(const frame of run.frames){for(const b of frame.bodies){assert.ok(Number.isFinite(b.x)&&Number.isFinite(b.z)&&Number.isFinite(b.vx)&&Number.isFinite(b.vz));assert.ok(Math.abs(b.x)<=s.arena.width/2-b.radius+1e-8);assert.ok(Math.abs(b.z)<=s.arena.depth/2-b.radius+1e-8);}
    for(let i=0;i<frame.bodies.length;i++)for(let j=i+1;j<frame.bodies.length;j++){const a=frame.bodies[i],b=frame.bodies[j];assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=a.radius+b.radius-1e-7);}
  }}
});

test('metric values are recomputed from contact events, not a scripted outcome',()=>{
  const s=createScenario(),run=runScenario(s),protectedEvents=run.events.filter(e=>e.type!=='intervention'&&e.bodyIds.includes(s.protectedBodyId));
  close(run.metrics.protectedImpactEnergyJ,Math.max(0,...protectedEvents.map(e=>e.energyJ)));close(run.metrics.protectedImpactSumJ,protectedEvents.reduce((sum,e)=>sum+e.energyJ,0));assert.equal(run.metrics.protectedCollisionCount,protectedEvents.length);
  const empty=copy(s);empty.bodies.forEach(b=>{b.vx=0;b.vz=0;});const noIncident=runScenario(empty);assert.equal(noIncident.metrics.safe,true);assert.equal(noIncident.metrics.protectedImpactEnergyJ,0);assert.equal(noIncident.metrics.totalCollisions,0);
});

test('playback reads immutable precomputed trajectories without changing the plan',()=>{
  const experiment=createExperiment(),plan=experiment.plan({robustness:false}),serialized=JSON.stringify(plan);assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.best.frames[20].bodies));
  const first=experiment.snapshot();assert.equal(first.timeS,0);experiment.tick(.12);experiment.tick(.4);close(experiment.snapshot().timeS,.52);assert.equal(JSON.stringify(plan),serialized);
  const frame=sampleRun(plan.best,.52);assert.deepEqual(experiment.snapshot().intervention,frame);assert.equal(experiment.seek(99).timeS,12);assert.equal(experiment.snapshot().finished,true);assert.equal(experiment.seek(-1).timeS,0);
  const evidence=experiment.exportEvidence();evidence.plan.best.frames[0].bodies[0].x=999;assert.notEqual(plan.best.frames[0].bodies[0].x,999);assert.equal(evidence.realWorldValidation,false);
  assert.throws(()=>experiment.tick(-1));assert.throws(()=>experiment.tick(NaN));experiment.reset({scenarioId:'crossing'});assert.equal(experiment.snapshot().planned,false);assert.equal(experiment.snapshot().scenario.id,'crossing');
});
