/** SAM transports are explicitly mocked here. These checks verify the pixel
 * boundary and forecast chronology; they do not claim a live model call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SamObserver} from '../../web/vision/observer.mjs';
import {createSamTracker} from '../../web/vision/sam-tracker.mjs';

const RUN='a'.repeat(32),NEXT='b'.repeat(32);
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(){for(let i=0;i<6;i++)await tick();}
async function until(predicate,message){
  const deadline=Date.now()+1500;
  while(!predicate()){
    assert.ok(Date.now()<deadline,message);
    await new Promise(resolve=>setTimeout(resolve,2));
  }
}
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
  pending.resolve();await until(()=>!o.pending,'delayed SAM catch-up did not complete');
  const e=o.exportEvidence().current;
  assert.equal(e.samRecords.length,1);assert.equal(e.observations.length,8);
  assert.ok(e.issued.length>0);assert.ok(e.issued.every(p=>Math.abs(p.sourceTime-.7)<1e-8&&p.targetTime>.7));
  assert.ok(e.issued.every(p=>p.usedTimes.every(t=>t<=p.sourceTime)));
  assert.equal(e.assessments.length,0,'past catch-up must not backdate a forecast then score it');
  assert.ok(Math.abs(e.issued[0].point.x-64)<1.2,JSON.stringify(e.issued[0].point));
});

test('multi-object SAM catch-up has a finite boundary and waits for a fresh frame before forecasting',async()=>{
  const f=fixture(),response=deferred();let yields=0,o;
  const io=transport(body=>response.promise.then(()=>{
    const result=responseFor(body);result.detections.push({...structuredClone(result.detections[0]),id:'2'});
    return {ok:true,status:200,json:async()=>result};
  }));
  o=new SamObserver({fetcher:io.fetcher,yieldTask:async()=>{
    yields++;assert.equal(o.issued.length,0,'catch-up cannot issue forecasts from an already observed past frame');
    if(yields===1)o.pushFrame(f.frame(1.6));
    await tick();
  }});
  o.start({runId:RUN});o.pushFrame(f.frame(0));await until(()=>io.requests.length===1,'SAM was not requested');
  for(let i=1;i<=15;i++)o.pushFrame(f.frame(i*.1));
  response.resolve();await until(()=>!o.pending,'cooperative catch-up did not finish');
  assert.ok(yields>=3,'the batch must let capture run during multi-object replay');
  assert.equal(o.snapshot().tracks.length,2);assert.equal(o.timeS,1.6);
  for(const track of o.tracks){
    assert.equal(track.lastTime,1.5);assert.equal(track.observations.length,16);
    assert.equal(track.status,'tracking');assert.equal(track.observations.at(-1).frameId,'f1500');
  }
  assert.equal(o.issued.length,0,'a catch-up point behind the latest capture cannot issue a new forecast');
  o.pushFrame(f.frame(1.7));
  assert.equal(o.issued.length,2);assert.ok(o.issued.every(p=>p.sourceTime===1.7&&p.targetTime>1.7));
  assert.ok(o.issued.every(p=>p.usedTimes.every(t=>t<=p.sourceTime)));assert.equal(o.assessments.length,0);
});

test('a tracker slower than capture cadence finishes catch-up instead of chasing incoming frames forever',async()=>{
  const f=fixture(),response=deferred();let o,yields=0,latest=.2,slow=true;
  const io=transport(body=>response.promise.then(()=>({ok:true,status:200,json:async()=>responseFor(body)})));
  o=new SamObserver({fetcher:io.fetcher,trackerFactory:options=>{
    const tracker=createSamTracker(options);
    return {...tracker,update:(image,t)=>{
      if(slow){const deadline=performance.now()+45;while(performance.now()<deadline){}}
      return tracker.update(image,t);
    }};
    },yieldTask:async()=>{
      if(++yields>12)throw new Error('Catch-up chased new camera frames without a finite boundary.');
      latest+=.04;o.pushFrame(f.frame(latest));await tick();
    }});
  o.start({runId:RUN});o.pushFrame(f.frame(0));await until(()=>io.requests.length===1,'SAM was not requested');
  for(let i=1;i<=5;i++)o.pushFrame(f.frame(i*.04));
  response.resolve();await until(()=>!o.pending,'slow catch-up did not finish');slow=false;
  assert.ok(yields>=5&&yields<=6);assert.equal(o.requestBlocked,false);
  assert.equal(o.tracks.length,1);assert.equal(o.tracks[0].lastTime,.2);assert.equal(o.observations.length,6);
  assert.equal(o.issued.length,0,'no forecast may be fabricated from a point behind the live capture');
  for(let i=1;i<=8;i++)o.pushFrame(f.frame(latest+i*.04));
  assert.equal(o.tracks[0].status,'tracking');assert.ok(o.issued.length>0);
  assert.ok(o.issued.every(p=>p.sourceTime>.2&&p.targetTime>p.sourceTime));
});

test('a delayed revalidation keeps an existing fresher tracker instead of installing stale candidate state',async()=>{
  const f=fixture(),reply=deferred();let requests=0,injected=false,o;
  const io=transport(async body=>{
    if(++requests===2)await reply.promise;
    return {ok:true,status:200,json:async()=>responseFor(body)};
  });
  o=new SamObserver({fetcher:io.fetcher,minSamIntervalS:1,yieldTask:async()=>{
    if(!injected){injected=true;for(let i=15;i<=20;i++)o.pushFrame(f.frame(i*.1));}
    await tick();
  }});
  o.start({runId:RUN});o.pushFrame(f.frame(0));await until(()=>!o.pending,'initial anchor did not complete');
  for(let i=1;i<=14;i++)o.pushFrame(f.frame(i*.1));
  await until(()=>requests===2,'revalidation was not requested');
  const trackId=o.tracks[0].id,currentTracker=o.tracks[0].tracker;
  reply.resolve();await until(()=>!o.pending,'revalidation did not finish');
  assert.equal(injected,true);assert.equal(o.timeS,2);assert.equal(o.tracks[0].lastTime,2);
  assert.equal(o.tracks[0].id,trackId);assert.equal(o.tracks[0].tracker,currentTracker);
  assert.equal(o.revalidations.length,1);assert.ok(Math.abs(o.revalidations[0].comparedAtSourceTimeS-1.4)<1e-8);
  o.pushFrame(f.frame(2.1));assert.equal(o.tracks[0].status,'tracking');o.stop();
});

test('stopping or replacing a run during cooperative catch-up cannot commit its old tracks',async()=>{
  for(const replacement of [false,true]){
    const f=fixture(),response=deferred(),pause=deferred();let yielded=false;
    const io=transport(body=>response.promise.then(()=>({ok:true,status:200,json:async()=>responseFor(body)})));
    const o=new SamObserver({fetcher:io.fetcher,yieldTask:()=>{yielded=true;return pause.promise;}});
    o.start({runId:RUN});o.pushFrame(f.frame(0));await until(()=>io.requests.length===1,'SAM was not requested');
    for(let i=1;i<=8;i++)o.pushFrame(f.frame(i*.1));
    response.resolve();await until(()=>yielded,'catch-up did not yield');
    if(replacement)o.start({runId:NEXT});else o.stop();
    pause.resolve();await until(()=>!o.pending,'cancelled catch-up did not finish');
    assert.equal(o.tracks.length,0);assert.equal(o.issued.length,0);
    assert.equal(o.active,replacement);assert.equal(o.runId,replacement?NEXT:RUN);
    if(replacement)assert.equal(o.latestSam,null);
  }
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

test('a delayed SAM refresh retains its anchor and temporal coverage within the bounded frame buffer',async()=>{
  const f=fixture(),reply=deferred();let calls=0,wallTime=1000;
  const io=transport(async body=>{
    calls++;if(calls>1)await reply.promise;
    const result=responseFor(body,{detections:calls>1});
    if(result.detections.length){
      const x=30+Math.round(body.source_time_s*8),d=result.detections[0];
      d.box={x1:x,y1:35,x2:x+20,y2:53};d.centroid=[x+10,44];d.polygons=[[[x,35],[x+20,35],[x+20,53],[x,53]]];
    }
    return {ok:true,status:200,json:async()=>result};
  });
  const o=new SamObserver({fetcher:io.fetcher,now:()=>wallTime,maxBufferedFrames:80,maxBufferSeconds:8});
  o.start({runId:RUN});o.pushFrame(f.frame(0));await until(()=>!o.pending,'first no-match response did not finish');
  for(let i=1;i<=179;i++){
    const t=i*.04;o.pushFrame(f.frame(t,{x:30+Math.round(t*8)}));
  }
  await until(()=>io.requests.length===2,'delayed refresh was not dispatched');
  const submitted=io.requests[1].body;
  assert.equal(submitted.source_time_s,3);assert.equal(o.timeS,7.16);
  assert.ok(o.frames.length<=80);assert.equal(o.frames[0].t,0,'retained coverage spans more than the newest 3.2 seconds');
  assert.ok(o.frames.some(frame=>frame.frameId===submitted.frame_id),'in-flight SAM anchor must survive thinning');
  assert.ok(o.frames.every((frame,i)=>i===0||frame.t-o.frames[i-1].t<=.2+1e-8),'thinning cannot introduce large replay gaps');
  wallTime=5160;reply.resolve();await until(()=>!o.pending,'delayed refresh catch-up did not finish');
  const state=o.snapshot();assert.equal(state.lateSamResponses,0);assert.equal(state.tracks[0].status,'tracking');
  assert.equal(state.latestSam.clientRoundTripMs,4160);assert.equal(state.latestSam.latencyMs,20);
  assert.ok(o.issued.length>0);assert.ok(o.issued.every(p=>p.sourceTime===7.16));
});

test('large SAM contours are sampled around their complete outline instead of cutting off its first quarter',async()=>{
  const f=fixture(),outline=Array.from({length:1600},(_,i)=>[40+8*Math.cos(i*Math.PI/800),44+8*Math.sin(i*Math.PI/800)]);
  const io=transport(body=>{
    const result=responseFor(body);result.detections[0].polygons=[outline];
    return {ok:true,status:200,json:async()=>result};
  });
  const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN});o.pushFrame(f.frame(0));
  await until(()=>!o.pending,'detailed contour was not accepted');
  const polygon=o.snapshot().tracks[0].samPolygons[0];assert.equal(polygon.length,400);
  assert.ok(Math.min(...polygon.map(p=>p[0]))<=32.01);assert.ok(Math.max(...polygon.map(p=>p[0]))>=47.99);
  assert.ok(Math.min(...polygon.map(p=>p[1]))<=36.01);assert.ok(Math.max(...polygon.map(p=>p[1]))>=51.99);
  const area=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
  assert.ok(Math.abs(area-Math.PI*64)<.1,'sampling must preserve the full mask area');
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

test('explicit unlimited allowance accepts more than 60 SAM images and finite reconfiguration preserves counted usage',async()=>{
  const f=fixture(),io=transport(body=>({ok:true,status:200,json:async()=>responseFor(body,{detections:false})}));
  const o=new SamObserver({fetcher:io.fetcher});assert.equal(o.maxRequests,60,'the default remains bounded');
  o.configureRequestLimit(null);o.start({runId:RUN});
  for(let i=0;i<63;i++){
    o.pushFrame(f.frame(i*3,{x:30}));
    await until(()=>!o.pending&&io.requests.length===i+1,'unlimited request '+(i+1)+' did not complete');
  }
  assert.equal(o.snapshot().samAccepted,63);assert.equal(o.snapshot().samCalls,63);
  assert.equal(o.snapshot().unlimitedRequests,true);assert.equal(o.exportEvidence().requestLimit,null);
  o.reset({runId:NEXT});assert.equal(o.history.length,1);assert.equal(o.history[0].samRecords.length,63);
  o.configureRequestLimit(64);o.pushFrame(f.frame(0,{runId:NEXT}));
  await until(()=>!o.pending&&io.requests.length===64,'last finite request did not complete');
  o.pushFrame(f.frame(3,{runId:NEXT}));await settle();
  assert.equal(io.requests.length,64);assert.equal(o.snapshot().status,'request_limit');
  assert.equal(o.snapshot().samCalls,64);assert.equal(o.history[0].samRecords.length,63);
  o.configureRequestLimit(null);o.pushFrame(f.frame(6,{runId:NEXT}));
  await until(()=>!o.pending&&io.requests.length===65,'raising the allowance did not unblock the next observed frame');
  assert.equal(o.snapshot().samAccepted,65);assert.equal(o.history.length,1);
  for(const invalid of [0,-1,1.5,Infinity,NaN,'60',undefined])assert.throws(()=>o.configureRequestLimit(invalid),/positive safe integer or null/);
});

test('lowering the request limit during local encoding prevents an extra POST without resetting evidence',async()=>{
  const f=fixture(),encoded=deferred(),io=transport(body=>({ok:true,status:200,json:async()=>responseFor(body,{detections:false})}));
  const o=new SamObserver({fetcher:io.fetcher,encodeFrame:()=>encoded.promise});o.configureRequestLimit(null);o.start({runId:RUN});
  o.pushFrame(f.frame(0));await until(()=>!o.pending&&o.sessionAccepted===1,'first SAM response did not complete');
  const next=f.frame(3),{imageBase64,...raw}=next;o.pushFrame(raw);assert.ok(o.pending);
  o.configureRequestLimit(1);encoded.resolve({imageBase64});
  await until(()=>!o.pending,'pending encoding did not finish');
  assert.equal(io.requests.length,1);assert.equal(o.sessionCalls,1);assert.equal(o.samRecords.length,1);
  assert.equal(o.snapshot().status,'request_limit');assert.equal(o.runId,RUN);assert.equal(o.active,true);
  assert.equal(o.exportEvidence().requestLimit,1);assert.equal(o.exportEvidence().unlimitedRequests,false);
});

test('only explicitly unbilled busy responses retry on a later captured frame',async()=>{
  const f=fixture();let calls=0;
  const io=transport(body=>++calls===1?
    {ok:false,status:429,json:async()=>({error:'Busy',code:'sam_busy',provider_call_made:false,retry_after_s:1})}:
    {ok:true,status:200,json:async()=>responseFor(body)});
  const o=new SamObserver({fetcher:io.fetcher,maxRequests:1});o.start({runId:RUN});o.pushFrame(f.frame(0));await until(()=>!o.pending&&io.requests.length===1,'initial busy response did not finish');
  assert.equal(o.snapshot().status,'sam_busy');assert.equal(o.snapshot().samAccepted,0);
  assert.equal(o.snapshot().samCalls,0,'an explicitly unbilled busy response cannot consume the paid request cap');
  o.pushFrame(f.frame(.5));o.pushFrame(f.frame(2.9));await settle();assert.equal(io.requests.length,1);
  o.pushFrame(f.frame(3));await until(()=>!o.pending&&io.requests.length===2,'retried SAM response did not finish');assert.equal(io.requests.length,2);
  assert.equal(io.requests[1].body.source_time_s,3);assert.equal(o.snapshot().samAccepted,1);assert.equal(o.snapshot().busyResponses,1);
  assert.equal(o.snapshot().tracks.length,1);
  for(const rejected of [{code:'budget_exhausted',error:'Budget exhausted'},{code:'sam_busy',error:'Unproven busy'}]){
    const blocked=transport(()=>({ok:false,status:429,json:async()=>rejected})),other=new SamObserver({fetcher:blocked.fetcher});
    other.start({runId:RUN});other.pushFrame(f.frame(0));await until(()=>!other.pending&&blocked.requests.length===1,'blocked SAM response did not finish');other.pushFrame(f.frame(3));await settle();
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

test('native spatial selection is bound to the exact initial image, then refreshed with the current tracked box',async()=>{
  const f=fixture(),io=transport(body=>({ok:true,status:200,json:async()=>responseFor(body,{overrides:{selection:body.selection,prompt_kind:body.selection.type}})}));
  const o=new SamObserver({fetcher:io.fetcher,minSamIntervalS:.7});
  o.start({runId:RUN,sourceKind:'video',concept:'object',selection:{type:'point',x:40,y:44}});
  o.pushFrame(f.frame(0));await settle();
  assert.deepEqual(io.requests[0].body.selection,{type:'point',x:40,y:44});
  assert.equal(io.requests[0].body.source_kind,'video');assert.equal(o.snapshot().tracks.length,1);
  for(let i=1;i<=8;i++)o.pushFrame(f.frame(i*.1));await settle();
  assert.equal(io.requests[1].body.selection.type,'box');assert.ok(io.requests[1].body.selection.x>35,'refresh box follows measured motion, not original click');
  assert.equal(o.exportEvidence().current.samRecords[0].promptKind,'point');
});

test('a selected click never retargets stale coordinates after the object is lost',async()=>{
  const f=fixture(),io=transport(body=>({ok:true,status:200,json:async()=>responseFor(body,{overrides:{selection:body.selection}})}));
  const trackerFactory=()=>({select:(im,b,t)=>({status:'tracking',t,point:{x:40,y:44},box:b,confidence:1}),update:(im,t)=>({status:'lost',t,point:null,box:null,confidence:0,reason:'occluded'})});
  const o=new SamObserver({fetcher:io.fetcher,trackerFactory,minSamIntervalS:.5});o.start({runId:RUN,selection:{type:'point',x:40,y:44}});o.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=10;i++)o.pushFrame(f.frame(i*.1));await settle();
  assert.equal(io.requests.length,1);assert.equal(o.snapshot().tracks[0].status,'lost');assert.match(o.snapshot().message,/Tap it again/);
});

test('spatial SAM receipts must echo the request and returned masks must contain the selected point',async()=>{
  const f=fixture();
  for(const mismatch of [true,false]){
    const selection={type:'point',x:mismatch?40:100,y:44};
    const io=transport(body=>({ok:true,status:200,json:async()=>responseFor(body,{overrides:{selection:mismatch?{...selection,x:41}:selection}})}));
    const o=new SamObserver({fetcher:io.fetcher});o.start({runId:RUN,selection});o.pushFrame(f.frame(0));await settle();
    assert.equal(o.snapshot().tracks.length,0);
    assert.equal(o.snapshot().status,mismatch?'sam_unavailable':'no_match');
  }
});

test('lazy encoding runs only for SAM submissions and never rewrites raw local observations',async()=>{
  const f=fixture(),io=transport(),encoded=[];
  const o=new SamObserver({fetcher:io.fetcher,encodeFrame:async frame=>{
    encoded.push(frame.frameId);return {imageBase64:Buffer.from(frame.frameId).toString('base64'),imageData:{...frame.imageData,data:new Uint8ClampedArray(frame.imageData.data)}};
  }});o.start({runId:RUN});
  const raw=t=>{const frame=f.frame(t);delete frame.imageBase64;return frame;};
  o.pushFrame(raw(0));await settle();for(let i=1;i<=12;i++)o.pushFrame(raw(i*.05));
  assert.equal(encoded.length,1);assert.equal(o.snapshot().tracks.length,1);
  const obs=o.exportEvidence().current.observations;
  assert.equal(obs[0].pixelEncoding,'decoded_submitted_jpeg');assert.equal(obs.at(-1).pixelEncoding,'raw_captured_pixels');
  assert.equal(o.exportEvidence().current.rawFramesSeen,true);
});

test('changing forecast horizon preserves SAM identity, source clock and immutable older targets',async()=>{
  const f=fixture(),{observer:o,io}=makeObserver({horizon:.2});o.start({runId:RUN});o.pushFrame(f.frame(0));await settle();
  for(let i=1;i<=12;i++)o.pushFrame(f.frame(i*.1));
  const before=o.exportEvidence().current,identity=o.snapshot().tracks[0].id,oldTargets=structuredClone(before.issued);
  o.setHorizon(1);
  assert.equal(o.snapshot().horizon,1);assert.equal(o.snapshot().tracks[0].id,identity);assert.ok(Math.abs(o.snapshot().timeS-1.2)<1e-8);
  assert.equal(o.snapshot().scoredCount,0,'old .2s scores cannot become 1s scores');assert.equal(io.requests.length,1);
  const after=o.exportEvidence().current;assert.equal(after.mixedHorizon,true);assert.deepEqual(after.horizonsUsed,[.2,1]);
  assert.deepEqual(after.issued.slice(0,oldTargets.length),oldTargets);assert.ok(after.issued.some(p=>p.horizon===1));
  assert.throws(()=>o.setHorizon(1.5),/between/);
});
