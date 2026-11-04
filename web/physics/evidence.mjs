/** Append-only local evidence. Simulation never qualifies as a real experiment. */
export function createEvidenceStore(storage=null,key='twinforge.evidence.v2'){
  let records=[],persistError=null;
  try{const old=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(old))records=old;}catch(e){persistError=String(e.message);}
  return {
    append(type,data={}){const event={id:globalThis.crypto?.randomUUID?.()||`event-${Date.now()}-${records.length}`,recorded_at:new Date().toISOString(),type,data:structuredClone(data)};records.push(event);try{storage?.setItem(key,JSON.stringify(records));persistError=null;}catch(e){persistError=String(e.message);}return event;},
    all(){return structuredClone(records);},
    status(){return {count:records.length,persistent:!!storage&&!persistError,error:persistError};},
  };
}
/** Browser journal: append one record per transaction; never load/delete old runs.
 * The v2 localStorage archive is deliberately left untouched. all() is session-only.
 */
export function createBrowserEvidenceStore({indexedDB=globalThis.indexedDB,runId,databaseName='twinforge.evidence.v3',onStatus=()=>{}}={}){
  const records=[],unsaved=new Map();let persisted=0,persistError=null,ready=false;
  const status=()=>({count:records.length,persisted_count:persisted,pending:unsaved.size,persistent:ready&&unsaved.size===0&&!persistError,backend:indexedDB?'indexeddb':'memory',database:databaseName,error:persistError,legacy_archive:'twinforge.evidence.v2 left unchanged'});
  const notify=()=>{try{onStatus(status());}catch(_){/* UI failure must not lose a journal entry. */}};
  const database=new Promise((resolve,reject)=>{
    if(!indexedDB){reject(new Error('IndexedDB unavailable; current evidence remains in memory until exported.'));return;}
    let request;
    try{request=indexedDB.open(databaseName,1);}catch(error){reject(error);return;}
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('events')){const store=db.createObjectStore('events',{keyPath:'id'});store.createIndex('run_id','run_id',{unique:false});}};
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();ready=false;persistError='Journal version changed in another tab; export this session and reload.';notify();};ready=true;resolve(db);notify();};
    request.onerror=()=>reject(request.error||new Error('Cannot open the local evidence database.'));
    request.onblocked=()=>reject(new Error('Local evidence database upgrade blocked by another tab; export this session.'));
  });
  // Handle opening failures immediately, even when the first event has not arrived yet.
  database.catch(error=>{persistError=String(error.message||error);notify();});
  let writes=Promise.resolve();
  const persist=event=>database.then(db=>new Promise((resolve,reject)=>{
    let transaction;
    try{transaction=db.transaction('events','readwrite');transaction.objectStore('events').put(event);}catch(error){reject(error);return;}
    transaction.oncomplete=resolve;
    transaction.onabort=()=>reject(transaction.error||new Error('Evidence write aborted.'));
    transaction.onerror=()=>{/* onabort reports the transaction failure once. */};
  }));
  const queue=event=>{
    writes=writes.then(()=>persist(event)).then(()=>{if(unsaved.delete(event.id))persisted++;if(!unsaved.size)persistError=null;notify();},error=>{persistError=String(error.message||error);notify();});
  };
  return {
    append(type,data={}){
      const body=structuredClone(data);if(runId&&body&&typeof body==='object'&&body.run_id==null)body.run_id=runId;
      const event={id:globalThis.crypto?.randomUUID?.()||`event-${Date.now()}-${records.length}-${Math.random().toString(36).slice(2)}`,recorded_at:new Date().toISOString(),type,run_id:body?.run_id??runId??null,data:body};
      records.push(event);unsaved.set(event.id,event);queue(event);notify();return structuredClone(event);
    },
    all(){return structuredClone(records);},status,
    async flush(){await writes;return status();},
    async retry(){await writes;for(const event of unsaved.values())queue(event);await writes;return status();},
    async readRun(id){const db=await database;return new Promise((resolve,reject)=>{const request=db.transaction('events','readonly').objectStore('events').index('run_id').getAll(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});},
    async exportArchive({includeLegacy=true,legacyStorage}={}){
      await writes;const errors=[];let archived=[];
      try{const db=await database;archived=await new Promise((resolve,reject)=>{const request=db.transaction('events','readonly').objectStore('events').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}catch(error){errors.push(`IndexedDB archive: ${error.message||error}`);}
      const existing=new Set(archived.map(event=>event.id));for(const event of records)if(!existing.has(event.id))archived.push(structuredClone(event));
      const legacy={included:includeLegacy,key:'twinforge.evidence.v2',records:[]};
      if(includeLegacy){let raw=null;try{const storage=legacyStorage===undefined?globalThis.localStorage:legacyStorage;raw=storage?.getItem(legacy.key)??null;if(raw!==null){const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw new Error('Legacy journal is not an array.');legacy.records=parsed;}}catch(error){errors.push(`Legacy archive: ${error.message||error}`);if(raw!==null)legacy.unparsed_raw=raw;}}
      return {schema_version:'twinforge.local-archives.v1',exported_at:new Date().toISOString(),database:databaseName,records:archived,legacy,storage_status:status(),errors};
    },
  };
}
/** A run export must not silently include prior sessions or omit referenced proof. */
export function selectEvidenceForRun(records,runId,referencedIds=[]){
  const references=new Set(referencedIds),selected=records.filter(event=>event.run_id===runId||event.data?.run_id===runId||references.has(event.id)),present=new Set(selected.map(event=>event.id));
  const missing=[...references].filter(id=>!present.has(id));if(missing.length)throw new Error(`Evidence export refused: ${missing.length} referenced event(s) are unavailable in this session.`);
  return structuredClone(selected);
}
export function emptySceneEvidence(id){
  return {id,validated:false,tests:['launch','bounce','hoop_passage','net','ghost_ahead','induction','control'].map(test=>({id:test,status:'not_run',evidence:[],measurements:{},reason:'No measured evidence yet.'})),metrics:{ghost_error_mean_cm:null,verdicts_correct:0,verdicts_total:0,collisions:null}};
}
export function setSceneTest(scene,id,status,{evidence=[],measurements={},reason=''}={}){
  const test=scene.tests.find(t=>t.id===id);if(!test)throw new Error(`Unknown test ${id}`);
  if(status==='pass'&&!evidence.length)throw new Error('A passing check requires an evidence record.');
  if(status==='not_applicable'&&!reason)throw new Error('Not applicable requires a reason.');
  Object.assign(test,{status,evidence,measurements,reason});
  scene.validated=scene.tests.every(t=>t.status==='pass'||(t.status==='not_applicable'&&t.reason));
}
export function weightedMean(samples){let sum=0,count=0;for(const s of samples){if(Number.isFinite(s.sum)&&s.count>0){sum+=s.sum;count+=s.count;}}return count?sum/count:null;}
