/** SAM transports are explicitly mocked here. These checks verify the pixel
 * boundary and forecast chronology; they do not claim a live model call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SamObserver} from '../../web/vision/observer.mjs';

const RUN='a'.repeat(32),NEXT='b'.repeat(32);
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(){for(let i=0;i<6;i++)await tick();}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function rng(seed){let n=seed;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
function fixture(){
  const random=rng(34191),width=128,height=96;
  const background=Uint8Array.from({length:width*height},()=>30+Math.floor(random()*70));
  const patch=Uint8Array.from({length:20*18},()=>20+Math.floor(random()*230));
  function frame(t,{runId=RUN,x=30+Math.round(20*t),frameId='f'+Math.round(t*1000)}={}){
    const data=new Uint8ClampedArray(background);
    for(let yy=0;yy<18;yy++)for(let xx=0;xx<20;xx++)data[(35+yy)*width+x+xx]=patch[yy*20+xx];
    return {runId,t,frameId,imageData:{width,height,data},imageBase64:Buffer.from(frameId).toString('base64')};
  }
  return {frame,width,height};
}
function responseFor(body,{detections=true,centroidOffset=0,overrides={}}={}){
  const x=30+Math.round(20*body.source_time_s),imageSha=createHash('sha256').update(Buffer.from(body.image_base64,'base64')).digest('hex');
  return {schema_version:'twinforge.sam.live.v1',model:'sam-3.1',run_id:body.run_id,frame_id:body.frame_id,source_time_s:body.source_time_s,
    image_sha256:imageSha,width:128,height:96,latency_ms:20,charged_usd:.0025,
    receipt:{model:'sam-3.1',request_id:'c'.repeat(32),request_sha256:'d'.repeat(64)},
    detections:detections?[{id:'1',box:{x1:x,y1:35,x2:x+20,y2:53},centroid:[x+10+centroidOffset,44],
      area:360,polygons:[[[x,35],[x+20,35],[x+20,53],[x,53]]],mask_decoded:true,color_rgb:[240,120,40]}]:[],...overrides};
}
function transport(handler){
  const requests=[];
  return {requests,fetcher:async(url,options)=>{
    const body=JSON.parse(options.body);requests.push({url,body,signal:options.signal});
    return handler?handler(body,options):{ok:true,status:200,json:async()=>responseFor(body)};
  }};
}
function makeObserver(extra={}){
  const io=transport();return {io,observer:new SamObserver({fetcher:io.fetcher,minSamIntervalS:3,...extra})};
}

test('no valid SAM response means no tracking or forecasts, even with moving pixels',async()=>{
  const f=fixture(),io=transport(()=>({ok:false,status:503,json:async()=>({error:'SAM is unavailable'})}));
  const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=12;i++)o.pushFrame(f.frame(i*.1));
  assert.equal(o.snapshot().status,'sam_unavailable');assert.equal(o.snapshot().tracks.length,0);
  assert.equal(o.exportEvidence().current.issued.length,0);assert.equal(io.requests.length,1);
});

test('observer boundary rejects hidden physics and transport sends only pixels, prompt and provenance',async()=>{
  const {observer:o,io}=makeObserver(),f=fixture();o.start({runId:RUN});
  assert.throws(()=>o.pushFrame({...f.frame(0),velocities:[1,2]}),/Only image pixels/);
  assert.throws(()=>o.pushFrame({...f.frame(0),seed:17}),/Only image pixels/);
  o.pushFrame(f.frame(0));await settle();
  assert.deepEqual(Object.keys(io.requests[0].body).sort(),['concept','frame_id','image_base64','run_id','source_kind','source_time_s']);
  assert.equal(io.requests[0].body.concept,'ball');assert.equal(io.requests[0].body.source_kind,'synthetic');
  assert.equal(o.snapshot().samAccepted,1);assert.equal(o.snapshot().tracks.length,1);
  assert.equal(o.exportEvidence().hiddenSimulationStateConsumed,false);
});

test('camera runs retain their source kind and accept the renderer UUID and backend frame identifier formats',async()=>{
  const {observer:o,io}=makeObserver(),f=fixture(),runId='a1234567-1234-4321-9876-123456789abc';
  o.start({runId,sourceKind:'camera',concept:'ball'});
  o.pushFrame(f.frame(0,{runId,frameId:'camera:0.1'}));await settle();
  for(let i=1;i<=11;i++)o.pushFrame(f.frame(i*.1,{runId,frameId:'camera:'+i}));
  assert.equal(io.requests[0].body.source_kind,'camera');
  const e=o.exportEvidence().current;
  assert.ok(e.issued.length&&e.assessments.length);
  for(const record of [...e.samRecords,...e.observations,...e.issued,...e.assessments])assert.equal(record.sourceKind,'camera');
  assert.throws(()=>o.reset({runId,concept:'ball; sphere'}),/one short object concept/);
});

test('SAM response must be bound to exact image hash, model, run and decoded mask',async()=>{
  for(const overrides of [{image_sha256:'e'.repeat(64)},{model:'local-tracker'},{run_id:NEXT},{frame_id:'wrong'},{source_time_s:.1}]){
    const f=fixture(),io=transport(body=>({ok:true,status:200,json:async()=>responseFor(body,{overrides})}));
    const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
    assert.equal(o.snapshot().tracks.length,0);assert.equal(o.snapshot().status,'sam_unavailable');
  }
  const f=fixture(),io=transport(body=>{
    const response=responseFor(body);response.detections[0].mask_decoded=false;
    return {ok:true,status:200,json:async()=>response};
  });
  const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  assert.equal(o.snapshot().status,'no_match');assert.equal(o.snapshot().tracks.length,0);
});

test('delayed SAM anchors replay captured pixels, but issue forecasts only at current time',async()=>{
  const f=fixture(),pending=deferred(),io=transport(body=>pending.promise.then(()=>({ok:true,status:200,json:async()=>responseFor(body)})));
  const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});
  o.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=7;i++)o.pushFrame(f.frame(i*.1));
  assert.equal(o.snapshot().issuedCount,0);assert.equal(io.requests.length,1);
  pending.resolve();await settle();
  const e=o.exportEvidence().current;
  assert.equal(e.samRecords.length,1);assert.equal(e.observations.length,8);
  assert.ok(e.issued.length>0);assert.ok(e.issued.every(p=>Math.abs(p.sourceTime-.7)<1e-8&&p.targetTime>.7));
  assert.ok(e.issued.every(p=>p.usedTimes.every(t=>t<=p.sourceTime)));
  assert.equal(e.assessments.length,0,'past catch-up must not backdate a forecast then score it');
  assert.ok(Math.abs(e.issued[0].point.x-64)<1.2,JSON.stringify(e.issued[0].point));
});

test('frozen future targets keep their original values and retain error after motion reversal',async()=>{
  const {observer:o}=makeObserver(),f=fixture();o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=6;i++)o.pushFrame(f.frame(i*.1));
  const early=o.exportEvidence().current.issued.find(p=>Math.abs(p.sourceTime-.5)<1e-8);
  assert.ok(early);const frozen=structuredClone(early);
  for(let i=7;i<=12;i++)o.pushFrame(f.frame(i*.1,{x:42-Math.round(20*(i*.1-.6))}));
  const evidence=o.exportEvidence().current,retained=evidence.issued.find(p=>p.id===early.id);
  assert.deepEqual(retained,frozen);
  const assessment=evidence.assessments.find(a=>a.predictionId===early.id);
  assert.equal(assessment.status,'scored');assert.ok(assessment.errorPx>10,JSON.stringify(assessment));
  assert.equal(assessment.independentPhysicalGroundTruth,false);
});

test('a response from the previous scene cannot initialize the replacement scene',async()=>{
  const f=fixture(),first=deferred(),second=deferred(),requests=[];
  const io=transport(body=>{requests.push(body);return (requests.length===1?first:second).promise.then(()=>({ok:true,status:200,json:async()=>responseFor(body)}));});
  const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  o.reset({runId:NEXT});assert.equal(io.requests[0].signal.aborted,false,'a dispatched paid POST must be allowed to settle');
  o.pushFrame(f.frame(0,{runId:NEXT}));await settle();
  assert.equal(io.requests.length,1,'a reset cannot create a second in-flight provider request');
  first.resolve();await settle();
  assert.equal(o.snapshot().tracks.length,0);assert.equal(o.snapshot().runId,NEXT);assert.equal(o.snapshot().samPending,false);
  assert.equal(o.retryPendingFrame(),true,'the new run may submit its never-sent first frame while the source clock remains paused');
  await settle();assert.equal(o.snapshot().samPending,true);
  second.resolve();await settle();assert.equal(o.snapshot().tracks.length,1);
  assert.equal(o.exportEvidence().current.samRecords[0].runId,NEXT);assert.equal(o.snapshot().samCalls,2);
});

test('expired SAM frames never initialize tracks from a different current image',async()=>{
  const f=fixture(),pending=deferred(),io=transport(body=>pending.promise.then(()=>({ok:true,status:200,json:async()=>responseFor(body)})));
  const o=new SamObserver({fetcher:io.fetcher,maxBufferSeconds:.4});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=8;i++)o.pushFrame(f.frame(i*.1));
  pending.resolve();await settle();
  assert.equal(o.snapshot().lateSamResponses,1);assert.equal(o.snapshot().tracks.length,0);assert.equal(o.snapshot().issuedCount,0);
});

test('SAM mask centroid offset is maintained while local box follows later pixels',async()=>{
  const f=fixture(),io=transport(body=>({ok:true,status:200,json:async()=>responseFor(body,{centroidOffset:3})}));
  const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  assert.equal(o.snapshot().tracks[0].point.x,43);
  o.pushFrame(f.frame(.1));assert.ok(Math.abs(o.snapshot().tracks[0].point.x-45)<1);
  assert.equal(o.exportEvidence().current.observations[0].source,'sam_mask_anchor');
  assert.equal(o.exportEvidence().current.observations[1].source,'local_appearance_tracking');
});

test('one in-flight request and session request ceiling survive random-scene resets',async()=>{
  const f=fixture(),{observer:o,io}=makeObserver({maxRequests:1});o.start({runId:RUN});
  o.pushFrame(f.frame(0));o.pushFrame(f.frame(.1));await settle();assert.equal(io.requests.length,1);
  o.reset({runId:NEXT});o.pushFrame(f.frame(0,{runId:NEXT}));await settle();
  assert.equal(io.requests.length,1);assert.equal(o.snapshot().status,'request_limit');assert.equal(o.snapshot().tracks.length,0);
});

test('only explicitly unbilled busy responses retry on a later captured frame',async()=>{
  const f=fixture();let calls=0;
  const io=transport(body=>++calls===1?
    {ok:false,status:429,json:async()=>({error:'Busy',code:'sam_busy',provider_call_made:false,retry_after_s:1})}:
    {ok:true,status:200,json:async()=>responseFor(body)});
  const o=new SamObserver({fetcher:io.fetcher,maxRequests:1});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  assert.equal(o.snapshot().status,'sam_busy');assert.equal(o.snapshot().samAccepted,0);
  assert.equal(o.snapshot().samCalls,0,'an explicitly unbilled busy response cannot consume the paid request cap');
  o.pushFrame(f.frame(.5));o.pushFrame(f.frame(2.9));await settle();assert.equal(io.requests.length,1);
  o.pushFrame(f.frame(3));await settle();assert.equal(io.requests.length,2);
  assert.equal(io.requests[1].body.source_time_s,3);assert.equal(o.snapshot().samAccepted,1);assert.equal(o.snapshot().busyResponses,1);
  assert.equal(o.snapshot().tracks.length,1);
  for(const rejected of [{code:'budget_exhausted',error:'Budget exhausted'},{code:'sam_busy',error:'Unproven busy'}]){
    const blocked=transport(()=>({ok:false,status:429,json:async()=>rejected})),other=new SamObserver({fetcher:blocked.fetcher});
    other.start({runId:RUN});other.pushFrame(f.frame(0));await settle();other.pushFrame(f.frame(3));await settle();
    assert.equal(blocked.requests.length,1);assert.equal(other.snapshot().status,'sam_unavailable');
  }
});

test('stop retains unscorable future targets and releases frame pixels',async()=>{
  const {observer:o}=makeObserver(),f=fixture();o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=7;i++)o.pushFrame(f.frame(i*.1));
  assert.ok(o.snapshot().issuedCount>0);o.stop();
  assert.equal(o.frames.length,0);assert.equal(o.snapshot().tracks.length,0);
  assert.equal(o.exportEvidence().current.assessments.filter(a=>a.reason==='observation_stopped').length,o.snapshot().issuedCount);
  assert.equal(o.pushFrame(f.frame(.8)),false);
});

test('a fresh SAM confirmation retains continuous visual identity, past history and pending forecasts',async()=>{
  const f=fixture(),{observer:o}=makeObserver({minSamIntervalS:1});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=9;i++)o.pushFrame(f.frame(i*.1));
  const before=o.exportEvidence().current,trackId=o.snapshot().tracks[0].id;
  const pending=before.issued.find(p=>Math.abs(p.sourceTime-.9)<1e-8);
  assert.ok(pending);const oldObservations=structuredClone(before.observations);
  for(let i=10;i<=12;i++)o.pushFrame(f.frame(i*.1));await settle();
  assert.equal(o.snapshot().tracks[0].id,trackId);assert.equal(o.snapshot().revalidationCount,1);
  let e=o.exportEvidence().current;
  assert.deepEqual(e.observations.slice(0,oldObservations.length),oldObservations,'SAM refresh cannot rewrite earlier measured positions');
  assert.deepEqual(e.issued.find(p=>p.id===pending.id),pending,'SAM refresh cannot move a pending target');
  assert.equal(e.assessments.some(a=>a.predictionId===pending.id),false,'the target remains pending while its source-time is unseen');
  assert.equal(e.observations.filter(o=>o.t===1&&o.trackId===trackId).length,1,'revalidation cannot backfill duplicate observations into continuous history');
  for(let i=13;i<=16;i++)o.pushFrame(f.frame(i*.1));
  e=o.exportEvidence().current;
  assert.equal(e.assessments.find(a=>a.predictionId===pending.id)?.status,'scored');
  assert.ok(e.assessments.find(a=>a.predictionId===pending.id).errorPx<2);
});

test('SAM no-match refresh preserves existing visual tracking only until its own anchor expires',async()=>{
  const f=fixture();let requests=0;
  const io=transport(body=>({ok:true,status:200,json:async()=>responseFor(body,{detections:++requests===1})}));
  const o=new SamObserver({fetcher:io.fetcher,minSamIntervalS:1,maxSamAgeS:1.5});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  const id=o.snapshot().tracks[0].id;
  for(let i=1;i<=12;i++)o.pushFrame(f.frame(i*.1));await settle();
  assert.equal(o.snapshot().tracks[0].id,id);assert.equal(o.snapshot().tracks[0].samTimeS,0);
  o.pushFrame(f.frame(1.6));assert.equal(o.snapshot().tracks.length,0);
  assert.equal(o.snapshot().status,'sam_stale');
});

test('a locked prediction is immutable, future-only and resolved from a subsequent measured frame',async()=>{
  const f=fixture(),{observer:o}=makeObserver({horizon:.2});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  assert.equal(o.lockPrediction(),null);
  for(let i=1;i<=7;i++)o.pushFrame(f.frame(i*.1));
  const ticket=o.lockPrediction();assert.ok(ticket);assert.equal(ticket.status,'locked');assert.ok(Math.abs(ticket.sourceTime-.7)<1e-9);
  assert.ok(ticket.targetTime>ticket.lockedAtSourceTimeS);assert.equal(ticket.sourceFrameId,'f700');assert.equal(ticket.outcome,null);
  const frozen=structuredClone(ticket.prediction),point={...ticket.point};
  ticket.point.x=-1000;ticket.prediction.point.x=-1000;
  assert.deepEqual(o.snapshot().predictionTicket.point,point,'callers cannot mutate the stored ticket');
  o.pushFrame(f.frame(.8,{x:42}));o.pushFrame(f.frame(.9,{x:40}));
  const resolved=o.snapshot().predictionTicket;
  assert.equal(resolved.status,'scored');assert.deepEqual(resolved.prediction,frozen);
  assert.deepEqual(resolved.point,point);assert.ok(resolved.outcome.errorPx>5,'an unexpected reversal must remain a visible miss');
  assert.equal(resolved.outcome.observedTime,resolved.targetTime);assert.equal(resolved.outcome.frameId,'f900');
  assert.equal(o.exportEvidence().current.tickets[0].id,resolved.id);
});

test('stop marks a locked future unscorable and lets a dispatched provider call settle',async()=>{
  const f=fixture(),pending=deferred(),io=transport(body=>pending.promise.then(()=>({ok:true,status:200,json:async()=>responseFor(body)})));
  const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  o.stop();assert.equal(io.requests[0].signal.aborted,false);assert.equal(o.snapshot().samPending,true);
  pending.resolve();await settle();assert.equal(o.snapshot().samPending,false);assert.equal(o.snapshot().tracks.length,0);
  const active=makeObserver({horizon:.2}).observer;active.start({runId:RUN});active.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=7;i++)active.pushFrame(f.frame(i*.1));
  assert.ok(active.lockPrediction());active.stop();
  assert.equal(active.snapshot().predictionTicket.status,'unscorable');assert.equal(active.snapshot().predictionTicket.assessment.reason,'observation_stopped');
});

test('a paused source retries the same frame only after a proven unbilled busy wall-clock delay',async()=>{
  const f=fixture();let calls=0,now=0;
  const io=transport(body=>++calls===1?
    {ok:false,status:429,json:async()=>({error:'Busy',code:'sam_busy',provider_call_made:false,retry_after_s:2})}:
    {ok:true,status:200,json:async()=>responseFor(body)});
  const o=new SamObserver({fetcher:io.fetcher,maxRequests:1,now:()=>now});o.start({runId:RUN});
  assert.equal(o.retryPendingFrame(),false);o.pushFrame(f.frame(0));await settle();
  assert.equal(o.snapshot().retryAfterMs,2000);assert.equal(o.retryPendingFrame(),false);
  now=1999;assert.equal(o.retryPendingFrame(),false);now=2000;assert.equal(o.retryPendingFrame(),true);
  assert.equal(o.retryPendingFrame(),false,'one request at a time even if the UI timer fires twice');await settle();
  assert.equal(io.requests.length,2);assert.equal(io.requests[1].body.frame_id,io.requests[0].body.frame_id);
  assert.equal(o.snapshot().timeS,0);assert.equal(o.snapshot().samAccepted,1);assert.equal(o.snapshot().samCalls,1);
  assert.equal(o.snapshot().observationsCount,1,'retrying a captured image must not fabricate extra motion samples');
  assert.equal(o.snapshot().forecastReadiness.state,'learning');assert.equal(o.snapshot().forecastReadiness.sampleCount,1);
  assert.equal(o.retryPendingFrame(),false,'an accepted image cannot be billed again by the retry pump');
});

test('the paused retry pump cannot retry billed errors or unproved pre-provider failures',async()=>{
  for(const failure of [{code:'sam_provider_error',provider_call_made:true},{code:'sam_busy'},{code:'budget_exhausted',provider_call_made:false}]){
    const f=fixture(),io=transport(()=>({ok:false,status:429,json:async()=>({error:'Unavailable',...failure})}));
    const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
    assert.equal(o.retryPendingFrame(),false);assert.equal(io.requests.length,1);assert.equal(o.snapshot().forecastReadiness.state,'unavailable');
  }
});

test('a delayed unbilled busy response corrects the archived run counter without touching the new run',async()=>{
  const f=fixture(),pending=deferred();
  const io=transport(()=>pending.promise.then(()=>({ok:false,status:429,json:async()=>({error:'Busy',code:'sam_busy',provider_call_made:false})})));
  const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  o.reset({runId:NEXT});o.pushFrame(f.frame(0,{runId:NEXT}));pending.resolve();await settle();
  const e=o.exportEvidence();assert.equal(e.sessionCalls,0);assert.equal(e.current.runCalls,0);
  assert.equal(e.previousRuns[0].runCalls,0);assert.equal(e.previousRuns[0].busyResponses,1);
  assert.equal(o.snapshot().samPending,false);assert.equal(o.snapshot().samAccepted,0);assert.equal(o.snapshot().retryableBusy,false);
});
