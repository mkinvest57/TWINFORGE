import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserEvidenceStore,selectEvidenceForRun} from '../../web/physics/evidence.mjs';
/** Small asynchronous IDB test double: commit, abort and persistent shared records. */
function databaseFixture(){
  const rows=new Map(),control={failWrites:false,transactions:0},stores=new Set();
  const requestFor=get=>{const request={};queueMicrotask(()=>{request.result=get();request.onsuccess?.();});return request;};
  const database={objectStoreNames:{contains:name=>stores.has(name)},createObjectStore(name){stores.add(name);return {createIndex(){}};},close(){},transaction(name,mode){control.transactions++;const transaction={error:null};transaction.objectStore=()=>({put(event){const copy=structuredClone(event);queueMicrotask(()=>{if(control.failWrites){transaction.error=new Error('Quota exceeded');transaction.onabort?.();}else{rows.set(copy.id,copy);transaction.oncomplete?.();}});},getAll:()=>requestFor(()=>structuredClone([...rows.values()])),index:()=>({getAll:run=>requestFor(()=>structuredClone([...rows.values()].filter(event=>event.run_id===run)))})});return transaction;}};
  const indexedDB={open(){const request={result:database};queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
  return {indexedDB,rows,control};
}
test('IndexedDB persists individual events, and a new session never loads previous runs into memory',async()=>{
  const fixture=databaseFixture(),first=createBrowserEvidenceStore({indexedDB:fixture.indexedDB,runId:'run-a'}),a=first.append('observation',{position:[1,2,3]});first.append('result',{error_cm:2});await first.flush();
  assert.equal(first.status().persistent,true);assert.equal(fixture.rows.size,2);assert.equal(fixture.control.transactions,2);
  const second=createBrowserEvidenceStore({indexedDB:fixture.indexedDB,runId:'run-b'});assert.deepEqual(second.all(),[]);second.append('observation',{position:[4,5,6]});await second.flush();
  assert.equal(second.all().length,1);assert.equal(fixture.rows.size,3);assert.equal((await second.readRun('run-a')).length,2);
  a.data.position[0]=999;assert.deepEqual((await second.readRun('run-a'))[0].data.position,[1,2,3]);
});
test('quota failures stay visible, keep memory evidence, and can be retried without duplication',async()=>{
  const fixture=databaseFixture(),statuses=[];fixture.control.failWrites=true;const store=createBrowserEvidenceStore({indexedDB:fixture.indexedDB,runId:'quota',onStatus:s=>statuses.push(s)});store.append('large',{payload:'x'.repeat(1024)});
  const failed=await store.flush();assert.equal(failed.persistent,false);assert.equal(failed.pending,1);assert.match(failed.error,/Quota/);assert.equal(store.all().length,1);assert.equal(fixture.rows.size,0);assert.ok(statuses.some(s=>s.error));
  fixture.control.failWrites=false;const retried=await store.retry();assert.equal(retried.persistent,true);assert.equal(retried.pending,0);assert.equal(fixture.rows.size,1);
});
test('archive export recovers all runs and untouched v2 records only on explicit request',async()=>{
  const fixture=databaseFixture(),first=createBrowserEvidenceStore({indexedDB:fixture.indexedDB,runId:'old'});first.append('old');await first.flush();const current=createBrowserEvidenceStore({indexedDB:fixture.indexedDB,runId:'new'});current.append('new');await current.flush();
  let reads=0,writes=0;const legacyRaw=JSON.stringify([{id:'v2',data:{run_id:'legacy'}}]),legacy={getItem:key=>{assert.equal(key,'twinforge.evidence.v2');reads++;return legacyRaw;},setItem(){writes++;throw Error('Must not rewrite the old archive');}};
  const archive=await current.exportArchive({legacyStorage:legacy});assert.equal(archive.records.length,2);assert.equal(archive.legacy.records.length,1);assert.equal(reads,1);assert.equal(writes,0);assert.equal(current.all().length,1);
  const excluded=await current.exportArchive({includeLegacy:false,legacyStorage:legacy});assert.equal(excluded.legacy.included,false);assert.equal(reads,1);
});
test('current-run export includes explicitly referenced legacy records but refuses missing evidence IDs',()=>{
  const records=[{id:'old',data:{run_id:'previous'}},{id:'current',run_id:'now',data:{}},{id:'dependency',data:{run_id:'previous'}}];
  assert.deepEqual(selectEvidenceForRun(records,'now',['dependency']).map(r=>r.id),['current','dependency']);assert.throws(()=>selectEvidenceForRun(records,'now',['absent']),/export refused/);
});
test('without IndexedDB the run and explicit archive remain exportable from memory',async()=>{
  const store=createBrowserEvidenceStore({indexedDB:null,runId:'offline'});store.append('result',{measured:1});const status=await store.flush();assert.equal(status.persistent,false);assert.match(status.error,/IndexedDB unavailable/);
  const archive=await store.exportArchive({includeLegacy:false});assert.equal(archive.records.length,1);assert.equal(archive.errors.length,1);
});
