import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {proposalCopy,defaultMetaAction} from '../../web/causal/copy.mjs';

const report=JSON.parse(await readFile(new URL('../../assets/causal-meta-session.json',import.meta.url),'utf8'));

test('English translations apply only to the exact recorded provider responses',()=>{
  for(const row of report.journal){
    const copy=proposalCopy(report,row);
    assert.equal(copy.translated,true);
    assert.ok(copy.reason.length>30);
    assert.notEqual(copy.reason,row.proposal.reason);
  }
});

test('a changed request or provider response never receives a historical translation',()=>{
  for(const mutate of [row=>row.receipt.request_id='different',row=>row.receipt.request_sha256='changed',row=>row.proposal.reason='Changed explanation',row=>row.proposal.expected_effect='Changed expectation',row=>row.proposal.candidate_id='none']){
    const row=structuredClone(report.journal[0]);mutate(row);
    assert.equal(proposalCopy(report,row).translated,false);
    assert.equal(proposalCopy(report,row).reason,row.proposal.reason);
  }
  assert.equal(proposalCopy({...report,report_sha256:'different'},report.journal[0]).translated,false);
});

test('the default comparison uses the verified recorded Meta action, not the local optimum',()=>{
  assert.equal(defaultMetaAction(report,true).id,'steer:-0.32@0.25');
  assert.notEqual(defaultMetaAction(report,true).id,report.exhaustive_reference.action.id);
});

test('default Meta replay requires matching engine, scenario, settings and verified action',()=>{
  assert.equal(defaultMetaAction(report,false),null);
  assert.equal(defaultMetaAction({...report,provider_calls:0},true),null);
  assert.equal(defaultMetaAction({...report,status:'incomplete'},true),null);
  assert.equal(defaultMetaAction({...report,options:{...report.options,scenario_id:'crossing'}},true),null);
  assert.equal(defaultMetaAction({...report,journal:[]},true),null);
});
