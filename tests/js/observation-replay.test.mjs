import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateCausalState,forecastObservation,assessForecast,createObservationReplay,advanceObservationReplay,benchmarkReplay,REPLAY_PROTOCOL} from '../../web/physics/observation-replay.mjs';
const twin={parameters:{g:{value:9.8},drag:{value:.15},wind:{value:[.2,0,.1]}},simulator:{max_step_s:.002}};
function trajectory(n=31){const initial={t:0,position_m:[1,3,2],velocity_m_s:[3,6,.4]};return Array.from({length:n},(_,i)=>{const f=forecastObservation(initial,twin,i*.05);return {t:i*.05,position_m:f.position_m,velocity_m_s:null,track_id:1,quality:{}};});}
test('state initialization has no access to future positions, identities, quality or cadence',()=>{
  const frames=trajectory(),first=estimateCausalState(frames,.31,twin),changed=structuredClone(frames);
  for(const f of changed)if(f.t>.31){f.t+=20;f.position_m=[1e8,-1e8,4];f.track_id='different';f.quality={missing:true,contact:true};}
  assert.equal(first.accepted,true);assert.ok(first.used_t.every(t=>t<=.31));assert.deepEqual(estimateCausalState(changed,.31,twin),first);
});
test('causal rollout fit forecasts known 3D dynamics accurately without supplied velocities',()=>{
  const frames=trajectory(),state=estimateCausalState(frames,.3,twin),assessment=assessForecast(frames,{...forecastObservation(state,twin),initialization:state});
  assert.ok(assessment.error_cm<.1,`error ${assessment.error_cm}cm`);assert.equal(assessment.supported,true);
});
test('quality, track switches and missing observations break source windows before reinitialization',()=>{
  const frames=trajectory();frames[5].quality.fp02_outlier=true;
  assert.equal(estimateCausalState(frames,.25,twin).reason,'flagged_outlier');assert.equal(estimateCausalState(frames,.3,twin).reason,'insufficient_causal_samples');
  const ids=trajectory();ids.slice(6).forEach(f=>f.track_id=2);assert.equal(estimateCausalState(ids,.35,twin).reason,'insufficient_causal_samples');assert.equal(estimateCausalState(ids,.4,twin).accepted,true);
  const missing=trajectory();missing[6].quality.missing=true;missing[6].position_m=null;assert.equal(estimateCausalState(missing,.3,twin).reason,'missing_position');
  const gaps=trajectory().filter(f=>f.t<.2||f.t>.5);assert.equal(estimateCausalState(gaps,.5,twin).reason,'stale_observation');assert.equal(estimateCausalState(gaps,.6,twin).reason,'insufficient_causal_samples');
});
test('a future contact stays in all-issued error while being identified as outside the model scope',()=>{
  const frames=trajectory(),state=estimateCausalState(frames,.3,twin),forecast={...forecastObservation(state,twin),initialization:state};
  frames[12].quality.contact=true;frames[16].position_m[1]+=1;
  const result=assessForecast(frames,forecast);assert.ok(result.error_cm>99);assert.equal(result.supported,false);assert.ok(result.reasons.includes('unmodelled_contact'));
});
test('fixed issuance and summaries are identical at 20, 60, 120fps and batch evaluation',()=>{
  const frames=trajectory(),expected=benchmarkReplay(frames,twin);
  for(const fps of [20,60,120]){const r=createObservationReplay(frames,twin);for(let t=0;t<1.5;t+=1/fps)advanceObservationReplay(r,t);const summary=advanceObservationReplay(r,1.5);assert.deepEqual(summary,expected.summary);assert.deepEqual(r.assessed,expected.assessed);}
  assert.equal(expected.summary.pending,0);assert.ok(expected.summary.unscorable>0);assert.equal(expected.summary.issued,expected.summary.scored+expected.summary.unscorable);
});
test('scoring waits for the future bracket and never rejects a forecast by its numerical error',()=>{
  const frames=trajectory(),state=estimateCausalState(frames,.32,twin),f={...forecastObservation(state,twin),initialization:state};f.position_m[0]+=100;
  assert.equal(assessForecast(frames,f,{available_t:.82}),null);
  const result=assessForecast(frames,f,{available_t:.85});assert.equal(result.supported,true);assert.ok(result.error_cm>9000);assert.equal(REPLAY_PROTOCOL.diagnostic_threshold_cm,5);
});
test('invalid integration steps cannot hang the imported replay',()=>{
  const bad=structuredClone(twin);bad.simulator.max_step_s=-1;assert.ok(forecastObservation({t:0,position_m:[0,1,0],velocity_m_s:[0,0,0]},bad).position_m.every(Number.isFinite));
});
