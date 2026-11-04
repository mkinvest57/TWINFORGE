import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeReport} from '../../web/process/report-view.mjs';

const base=()=>({schema_version:'twinforge.process.report.v1',status:'incomplete',passed:false,
  source_kind:'synthetic',mode:'Meta-guided known-family calibration',journal:[],selected_model:null,
  provider_calls:0,stop_reason:'provider_failed',usage_records:[],
  specification:{horizon_s:3,threshold_cm:1,acceptance_metric:'mean_error_cm'}});
const measured=()=>({iteration:1,status:'measured',hypothesis:{family:'constant_inflow',reason:'Known family'},
  validation:{mean_error_cm:2}});
const recorded=()=>JSON.parse(readFileSync(new URL('../../assets/process-meta-session.json',import.meta.url),'utf8'));

test('a failed first call without a model stays a report, not a parser error',()=>{
  const view=describeReport(base());
  assert.equal(view.familyText,'Aucun modèle sélectionné');
  assert.equal(view.isMeta,true);
  assert.equal(view.providerCalls,0);
  assert.match(view.title,/AUCUN APPEL ATTESTÉ/);
  assert.match(view.statusText,/incomplète.*Service du modèle indisponible.*export/s);
  assert.equal(view.stopReason,'provider_failed');
  assert.equal(view.validationMeanCm,null);
  assert.equal(view.testMeanCm,null);
  assert.equal(view.cost,0);
});

test('partial run uses actual counts and preserves its failed status',()=>{
  const value={...base(),provider_calls:2,selected_model:{family:'constant_inflow'},
    journal:[measured(),{iteration:2,status:'provider_failed',error:'HTTP 503'}],
    selection:{mean_error_cm:2},independent_test:{mean_error_cm:3,scored_predictions:21},
    freeze:{test_revealed_after_selection:true}};
  const view=describeReport(value);
  assert.equal(view.trialCount,1);
  assert.equal(view.measuredTrials,1);
  assert.match(view.explanation,/1 hypothèse proposée; 1 mesurée/);
  assert.doesNotMatch(view.explanation,/trois familles|même précision/);
  assert.match(view.title,/INCOMPLÈTE/);
  assert.equal(view.testMeanCm,3);
  assert.match(view.reviewNote,/aucun succès global/);
});

test('completed calculation with an unmet goal is not presented as passing',()=>{
  const view=describeReport({...base(),status:'complete',selected_model:{family:'linear_outflow'},
    journal:[measured()],stop_reason:'iteration_limit',provider_calls:1,passed:false});
  assert.match(view.statusText,/seuil non atteint/);
  assert.equal(view.passed,false);
  assert.equal(view.status,'complete');
});

test('recorded and verified session alone gets its reviewed baseline comparison',()=>{
  const value=recorded(),view=describeReport(value,{recorded:true});
  assert.equal(view.isVerifiedRecordedSession,true);
  assert.equal(view.trialCount,3);
  assert.match(view.explanation,/même modèle et à la même précision/);
  assert.match(view.reviewNote,/troisième commentaire de cette session enregistrée/);
  assert.equal(view.costBasis,'published_rates');
  assert.ok(Math.abs(view.cost-.0130775)<1e-12);
});

test('a fresh execution does not inherit old accuracy equality or model criticism',()=>{
  const value=recorded();value.started_at='2026-11-04T17:00:00+00:00';
  const view=describeReport(value,{recorded:false});
  assert.equal(view.isVerifiedRecordedSession,false);
  assert.doesNotMatch(view.explanation,/même précision/);
  assert.doesNotMatch(view.reviewNote,/troisième commentaire/);
  assert.match(view.title,/NOUVELLE ÉTUDE META/);
});

test('changed recorded scores or provenance lose the reviewed-session attribution',()=>{
  for(const mutate of [value=>{value.independent_test.mean_error_cm=7;},
    value=>{value.provenance.experiment_sha256='changed';},
    value=>{value.journal[2].provider_receipt.request_id='another-call';}]){
    const value=recorded();mutate(value);
    const view=describeReport(value,{recorded:true});
    assert.equal(view.isVerifiedRecordedSession,false);
    assert.doesNotMatch(view.explanation,/même précision/);
  }
});

test('numerical baseline does not become Meta just because it was recorded',()=>{
  const view=describeReport({...base(),mode:'deterministic known-family baseline',status:'complete',passed:true,
    stop_reason:'all_families_measured',journal:[measured()]},{recorded:true});
  assert.equal(view.isMeta,false);
  assert.match(view.title,/NUMÉRIQUE ENREGISTRÉE/);
  assert.doesNotMatch(view.title,/META/);
  assert.match(view.explanation,/sans demander de proposition à Meta/);
});

test('unknown provider charges are named as reservations, not confirmed billing',()=>{
  const view=describeReport({...base(),provider_calls:1,usage_records:[{event:'settled',cost_usd:.024,
    cost_basis:'reservation_unknown_usage',status:'failed_cost_unconfirmed'}]});
  assert.equal(view.cost,.024);
  assert.equal(view.costBasis,'reservation_unknown_usage');
  assert.match(view.costText,/coût fournisseur non confirmé/);
});

test('missing paid usage remains unknown instead of displaying zero',()=>{
  const view=describeReport({...base(),provider_calls:1});
  assert.equal(view.cost,null);
  assert.equal(view.costText,'Coût non documenté');
});

test('invalid schema/journal is rejected; missing selected model is permitted',()=>{
  for(const value of [null,[],{}, {...base(),schema_version:'other'}, {...base(),journal:null},
    {...base(),journal:[null]}, {...base(),selected_model:'unknown'}]){
    assert.throws(()=>describeReport(value),TypeError);
  }
  const value=base();delete value.selected_model;
  assert.doesNotThrow(()=>describeReport(value));
});

test('presentation does not mutate evidence and does not invent missing scores',()=>{
  const value=base(),before=JSON.stringify(value);
  const view=describeReport(value);
  assert.equal(JSON.stringify(value),before);
  assert.equal(view.testCount,null);
  assert.doesNotMatch(view.reviewNote,/0 prévisions/);
  assert.equal(view.isVerifiedRecordedSession,false);
});
